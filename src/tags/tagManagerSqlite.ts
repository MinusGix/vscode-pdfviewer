/**
 * TagManager (SQLite Backend) - Core service for managing file tags
 *
 * This version uses the unified SQLite database for storage.
 * Maintains the same public API as the original JSON-based TagManager.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { nanoid } from 'nanoid';
import {
  TaggedFile,
  Tag,
  TagQuery,
  TagChangeEvent,
} from './tagTypes';
import {
  getRelativePath,
  getUriFromRelativePath,
  getFileMetadata,
  fileExists,
  findRecoveryCandidates,
} from './fileIdentity';
import { getTagColor } from './tagColors';
import { LatticeDatabase } from '../database';

export class TagManagerSqlite implements vscode.Disposable {
  private static instance: TagManagerSqlite | undefined;

  private db: LatticeDatabase | null = null;
  private disposables: vscode.Disposable[] = [];
  private initialized = false;

  private readonly _onDidChangeTags = new vscode.EventEmitter<TagChangeEvent>();
  public readonly onDidChangeTags = this._onDidChangeTags.event;

  /** In-memory cache for fast path lookups */
  private pathToIdCache: Map<string, string> = new Map();

  private constructor() { }

  public static getInstance(): TagManagerSqlite {
    if (!TagManagerSqlite.instance) {
      TagManagerSqlite.instance = new TagManagerSqlite();
    }
    return TagManagerSqlite.instance;
  }

  /**
   * Initialize the tag manager - connect to database and set up watchers
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.db = await LatticeDatabase.getInstance();
    this.rebuildPathCache();
    this.setupFileWatcher();
    this.initialized = true;
  }

  /**
   * Check if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  // ================== File Operations ==================

  /**
   * Add tags to a file (creates tracking entry if needed)
   */
  public async addTags(uri: vscode.Uri, tags: string[]): Promise<void> {
    if (!this.db) throw new Error('TagManager not initialized');

    const relativePath = getRelativePath(uri);
    let fileId = this.pathToIdCache.get(relativePath);
    let isNewFile = false;

    if (!fileId) {
      // Check database
      const existingFile = this.db.getFileByPath(relativePath);
      if (existingFile) {
        fileId = existingFile.id;
        this.pathToIdCache.set(relativePath, fileId);
      }
    }

    if (!fileId) {
      // Create new file entry
      fileId = nanoid(12);
      const metadata = await getFileMetadata(uri);

      this.db.upsertFile({
        id: fileId,
        path: relativePath,
        filename: metadata.filename || path.basename(uri.fsPath),
        file_size: metadata.fileSize ?? null,
        last_modified: metadata.lastModified ?? null,
        content_signature: metadata.contentSignature ?? null,
        last_seen: Date.now(),
        status: 'ok',
      });

      this.pathToIdCache.set(relativePath, fileId);
      isNewFile = true;
    }

    // Add tags - process keeping normalized and original in sync
    const tagPairs = tags
      .map((t) => ({ normalized: t.toLowerCase().trim(), original: t }))
      .filter((pair) => pair.normalized.length > 0);

    for (const { normalized: normalizedTag, original: originalTag } of tagPairs) {
      // Ensure tag exists
      if (!this.db.getTag(normalizedTag)) {
        this.db.upsertTag(normalizedTag, originalTag);
      }

      // Add tag to file if not already present
      if (!this.db.fileHasTag(fileId, normalizedTag)) {
        this.db.addTagToFile(fileId, normalizedTag);
      }
    }

    // Update last seen
    if (!isNewFile) {
      this.db.run(
        'UPDATE files SET last_seen = ?, status = ? WHERE id = ?',
        [Date.now(), 'ok', fileId]
      );
    }

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
    if (!this.db) throw new Error('TagManager not initialized');

    const relativePath = getRelativePath(uri);
    const fileId = this.pathToIdCache.get(relativePath);

    if (!fileId) {
      return; // File not tracked
    }

    const normalizedTags = tags.map((t) => t.toLowerCase().trim());

    for (const tagName of normalizedTags) {
      this.db.removeTagFromFile(fileId, tagName);
    }

    // Check if file should be removed (no tags and doesn't exist)
    const remainingTags = this.db.getTagInstancesForFile(fileId);
    if (remainingTags.length === 0) {
      const exists = await fileExists(uri);
      if (!exists) {
        this.db.deleteFile(fileId);
        this.pathToIdCache.delete(relativePath);
      }
    }

    // Clean up unused tags
    this.cleanupUnusedTags();

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
    if (!this.db) throw new Error('TagManager not initialized');

    const relativePath = getRelativePath(uri);
    const fileId = this.pathToIdCache.get(relativePath);

    if (fileId) {
      // Remove all existing tags
      const existingTags = this.db.getTagsForFile(fileId);
      for (const tag of existingTags) {
        this.db.removeTagFromFile(fileId, tag.name);
      }
    }

    // Add new tags
    await this.addTags(uri, tags);
  }

  /**
   * Get all tags for a file
   */
  public getTags(uri: vscode.Uri): string[] {
    if (!this.db) return [];

    const relativePath = getRelativePath(uri);
    const fileId = this.pathToIdCache.get(relativePath);

    if (!fileId) {
      return [];
    }

    const tags = this.db.getTagsForFile(fileId);
    return tags.map((t) => t.name);
  }

  /**
   * Get tags with their display names for a file
   */
  public getTagsWithDisplayNames(
    uri: vscode.Uri
  ): Array<{ name: string; displayName: string }> {
    if (!this.db) return [];

    const relativePath = getRelativePath(uri);
    const fileId = this.pathToIdCache.get(relativePath);

    if (!fileId) {
      return [];
    }

    const tags = this.db.getTagsForFile(fileId);
    return tags.map((t) => ({
      name: t.name,
      displayName: t.display_name,
    }));
  }

  /**
   * Check if a file has a specific tag
   */
  public hasTag(uri: vscode.Uri, tag: string): boolean {
    if (!this.db) return false;

    const relativePath = getRelativePath(uri);
    const fileId = this.pathToIdCache.get(relativePath);

    if (!fileId) {
      return false;
    }

    return this.db.fileHasTag(fileId, tag.toLowerCase().trim());
  }

  // ================== Tag Operations ==================

  /**
   * Get all tags in the system
   */
  public getAllTags(): Tag[] {
    if (!this.db) return [];

    const tags = this.db.getAllTagsWithCounts();
    return tags.map((t) => ({
      name: t.name,
      displayName: t.display_name,
      color: t.color ?? undefined,
      fileCount: t.fileCount,
    }));
  }

  /**
   * Get files with a specific tag
   */
  public getFilesWithTag(tag: string): TaggedFile[] {
    if (!this.db) return [];

    const normalizedTag = tag.toLowerCase().trim();
    const files = this.db.getFilesWithTag(normalizedTag);

    return files.map((f) => this.dbFileToTaggedFile(f));
  }

  /**
   * Rename a tag across all files
   */
  public async renameTag(oldName: string, newName: string): Promise<void> {
    if (!this.db) throw new Error('TagManager not initialized');

    const oldNormalized = oldName.toLowerCase().trim();
    const newNormalized = newName.toLowerCase().trim();

    if (oldNormalized === newNormalized) {
      // Just updating display name
      this.db.run(
        'UPDATE tags SET display_name = ? WHERE name = ?',
        [newName, oldNormalized]
      );
    } else {
      this.db.renameTag(oldNormalized, newNormalized, newName);
    }

    this._onDidChangeTags.fire({ type: 'update' });
  }

  /**
   * Delete a tag from all files
   */
  public async deleteTag(tagName: string): Promise<void> {
    if (!this.db) throw new Error('TagManager not initialized');

    const normalized = tagName.toLowerCase().trim();
    this.db.deleteTag(normalized);

    this._onDidChangeTags.fire({ type: 'update' });
  }

  /**
   * Set a custom color for a tag
   */
  public setTagColor(tagName: string, color: string | null): void {
    if (!this.db) throw new Error('TagManager not initialized');

    const normalized = tagName.toLowerCase().trim();

    // Ensure tag exists
    if (!this.db.getTag(normalized)) {
      this.db.upsertTag(normalized, tagName);
    }

    this.db.setTagColor(normalized, color);

    this._onDidChangeTags.fire({ type: 'update' });
  }

  /**
   * Get the color for a tag (custom or auto-generated)
   */
  public getTagColorValue(tagName: string): string {
    if (!this.db) return getTagColor(tagName);

    const normalized = tagName.toLowerCase().trim();
    const tag = this.db.getTag(normalized);
    return getTagColor(tagName, tag?.color ?? undefined);
  }

  // ================== File Query Operations ==================

  /**
   * Find files matching a tag query
   */
  public findFiles(query: TagQuery): TaggedFile[] {
    if (!this.db) return [];

    // Start with all files
    let fileIds: Set<string> | null = null;

    if (query.untagged) {
      // Find files with no tags
      const allFiles = this.db.getAllFiles();
      return allFiles
        .filter((f) => this.db!.getTagInstancesForFile(f.id).length === 0)
        .map((f) => this.dbFileToTaggedFile(f));
    }

    if (query.allOf && query.allOf.length > 0) {
      // Files must have ALL these tags
      for (const tag of query.allOf) {
        const filesWithTag = new Set<string>(
          this.db.getFilesWithTag(tag.toLowerCase().trim()).map((f) => f.id)
        );
        if (fileIds === null) {
          fileIds = filesWithTag;
        } else {
          const intersection = new Set<string>();
          for (const id of fileIds) {
            if (filesWithTag.has(id)) {
              intersection.add(id);
            }
          }
          fileIds = intersection;
        }
      }
    }

    if (query.anyOf && query.anyOf.length > 0) {
      // Files must have ANY of these tags
      const anyOfIds = new Set<string>();
      for (const tag of query.anyOf) {
        for (const file of this.db.getFilesWithTag(tag.toLowerCase().trim())) {
          anyOfIds.add(file.id);
        }
      }
      if (fileIds === null) {
        fileIds = anyOfIds;
      } else {
        const intersection = new Set<string>();
        for (const id of fileIds) {
          if (anyOfIds.has(id)) {
            intersection.add(id);
          }
        }
        fileIds = intersection;
      }
    }

    if (query.noneOf && query.noneOf.length > 0) {
      // Files must have NONE of these tags
      const excludeIds = new Set<string>();
      for (const tag of query.noneOf) {
        for (const file of this.db.getFilesWithTag(tag.toLowerCase().trim())) {
          excludeIds.add(file.id);
        }
      }
      if (fileIds === null) {
        fileIds = new Set<string>(this.db.getAllFiles().map((f) => f.id));
      }
      const filtered = new Set<string>();
      for (const id of fileIds) {
        if (!excludeIds.has(id)) {
          filtered.add(id);
        }
      }
      fileIds = filtered;
    }

    if (fileIds === null) {
      // No filters, return all files
      return this.db.getAllFiles().map((f) => this.dbFileToTaggedFile(f));
    }

    // Get full file records
    const results: TaggedFile[] = [];
    for (const id of fileIds) {
      const file = this.db.getFile(id);
      if (file) {
        results.push(this.dbFileToTaggedFile(file));
      }
    }

    return results;
  }

  /**
   * Get all tracked files
   */
  public getAllTrackedFiles(): TaggedFile[] {
    if (!this.db) return [];

    return this.db.getAllFiles().map((f) => this.dbFileToTaggedFile(f));
  }

  /**
   * Get files with missing/broken status
   */
  public getBrokenFiles(): TaggedFile[] {
    if (!this.db) return [];

    const missing = this.db.getFilesByStatus('missing');
    const moved = this.db.getFilesByStatus('moved');

    return [...missing, ...moved].map((f) => this.dbFileToTaggedFile(f));
  }

  // ================== File Recovery ==================

  /**
   * Check all tracked files and update their status
   */
  public async checkAllFiles(): Promise<void> {
    if (!this.db) return;

    const files = this.db.getAllFiles();

    for (const file of files) {
      const uri = getUriFromRelativePath(file.path);
      if (!uri) {
        this.db.run('UPDATE files SET status = ? WHERE id = ?', ['missing', file.id]);
        continue;
      }

      const exists = await fileExists(uri);
      if (exists) {
        const metadata = await getFileMetadata(uri);
        this.db.run(
          `UPDATE files SET 
            status = 'ok', 
            last_seen = ?, 
            file_size = ?, 
            last_modified = ?, 
            content_signature = ?
           WHERE id = ?`,
          [
            Date.now(),
            metadata.fileSize ?? null,
            metadata.lastModified ?? null,
            metadata.contentSignature ?? null,
            file.id,
          ]
        );
      } else {
        this.db.run('UPDATE files SET status = ? WHERE id = ?', ['missing', file.id]);
      }
    }

    this._onDidChangeTags.fire({ type: 'update' });
  }

  /**
   * Try to find a missing file and offer recovery options
   */
  public async findMissingFile(fileId: string): Promise<void> {
    if (!this.db) return;

    const dbFile = this.db.getFile(fileId);
    if (!dbFile || dbFile.status === 'ok') {
      return;
    }

    // Convert to TaggedFile for recovery system
    const file = this.dbFileToTaggedFile(dbFile);
    const candidates = await findRecoveryCandidates(file);

    if (candidates.length === 0) {
      vscode.window.showInformationMessage(
        `No potential matches found for "${file.filename}". You can manually locate it.`
      );
      return;
    }

    // High confidence match
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

    // Show picker
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
    if (!this.db) return;

    const dbFile = this.db.getFile(fileId);
    if (!dbFile) {
      return;
    }

    const oldPath = dbFile.path;
    const newPath = getRelativePath(newUri);

    // Update cache
    this.pathToIdCache.delete(oldPath);
    this.pathToIdCache.set(newPath, fileId);

    // Get new metadata
    const metadata = await getFileMetadata(newUri);

    // Update database
    this.db.run(
      `UPDATE files SET 
        path = ?, 
        filename = ?, 
        status = 'ok', 
        last_seen = ?,
        file_size = ?,
        last_modified = ?,
        content_signature = ?
       WHERE id = ?`,
      [
        newPath,
        path.basename(newUri.fsPath),
        Date.now(),
        metadata.fileSize ?? null,
        metadata.lastModified ?? null,
        metadata.contentSignature ?? null,
        fileId,
      ]
    );

    this._onDidChangeTags.fire({
      type: 'reassign',
      fileId,
      filePath: newPath,
    });

    vscode.window.showInformationMessage(
      `Tags reassigned to "${path.basename(newUri.fsPath)}"`
    );
  }

  /**
   * Remove a broken file from tracking
   */
  public dismissBrokenFile(fileId: string): void {
    if (!this.db) return;

    const dbFile = this.db.getFile(fileId);
    if (!dbFile) {
      return;
    }

    this.pathToIdCache.delete(dbFile.path);
    this.db.deleteFile(fileId);
    this.cleanupUnusedTags();

    this._onDidChangeTags.fire({
      type: 'delete-file',
      fileId,
      filePath: dbFile.path,
    });
  }

  // ================== Private Helpers ==================

  private dbFileToTaggedFile(dbFile: {
    id: string;
    path: string;
    filename: string;
    file_size: number | null;
    last_modified: number | null;
    content_signature: string | null;
    last_seen: number | null;
    status: 'ok' | 'missing' | 'moved';
  }): TaggedFile {
    const tags = this.db
      ? this.db.getTagsForFile(dbFile.id).map((t) => t.name)
      : [];

    return {
      id: dbFile.id,
      path: dbFile.path,
      filename: dbFile.filename,
      fileSize: dbFile.file_size ?? undefined,
      lastModified: dbFile.last_modified ?? undefined,
      contentSignature: dbFile.content_signature ?? undefined,
      lastSeen: dbFile.last_seen ?? undefined,
      status: dbFile.status,
      tags,
    };
  }

  private cleanupUnusedTags(): void {
    if (!this.db) return;

    // Get all tags with counts
    const tagsWithCounts = this.db.getAllTagsWithCounts();

    // Delete tags with no files
    for (const tag of tagsWithCounts) {
      if (tag.fileCount === 0) {
        this.db.deleteTag(tag.name);
      }
    }
  }

  private rebuildPathCache(): void {
    if (!this.db) return;

    this.pathToIdCache.clear();
    const files = this.db.getAllFiles();
    for (const file of files) {
      this.pathToIdCache.set(file.path, file.id);
    }
  }

  private setupFileWatcher(): void {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');

    this.disposables.push(
      watcher,
      watcher.onDidDelete(async (uri) => {
        if (!this.db) return;

        const relativePath = getRelativePath(uri);
        const fileId = this.pathToIdCache.get(relativePath);

        if (fileId) {
          this.db.run('UPDATE files SET status = ? WHERE id = ?', [
            'missing',
            fileId,
          ]);
          this._onDidChangeTags.fire({
            type: 'update',
            fileId,
            filePath: relativePath,
          });
        }
      }),
      watcher.onDidCreate(async (uri) => {
        if (!this.db) {
          return;
        }

        // Check if this might be a moved file
        const filename = path.basename(uri.fsPath);
        const missingFiles = this.db.getFilesByStatus('missing');

        for (const dbFile of missingFiles) {
          if (dbFile.filename === filename) {
            const metadata = await getFileMetadata(uri);

            // Strong match: same content signature
            if (
              dbFile.content_signature &&
              metadata.contentSignature === dbFile.content_signature
            ) {
              await this.reassignFile(dbFile.id, uri);
              return;
            }

            // Weak match: same size
            if (
              dbFile.file_size &&
              metadata.fileSize === dbFile.file_size
            ) {
              const action = await vscode.window.showInformationMessage(
                `A file "${filename}" was created that might be the missing "${dbFile.path}". Reassign tags?`,
                'Yes',
                'No'
              );
              if (action === 'Yes') {
                await this.reassignFile(dbFile.id, uri);
              }
              return;
            }
          }
        }
      })
    );
  }

  // ================== Lifecycle ==================

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this._onDidChangeTags.dispose();
    TagManagerSqlite.instance = undefined;
  }
}

