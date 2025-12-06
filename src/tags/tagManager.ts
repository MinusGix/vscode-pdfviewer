/**
 * TagManager - Core service for managing file tags
 *
 * Handles:
 * - Tag CRUD operations
 * - File tracking with recovery system
 * - Persistent storage
 * - Event notifications
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { nanoid } from 'nanoid';
import {
  TaggedFile,
  Tag,
  TagDatabase,
  TagQuery,
  TagChangeEvent,
  DEFAULT_TAG_DATABASE,
} from './tagTypes';
import {
  getRelativePath,
  getUriFromRelativePath,
  getFileMetadata,
  fileExists,
  findRecoveryCandidates,
  isSupportedFile,
} from './fileIdentity';
import { getTagColor } from './tagColors';

const STORAGE_FILENAME = 'lattice.tags.json';
const DEBOUNCE_SAVE_MS = 1000;

export class TagManager implements vscode.Disposable {
  private static instance: TagManager | undefined;

  private database: TagDatabase = { ...DEFAULT_TAG_DATABASE };
  private disposables: vscode.Disposable[] = [];
  private saveTimeout: NodeJS.Timeout | undefined;
  private initialized = false;

  private readonly _onDidChangeTags = new vscode.EventEmitter<TagChangeEvent>();
  public readonly onDidChangeTags = this._onDidChangeTags.event;

  /** Map from workspace-relative path to file ID for fast lookups */
  private pathToIdMap: Map<string, string> = new Map();

  private constructor() { }

  public static getInstance(): TagManager {
    if (!TagManager.instance) {
      TagManager.instance = new TagManager();
    }
    return TagManager.instance;
  }

  /**
   * Initialize the tag manager - load data and set up watchers
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.loadDatabase();
    this.rebuildPathIndex();
    this.setupFileWatcher();
    this.initialized = true;
  }

  // ================== File Operations ==================

  /**
   * Add tags to a file (creates tracking entry if needed)
   */
  public async addTags(uri: vscode.Uri, tags: string[]): Promise<void> {
    if (!isSupportedFile(uri)) {
      vscode.window.showWarningMessage(
        `File type not supported for tagging: ${path.extname(uri.fsPath)}`
      );
      return;
    }

    const relativePath = getRelativePath(uri);
    let fileId = this.pathToIdMap.get(relativePath);
    let trackedFile: TaggedFile;

    if (fileId && this.database.files[fileId]) {
      trackedFile = this.database.files[fileId];
    } else {
      // Create new tracking entry
      fileId = nanoid(12);
      const metadata = await getFileMetadata(uri);
      trackedFile = {
        id: fileId,
        path: relativePath,
        filename: metadata.filename || path.basename(uri.fsPath),
        fileSize: metadata.fileSize,
        lastModified: metadata.lastModified,
        contentSignature: metadata.contentSignature,
        tags: [],
        lastSeen: Date.now(),
        status: 'ok',
      };
      this.database.files[fileId] = trackedFile;
      this.pathToIdMap.set(relativePath, fileId);
    }

    // Add new tags (avoid duplicates)
    // Process tags keeping normalized and original in sync
    const tagPairs = tags
      .map((t) => ({ normalized: t.toLowerCase().trim(), original: t }))
      .filter((pair) => pair.normalized.length > 0);

    for (const { normalized: normalizedTag, original: originalTag } of tagPairs) {

      if (!trackedFile.tags.includes(normalizedTag)) {
        trackedFile.tags.push(normalizedTag);
      }

      // Create or update tag entry
      this.ensureTagExists(normalizedTag, originalTag);
    }

    // Update file metadata
    trackedFile.lastSeen = Date.now();
    trackedFile.status = 'ok';

    this.updateTagCounts();
    this.scheduleSave();
    this._onDidChangeTags.fire({
      type: 'add',
      fileId,
      filePath: relativePath,
      tags: tagPairs.map((p) => p.normalized),
    });
  }

  /**
   * Remove tags from a file
   */
  public async removeTags(uri: vscode.Uri, tags: string[]): Promise<void> {
    const relativePath = getRelativePath(uri);
    const fileId = this.pathToIdMap.get(relativePath);

    if (!fileId || !this.database.files[fileId]) {
      return; // File not tracked
    }

    const trackedFile = this.database.files[fileId];
    const normalizedTags = tags.map((t) => t.toLowerCase().trim());

    trackedFile.tags = trackedFile.tags.filter(
      (t) => !normalizedTags.includes(t)
    );

    // If no tags left and file doesn't exist, remove tracking
    if (trackedFile.tags.length === 0) {
      const exists = await fileExists(uri);
      if (!exists) {
        delete this.database.files[fileId];
        this.pathToIdMap.delete(relativePath);
      }
    }

    this.updateTagCounts();
    this.cleanupUnusedTags();
    this.scheduleSave();
    this._onDidChangeTags.fire({
      type: 'remove',
      fileId,
      filePath: relativePath,
      tags: normalizedTags,
    });
  }

  /**
   * Set all tags for a file (replaces existing)
   */
  public async setTags(uri: vscode.Uri, tags: string[]): Promise<void> {
    const relativePath = getRelativePath(uri);
    const fileId = this.pathToIdMap.get(relativePath);

    if (fileId && this.database.files[fileId]) {
      // Clear existing tags first
      this.database.files[fileId].tags = [];
    }

    // Add new tags
    await this.addTags(uri, tags);
  }

  /**
   * Get all tags for a file
   */
  public getTags(uri: vscode.Uri): string[] {
    const relativePath = getRelativePath(uri);
    const fileId = this.pathToIdMap.get(relativePath);

    if (!fileId || !this.database.files[fileId]) {
      return [];
    }

    return [...this.database.files[fileId].tags];
  }

  /**
   * Get tags with their display names for a file
   */
  public getTagsWithDisplayNames(
    uri: vscode.Uri
  ): Array<{ name: string; displayName: string }> {
    const tags = this.getTags(uri);
    return tags.map((tag) => ({
      name: tag,
      displayName: this.database.tagDisplayNames[tag] || tag,
    }));
  }

  /**
   * Check if a file has a specific tag
   */
  public hasTag(uri: vscode.Uri, tag: string): boolean {
    const tags = this.getTags(uri);
    return tags.includes(tag.toLowerCase().trim());
  }

  // ================== Tag Operations ==================

  /**
   * Get all tags in the system
   */
  public getAllTags(): Tag[] {
    return Object.values(this.database.tags).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }

  /**
   * Get files with a specific tag
   */
  public getFilesWithTag(tag: string): TaggedFile[] {
    const normalizedTag = tag.toLowerCase().trim();
    return Object.values(this.database.files).filter((f) =>
      f.tags.includes(normalizedTag)
    );
  }

  /**
   * Rename a tag across all files
   */
  public async renameTag(oldName: string, newName: string): Promise<void> {
    const oldNormalized = oldName.toLowerCase().trim();
    const newNormalized = newName.toLowerCase().trim();

    if (oldNormalized === newNormalized) {
      // Just updating display name
      this.database.tagDisplayNames[oldNormalized] = newName;
      if (this.database.tags[oldNormalized]) {
        this.database.tags[oldNormalized].displayName = newName;
      }
      this.scheduleSave();
      return;
    }

    // Update all files
    for (const file of Object.values(this.database.files)) {
      const idx = file.tags.indexOf(oldNormalized);
      if (idx !== -1) {
        file.tags[idx] = newNormalized;
      }
    }

    // Move tag metadata
    if (this.database.tags[oldNormalized]) {
      this.database.tags[newNormalized] = {
        ...this.database.tags[oldNormalized],
        name: newNormalized,
        displayName: newName,
      };
      delete this.database.tags[oldNormalized];
    }

    // Update display names map
    delete this.database.tagDisplayNames[oldNormalized];
    this.database.tagDisplayNames[newNormalized] = newName;

    this.updateTagCounts();
    this.scheduleSave();
    this._onDidChangeTags.fire({ type: 'update' });
  }

  /**
   * Delete a tag from all files
   */
  public async deleteTag(tagName: string): Promise<void> {
    const normalized = tagName.toLowerCase().trim();

    // Remove from all files
    for (const file of Object.values(this.database.files)) {
      file.tags = file.tags.filter((t) => t !== normalized);
    }

    // Remove tag entry
    delete this.database.tags[normalized];
    delete this.database.tagDisplayNames[normalized];

    this.updateTagCounts();
    this.scheduleSave();
    this._onDidChangeTags.fire({ type: 'update' });
  }

  /**
   * Set a custom color for a tag
   */
  public setTagColor(tagName: string, color: string | null): void {
    const normalized = tagName.toLowerCase().trim();

    if (!this.database.tags[normalized]) {
      this.ensureTagExists(normalized, tagName);
    }

    if (color) {
      this.database.tags[normalized].color = color;
    } else {
      delete this.database.tags[normalized].color;
    }

    this.scheduleSave();
    this._onDidChangeTags.fire({ type: 'update' });
  }

  /**
   * Get the color for a tag (custom or auto-generated)
   */
  public getTagColorValue(tagName: string): string {
    const normalized = tagName.toLowerCase().trim();
    const tag = this.database.tags[normalized];
    return getTagColor(tagName, tag?.color);
  }

  // ================== File Query Operations ==================

  /**
   * Find files matching a tag query
   */
  public findFiles(query: TagQuery): TaggedFile[] {
    let results = Object.values(this.database.files);

    if (query.untagged) {
      return results.filter((f) => f.tags.length === 0);
    }

    if (query.allOf && query.allOf.length > 0) {
      const required = query.allOf.map((t) => t.toLowerCase().trim());
      results = results.filter((f) =>
        required.every((t) => f.tags.includes(t))
      );
    }

    if (query.anyOf && query.anyOf.length > 0) {
      const any = query.anyOf.map((t) => t.toLowerCase().trim());
      results = results.filter((f) => any.some((t) => f.tags.includes(t)));
    }

    if (query.noneOf && query.noneOf.length > 0) {
      const none = query.noneOf.map((t) => t.toLowerCase().trim());
      results = results.filter((f) => !none.some((t) => f.tags.includes(t)));
    }

    return results;
  }

  /**
   * Get all tracked files
   */
  public getAllTrackedFiles(): TaggedFile[] {
    return Object.values(this.database.files);
  }

  /**
   * Get files with missing/broken status
   */
  public getBrokenFiles(): TaggedFile[] {
    return Object.values(this.database.files).filter(
      (f) => f.status === 'missing' || f.status === 'moved'
    );
  }

  // ================== File Recovery ==================

  /**
   * Check all tracked files and update their status
   */
  public async checkAllFiles(): Promise<void> {
    for (const file of Object.values(this.database.files)) {
      const uri = getUriFromRelativePath(file.path);
      if (!uri) {
        file.status = 'missing';
        continue;
      }

      const exists = await fileExists(uri);
      if (exists) {
        file.status = 'ok';
        file.lastSeen = Date.now();

        // Update metadata
        const metadata = await getFileMetadata(uri);
        file.fileSize = metadata.fileSize;
        file.lastModified = metadata.lastModified;
        file.contentSignature = metadata.contentSignature;
      } else {
        file.status = 'missing';
      }
    }

    this.scheduleSave();
    this._onDidChangeTags.fire({ type: 'update' });
  }

  /**
   * Try to find a missing file and offer recovery options
   */
  public async findMissingFile(fileId: string): Promise<void> {
    const file = this.database.files[fileId];
    if (!file || file.status === 'ok') {
      return;
    }

    const candidates = await findRecoveryCandidates(file);

    if (candidates.length === 0) {
      vscode.window.showInformationMessage(
        `No potential matches found for "${file.filename}". You can manually locate it.`
      );
      return;
    }

    // If high confidence match, offer quick reassignment
    if (candidates[0].confidence > 0.7) {
      const quickAction = await vscode.window.showInformationMessage(
        `Found likely match for "${file.filename}" at ${getRelativePath(
          candidates[0].uri
        )}. Reassign tags?`,
        'Yes',
        'Choose Another',
        'Cancel'
      );

      if (quickAction === 'Yes') {
        await this.reassignFile(fileId, candidates[0].uri);
        return;
      } else if (quickAction === 'Cancel') {
        return;
      }
    }

    // Show picker for all candidates
    const items = candidates.map((c) => ({
      label: path.basename(c.uri.fsPath),
      description: getRelativePath(c.uri),
      detail: `${Math.round(c.confidence * 100)}% confidence - ${c.reason}`,
      uri: c.uri,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Select the new location for "${file.filename}"`,
      matchOnDescription: true,
    });

    if (picked) {
      await this.reassignFile(fileId, picked.uri);
    }
  }

  /**
   * Manually reassign a tracked file to a new location
   */
  public async reassignFile(fileId: string, newUri: vscode.Uri): Promise<void> {
    const file = this.database.files[fileId];
    if (!file) {
      return;
    }

    const oldPath = file.path;
    const newPath = getRelativePath(newUri);

    // Update path index
    this.pathToIdMap.delete(oldPath);
    this.pathToIdMap.set(newPath, fileId);

    // Update file entry
    file.path = newPath;
    file.filename = path.basename(newUri.fsPath);
    file.status = 'ok';
    file.lastSeen = Date.now();

    // Update metadata
    const metadata = await getFileMetadata(newUri);
    file.fileSize = metadata.fileSize;
    file.lastModified = metadata.lastModified;
    file.contentSignature = metadata.contentSignature;

    this.scheduleSave();
    this._onDidChangeTags.fire({
      type: 'reassign',
      fileId,
      filePath: newPath,
    });

    vscode.window.showInformationMessage(
      `Tags reassigned to "${file.filename}"`
    );
  }

  /**
   * Remove a broken file from tracking
   */
  public dismissBrokenFile(fileId: string): void {
    const file = this.database.files[fileId];
    if (!file) {
      return;
    }

    this.pathToIdMap.delete(file.path);
    delete this.database.files[fileId];

    this.updateTagCounts();
    this.cleanupUnusedTags();
    this.scheduleSave();
    this._onDidChangeTags.fire({
      type: 'delete-file',
      fileId,
      filePath: file.path,
    });
  }

  // ================== Private Helpers ==================

  private ensureTagExists(normalizedTag: string, displayName: string): void {
    if (!this.database.tags[normalizedTag]) {
      this.database.tags[normalizedTag] = {
        name: normalizedTag,
        displayName: displayName,
        fileCount: 0,
      };
    }

    // Store display name if not already set
    if (!this.database.tagDisplayNames[normalizedTag]) {
      this.database.tagDisplayNames[normalizedTag] = displayName;
    }
  }

  private updateTagCounts(): void {
    // Reset all counts
    for (const tag of Object.values(this.database.tags)) {
      tag.fileCount = 0;
    }

    // Count files per tag
    for (const file of Object.values(this.database.files)) {
      for (const tagName of file.tags) {
        if (this.database.tags[tagName]) {
          this.database.tags[tagName].fileCount++;
        }
      }
    }
  }

  private cleanupUnusedTags(): void {
    // Remove tags with no files
    for (const [name, tag] of Object.entries(this.database.tags)) {
      if (tag.fileCount === 0) {
        delete this.database.tags[name];
        delete this.database.tagDisplayNames[name];
      }
    }
  }

  private rebuildPathIndex(): void {
    this.pathToIdMap.clear();
    for (const [id, file] of Object.entries(this.database.files)) {
      this.pathToIdMap.set(file.path, id);
    }
  }

  private setupFileWatcher(): void {
    // Watch for file deletions and renames
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');

    this.disposables.push(
      watcher,
      watcher.onDidDelete(async (uri) => {
        const relativePath = getRelativePath(uri);
        const fileId = this.pathToIdMap.get(relativePath);

        if (fileId && this.database.files[fileId]) {
          // Mark as missing, don't delete immediately
          this.database.files[fileId].status = 'missing';
          this.scheduleSave();
          this._onDidChangeTags.fire({
            type: 'update',
            fileId,
            filePath: relativePath,
          });
        }
      }),
      watcher.onDidCreate(async (uri) => {
        if (!isSupportedFile(uri)) {
          return;
        }

        // Check if this might be a moved file
        const filename = path.basename(uri.fsPath);
        for (const file of Object.values(this.database.files)) {
          if (file.status === 'missing' && file.filename === filename) {
            // Potential match - check more carefully
            const metadata = await getFileMetadata(uri);

            // Strong match: same filename and content signature
            if (
              file.contentSignature &&
              metadata.contentSignature === file.contentSignature
            ) {
              await this.reassignFile(file.id, uri);
              return;
            }

            // Weak match: same filename and size
            if (file.fileSize && metadata.fileSize === file.fileSize) {
              // Offer to reassign
              const action = await vscode.window.showInformationMessage(
                `A file "${filename}" was created that might be the missing "${file.path}". Reassign tags?`,
                'Yes',
                'No'
              );
              if (action === 'Yes') {
                await this.reassignFile(file.id, uri);
              }
              return;
            }
          }
        }
      })
    );
  }

  // ================== Storage ==================

  private getStorageUri(): vscode.Uri | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }
    return vscode.Uri.joinPath(
      workspaceFolder.uri,
      '.vscode',
      STORAGE_FILENAME
    );
  }

  private async loadDatabase(): Promise<void> {
    const storageUri = this.getStorageUri();
    if (!storageUri) {
      return;
    }

    try {
      const content = await vscode.workspace.fs.readFile(storageUri);
      const data = JSON.parse(Buffer.from(content).toString('utf8'));

      // Migration: ensure version and structure
      this.database = {
        version: data.version || 1,
        files: data.files || {},
        tags: data.tags || {},
        tagDisplayNames: data.tagDisplayNames || {},
      };

      // Rebuild derived state
      this.rebuildPathIndex();
      this.updateTagCounts();
    } catch (error) {
      // File doesn't exist or is invalid - use defaults
      this.database = { ...DEFAULT_TAG_DATABASE };
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.saveDatabase(), DEBOUNCE_SAVE_MS);
  }

  private async saveDatabase(): Promise<void> {
    const storageUri = this.getStorageUri();
    if (!storageUri) {
      return;
    }

    try {
      // Ensure .vscode directory exists
      const vscodeDirUri = vscode.Uri.joinPath(storageUri, '..');
      try {
        await vscode.workspace.fs.createDirectory(vscodeDirUri);
      } catch {
        // Directory might already exist
      }

      const content = JSON.stringify(this.database, null, 2);
      await vscode.workspace.fs.writeFile(
        storageUri,
        Buffer.from(content, 'utf8')
      );
    } catch (error) {
      console.error('Failed to save tag database:', error);
    }
  }

  // ================== Lifecycle ==================

  public dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      // Synchronous save on dispose isn't possible, but the debounced save should have run
    }

    this.disposables.forEach((d) => d.dispose());
    this._onDidChangeTags.dispose();
    TagManager.instance = undefined;
  }
}
