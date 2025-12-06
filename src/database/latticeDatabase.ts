/**
 * LatticeDatabase - Main database class for all Lattice storage
 *
 * Uses sql.js (WASM SQLite) for cross-platform compatibility.
 * All Lattice features share this single database.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION, DROP_ALL_SQL } from './schema';
import {
  DbFile,
  DbTag,
  DbTagAlias,
  DbTagInstance,
  DbCard,
  DbDocumentMetadata,
  DbNotesAssociation,
  DbFolderRule,
  DbFileTagExclusion,
  DbViewMode,
  DbTagTemplate,
  TagInstanceWithMetadata,
  FileWithTags,
  TagWithCount,
  TagHierarchyNode,
  TagTemplate,
  TagExpression,
  FolderRule,
  MigrationSource,
} from './types';
import { nanoid } from 'nanoid';

/**
 * Extension URI for locating bundled files
 */
let extensionUri: vscode.Uri | null = null;

/**
 * Set the extension URI (call from activate)
 */
export function setExtensionUri(uri: vscode.Uri): void {
  extensionUri = uri;
}

/**
 * Database file location
 */
const DB_FILENAME = 'lattice.db';
const DB_BACKUP_PREFIX = 'lattice.db.backup-';
const MAX_BACKUPS = 5;

/**
 * Singleton database instance
 */
let instance: LatticeDatabase | null = null;

/**
 * LatticeDatabase provides all database operations for Lattice
 */
export class LatticeDatabase {
  private db: Database | null = null;
  private SQL: SqlJsStatic | null = null;
  private dbPath: string;
  private workspaceRoot: string;
  private initialized = false;
  private dirty = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  private constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.dbPath = path.join(workspaceRoot, '.vscode', DB_FILENAME);
  }

  /**
   * Get or create the singleton database instance
   */
  public static async getInstance(
    workspaceRoot?: string
  ): Promise<LatticeDatabase> {
    if (!instance) {
      const root =
        workspaceRoot ??
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        throw new Error('No workspace folder found');
      }
      instance = new LatticeDatabase(root);
      await instance.initialize();
    }
    return instance;
  }

  /**
   * Check if the database has been initialized
   */
  public static isInitialized(): boolean {
    return instance?.initialized ?? false;
  }

  /**
   * Reset the singleton (for testing)
   */
  public static async reset(): Promise<void> {
    if (instance) {
      await instance.close();
      instance = null;
    }
  }

  /**
   * Initialize the database: load sql.js, open/create database, run migrations
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load sql.js with the bundled WASM file
      // Try multiple locations for the WASM file
      let wasmBinary: ArrayBuffer | undefined;

      // Try to load from extension dist folder
      if (extensionUri) {
        const wasmPath = vscode.Uri.joinPath(extensionUri, 'dist', 'sql-wasm.wasm');
        try {
          const wasmData = await vscode.workspace.fs.readFile(wasmPath);
          wasmBinary = wasmData.buffer.slice(
            wasmData.byteOffset,
            wasmData.byteOffset + wasmData.byteLength
          );
        } catch {
          console.log('WASM not found at extension path, trying node_modules');
        }
      }

      // Fallback: try node_modules path (for development)
      if (!wasmBinary) {
        try {
          const nodeModulesWasm = require.resolve('sql.js/dist/sql-wasm.wasm');
          wasmBinary = fs.readFileSync(nodeModulesWasm);
        } catch {
          console.log('WASM not found in node_modules');
        }
      }

      // Initialize sql.js with the WASM binary
      this.SQL = await initSqlJs({
        wasmBinary,
      });

      // Ensure .vscode directory exists
      const vscodeDir = path.dirname(this.dbPath);
      try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscodeDir));
      } catch {
        // Directory may already exist
      }

      // Try to load existing database
      let dbData: Uint8Array | null = null;
      try {
        const uri = vscode.Uri.file(this.dbPath);
        dbData = await vscode.workspace.fs.readFile(uri);
      } catch {
        // Database doesn't exist yet, will create new one
      }

      // Create database
      if (dbData && dbData.length > 0) {
        this.db = new this.SQL.Database(dbData);
      } else {
        this.db = new this.SQL.Database();
      }

      // Run schema creation
      await this.runSchema();

      // Check and run migrations if needed
      await this.checkMigrations();

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize LatticeDatabase:', error);
      throw error;
    }
  }

  /**
   * Run the schema SQL to ensure all tables exist
   */
  private async runSchema(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(SCHEMA_SQL);
    this.markDirty();
  }

  /**
   * Check current schema version and run migrations if needed
   */
  private async checkMigrations(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Get current schema version
    let currentVersion = 0;
    try {
      const result = this.db.exec(
        "SELECT value FROM schema_info WHERE key = 'version'"
      );
      if (result.length > 0 && result[0].values.length > 0) {
        currentVersion = parseInt(result[0].values[0][0] as string, 10);
      }
    } catch {
      // Table might not exist yet
    }

    // Run migrations if needed
    if (currentVersion < SCHEMA_VERSION) {
      await this.runMigrations(currentVersion, SCHEMA_VERSION);
    }

    // Update version
    this.db.run(
      `INSERT OR REPLACE INTO schema_info (key, value) VALUES ('version', ?)`,
      [SCHEMA_VERSION.toString()]
    );
    this.markDirty();
  }

  /**
   * Run migrations between versions
   */
  private async runMigrations(
    fromVersion: number,
    toVersion: number
  ): Promise<void> {
    console.log(`Migrating database from v${fromVersion} to v${toVersion}`);

    // Future migrations would go here
    // For now, we just run the full schema which is idempotent

    // Backup before migration
    await this.backup();
  }

  /**
   * Mark database as dirty (needs saving)
   */
  private markDirty(): void {
    this.dirty = true;
    this.scheduleSave();
  }

  /**
   * Schedule a debounced save
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.save().catch(console.error);
    }, 1000); // Save after 1 second of inactivity
  }

  /**
   * Save the database to disk
   */
  public async save(): Promise<void> {
    if (!this.db || !this.dirty) return;

    try {
      const data = this.db.export();
      const uri = vscode.Uri.file(this.dbPath);
      await vscode.workspace.fs.writeFile(uri, data);
      this.dirty = false;
    } catch (error) {
      console.error('Failed to save database:', error);
      throw error;
    }
  }

  /**
   * Force an immediate save
   */
  public async forceSave(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.dirty = true;
    await this.save();
  }

  /**
   * Create a backup of the database
   */
  public async backup(): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `${DB_BACKUP_PREFIX}${timestamp}`;
    const backupPath = path.join(
      path.dirname(this.dbPath),
      backupFilename
    );

    const data = this.db.export();
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(backupPath),
      data
    );

    // Prune old backups
    await this.pruneBackups();

    return backupPath;
  }

  /**
   * Remove old backups keeping only the most recent ones
   */
  private async pruneBackups(): Promise<void> {
    const backupDir = path.dirname(this.dbPath);
    try {
      const entries = await vscode.workspace.fs.readDirectory(
        vscode.Uri.file(backupDir)
      );
      const backups = entries
        .filter(
          ([name, type]) =>
            type === vscode.FileType.File &&
            name.startsWith(DB_BACKUP_PREFIX)
        )
        .map(([name]) => name)
        .sort()
        .reverse();

      // Remove backups beyond the limit
      for (const backup of backups.slice(MAX_BACKUPS)) {
        try {
          await vscode.workspace.fs.delete(
            vscode.Uri.file(path.join(backupDir, backup))
          );
        } catch {
          // Ignore deletion errors
        }
      }
    } catch {
      // Ignore errors reading backup directory
    }
  }

  /**
   * Export database to JSON for backup/sharing
   */
  public async exportToJson(): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');

    const exportData: Record<string, unknown[]> = {};

    // Export each table
    const tables = [
      'files',
      'tags',
      'tag_aliases',
      'tag_instances',
      'folder_rules',
      'view_modes',
      'tag_templates',
      'cards',
      'document_metadata',
      'notes_associations',
    ];

    for (const table of tables) {
      try {
        const result = this.db.exec(`SELECT * FROM ${table}`);
        if (result.length > 0) {
          const columns = result[0].columns;
          exportData[table] = result[0].values.map(
            (row: (string | number | Uint8Array | null)[]) => {
              const obj: Record<string, unknown> = {};
              columns.forEach((col: string, i: number) => {
                obj[col] = row[i];
              });
              return obj;
            }
          );
        } else {
          exportData[table] = [];
        }
      } catch {
        exportData[table] = [];
      }
    }

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Close the database
   */
  public async close(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    await this.save();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  /**
   * Run a SQL statement with parameters
   */
  public run(sql: string, params: unknown[] = []): { changes: number } {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(sql, params as (string | number | Uint8Array | null)[]);
    this.markDirty();
    return { changes: this.db.getRowsModified() };
  }

  /**
   * Execute a SQL query and return results
   */
  public query<T>(sql: string, params: unknown[] = []): T[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | Uint8Array | null)[]);

    const results: T[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as T;
      results.push(row);
    }
    stmt.free();

    return results;
  }

  /**
   * Execute a SQL query and return the first result
   */
  public queryOne<T>(sql: string, params: unknown[] = []): T | null {
    const results = this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Run multiple statements in a transaction
   */
  public transaction<T>(fn: () => T): T {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run('BEGIN TRANSACTION');
    try {
      const result = fn();
      this.db.run('COMMIT');
      this.markDirty();
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  // ============================================================
  // FILE OPERATIONS
  // ============================================================

  /**
   * Insert or update a file record
   */
  public upsertFile(file: Omit<DbFile, 'created_at'> & { created_at?: number }): void {
    const now = Date.now();
    this.run(
      `INSERT INTO files (id, path, filename, file_size, last_modified, content_signature, last_seen, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         path = excluded.path,
         filename = excluded.filename,
         file_size = excluded.file_size,
         last_modified = excluded.last_modified,
         content_signature = excluded.content_signature,
         last_seen = excluded.last_seen,
         status = excluded.status`,
      [
        file.id,
        file.path,
        file.filename,
        file.file_size,
        file.last_modified,
        file.content_signature,
        file.last_seen,
        file.status,
        file.created_at ?? now,
      ]
    );
  }

  /**
   * Get a file by ID
   */
  public getFile(id: string): DbFile | null {
    return this.queryOne<DbFile>('SELECT * FROM files WHERE id = ?', [id]);
  }

  /**
   * Get a file by path
   */
  public getFileByPath(filePath: string): DbFile | null {
    return this.queryOne<DbFile>('SELECT * FROM files WHERE path = ?', [
      filePath,
    ]);
  }

  /**
   * Get all files
   */
  public getAllFiles(): DbFile[] {
    return this.query<DbFile>('SELECT * FROM files ORDER BY path');
  }

  /**
   * Get files by status
   */
  public getFilesByStatus(status: DbFile['status']): DbFile[] {
    return this.query<DbFile>('SELECT * FROM files WHERE status = ?', [
      status,
    ]);
  }

  /**
   * Delete a file and its tag instances
   */
  public deleteFile(id: string): void {
    this.run('DELETE FROM files WHERE id = ?', [id]);
  }

  /**
   * Update file path (for move/rename tracking)
   */
  public updateFilePath(id: string, newPath: string): void {
    this.run(
      'UPDATE files SET path = ?, filename = ?, last_seen = ? WHERE id = ?',
      [newPath, path.basename(newPath), Date.now(), id]
    );
  }

  // ============================================================
  // TAG OPERATIONS
  // ============================================================

  /**
   * Insert or update a tag
   */
  public upsertTag(
    name: string,
    displayName: string,
    color?: string | null,
    parentTag?: string | null,
    visibility?: DbTag['visibility']
  ): void {
    const now = Date.now();
    this.run(
      `INSERT INTO tags (name, display_name, color, parent_tag, visibility, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         display_name = excluded.display_name,
         color = COALESCE(excluded.color, tags.color),
         parent_tag = COALESCE(excluded.parent_tag, tags.parent_tag),
         visibility = COALESCE(excluded.visibility, tags.visibility)`,
      [
        name.toLowerCase(),
        displayName,
        color ?? null,
        parentTag ?? null,
        visibility ?? 'normal',
        now,
      ]
    );
  }

  /**
   * Get a tag by name
   */
  public getTag(name: string): DbTag | null {
    return this.queryOne<DbTag>('SELECT * FROM tags WHERE name = ?', [
      name.toLowerCase(),
    ]);
  }

  /**
   * Get all tags with file counts
   */
  public getAllTagsWithCounts(): TagWithCount[] {
    return this.query<TagWithCount>(
      `SELECT t.*, COUNT(DISTINCT ti.file_id) as fileCount
       FROM tags t
       LEFT JOIN tag_instances ti ON t.name = ti.tag_name
       GROUP BY t.name
       ORDER BY t.display_name`
    );
  }

  /**
   * Get tags for a file
   */
  public getTagsForFile(fileId: string): DbTag[] {
    return this.query<DbTag>(
      `SELECT DISTINCT t.*
       FROM tags t
       JOIN tag_instances ti ON t.name = ti.tag_name
       WHERE ti.file_id = ?
       ORDER BY t.display_name`,
      [fileId]
    );
  }

  /**
   * Delete a tag and all its instances
   */
  public deleteTag(name: string): void {
    this.run('DELETE FROM tags WHERE name = ?', [name.toLowerCase()]);
  }

  /**
   * Set tag color
   */
  public setTagColor(name: string, color: string | null): void {
    this.run('UPDATE tags SET color = ? WHERE name = ?', [
      color,
      name.toLowerCase(),
    ]);
  }

  /**
   * Rename a tag
   */
  public renameTag(oldName: string, newName: string, newDisplayName: string): void {
    this.transaction(() => {
      // Update tag_instances first
      this.run('UPDATE tag_instances SET tag_name = ? WHERE tag_name = ?', [
        newName.toLowerCase(),
        oldName.toLowerCase(),
      ]);
      // Update parent references
      this.run('UPDATE tags SET parent_tag = ? WHERE parent_tag = ?', [
        newName.toLowerCase(),
        oldName.toLowerCase(),
      ]);
      // Update the tag itself
      this.run('UPDATE tags SET name = ?, display_name = ? WHERE name = ?', [
        newName.toLowerCase(),
        newDisplayName,
        oldName.toLowerCase(),
      ]);
    });
  }

  // ============================================================
  // TAG INSTANCE OPERATIONS
  // ============================================================

  /**
   * Add a tag to a file
   */
  public addTagToFile(
    fileId: string,
    tagName: string,
    parentInstanceId?: string,
    metadata?: Record<string, unknown>
  ): string {
    const id = nanoid();
    const now = Date.now();
    this.run(
      `INSERT INTO tag_instances (id, file_id, tag_name, parent_instance_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        fileId,
        tagName.toLowerCase(),
        parentInstanceId ?? null,
        metadata ? JSON.stringify(metadata) : null,
        now,
      ]
    );
    return id;
  }

  /**
   * Remove a tag from a file
   */
  public removeTagFromFile(fileId: string, tagName: string): void {
    this.run(
      'DELETE FROM tag_instances WHERE file_id = ? AND tag_name = ?',
      [fileId, tagName.toLowerCase()]
    );
  }

  /**
   * Remove a specific tag instance
   */
  public removeTagInstance(instanceId: string): void {
    this.run('DELETE FROM tag_instances WHERE id = ?', [instanceId]);
  }

  /**
   * Get tag instances for a file
   */
  public getTagInstancesForFile(fileId: string): TagInstanceWithMetadata[] {
    const instances = this.query<DbTagInstance>(
      'SELECT * FROM tag_instances WHERE file_id = ? ORDER BY created_at',
      [fileId]
    );
    return instances.map((inst) => ({
      ...inst,
      metadata: inst.metadata ? JSON.parse(inst.metadata) : null,
    }));
  }

  /**
   * Get files with a specific tag
   */
  public getFilesWithTag(tagName: string): DbFile[] {
    return this.query<DbFile>(
      `SELECT DISTINCT f.*
       FROM files f
       JOIN tag_instances ti ON f.id = ti.file_id
       WHERE ti.tag_name = ?
       ORDER BY f.path`,
      [tagName.toLowerCase()]
    );
  }

  /**
   * Check if a file has a specific tag
   */
  public fileHasTag(fileId: string, tagName: string): boolean {
    const result = this.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM tag_instances WHERE file_id = ? AND tag_name = ?',
      [fileId, tagName.toLowerCase()]
    );
    return (result?.count ?? 0) > 0;
  }

  // ============================================================
  // CARD OPERATIONS (for SRS)
  // ============================================================

  /**
   * Insert or update a card
   */
  public upsertCard(card: Omit<DbCard, 'created_at'> & { created_at?: number }): void {
    const now = Date.now();
    this.run(
      `INSERT INTO cards (id, file_path, fsrs_state, last_review_date, deleted, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         file_path = excluded.file_path,
         fsrs_state = excluded.fsrs_state,
         last_review_date = excluded.last_review_date,
         deleted = excluded.deleted`,
      [
        card.id,
        card.file_path,
        card.fsrs_state,
        card.last_review_date,
        card.deleted,
        card.created_at ?? now,
      ]
    );
  }

  /**
   * Get a card by ID
   */
  public getCard(id: string): DbCard | null {
    return this.queryOne<DbCard>('SELECT * FROM cards WHERE id = ?', [id]);
  }

  /**
   * Get all non-deleted cards
   */
  public getAllCards(): DbCard[] {
    return this.query<DbCard>(
      'SELECT * FROM cards WHERE deleted = 0 ORDER BY id'
    );
  }

  /**
   * Mark a card as deleted
   */
  public markCardDeleted(id: string): void {
    this.run('UPDATE cards SET deleted = 1 WHERE id = ?', [id]);
  }

  // ============================================================
  // DOCUMENT METADATA OPERATIONS
  // ============================================================

  /**
   * Set document title
   */
  public setDocumentTitle(uri: string, title: string | null): void {
    if (title) {
      this.run(
        `INSERT INTO document_metadata (uri, title)
         VALUES (?, ?)
         ON CONFLICT(uri) DO UPDATE SET title = excluded.title`,
        [uri, title]
      );
    } else {
      this.run('DELETE FROM document_metadata WHERE uri = ?', [uri]);
    }
  }

  /**
   * Get document title
   */
  public getDocumentTitle(uri: string): string | null {
    const result = this.queryOne<DbDocumentMetadata>(
      'SELECT * FROM document_metadata WHERE uri = ?',
      [uri]
    );
    return result?.title ?? null;
  }

  /**
   * Get all document titles
   */
  public getAllDocumentTitles(): Record<string, string> {
    const results = this.query<DbDocumentMetadata>(
      'SELECT * FROM document_metadata WHERE title IS NOT NULL'
    );
    const titles: Record<string, string> = {};
    for (const row of results) {
      if (row.title) {
        titles[row.uri] = row.title;
      }
    }
    return titles;
  }

  // ============================================================
  // NOTES ASSOCIATION OPERATIONS
  // ============================================================

  /**
   * Set notes association for a PDF
   */
  public setNotesAssociation(pdfPath: string, notesPath: string): void {
    this.run(
      `INSERT INTO notes_associations (pdf_path, notes_path, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(pdf_path) DO UPDATE SET notes_path = excluded.notes_path`,
      [pdfPath, notesPath, Date.now()]
    );
  }

  /**
   * Get notes association for a PDF
   */
  public getNotesAssociation(pdfPath: string): string | null {
    const result = this.queryOne<DbNotesAssociation>(
      'SELECT * FROM notes_associations WHERE pdf_path = ?',
      [pdfPath]
    );
    return result?.notes_path ?? null;
  }

  /**
   * Get all notes associations
   */
  public getAllNotesAssociations(): Record<string, string> {
    const results = this.query<DbNotesAssociation>(
      'SELECT * FROM notes_associations'
    );
    const associations: Record<string, string> = {};
    for (const row of results) {
      associations[row.pdf_path] = row.notes_path;
    }
    return associations;
  }

  /**
   * Remove notes association
   */
  public removeNotesAssociation(pdfPath: string): void {
    this.run('DELETE FROM notes_associations WHERE pdf_path = ?', [pdfPath]);
  }

  // ============================================================
  // VIEW MODE OPERATIONS
  // ============================================================

  /**
   * Get the active view mode
   */
  public getActiveViewMode(): DbViewMode | null {
    return this.queryOne<DbViewMode>(
      'SELECT * FROM view_modes WHERE is_active = 1'
    );
  }

  /**
   * Set the active view mode
   */
  public setActiveViewMode(id: string | null): void {
    this.transaction(() => {
      this.run('UPDATE view_modes SET is_active = 0');
      if (id) {
        this.run('UPDATE view_modes SET is_active = 1 WHERE id = ?', [id]);
      }
    });
  }

  // ============================================================
  // FOLDER RULE OPERATIONS
  // ============================================================

  /**
   * Get folder rules that apply to a path
   */
  public getFolderRulesForPath(filePath: string): DbFolderRule[] {
    // Get all rules and filter by path prefix
    const allRules = this.query<DbFolderRule>(
      'SELECT * FROM folder_rules ORDER BY priority DESC'
    );

    return allRules.filter((rule) => {
      const folderPath = rule.folder_path;
      if (rule.recursive) {
        return filePath.startsWith(folderPath);
      } else {
        return path.dirname(filePath) === folderPath;
      }
    });
  }

  /**
   * Get inherited tags for a file path
   */
  public getInheritedTags(filePath: string): string[] {
    const rules = this.getFolderRulesForPath(filePath);
    const tags = new Set<string>();

    for (const rule of rules) {
      const inheritedTags = JSON.parse(rule.inherited_tags) as string[];
      for (const tag of inheritedTags) {
        tags.add(tag.toLowerCase());
      }
    }

    return Array.from(tags);
  }

  /**
   * Get all folder rules
   */
  public getAllFolderRules(): FolderRule[] {
    const dbRules = this.query<DbFolderRule>(
      'SELECT * FROM folder_rules ORDER BY priority DESC, folder_path ASC'
    );
    return dbRules.map((r) => this.parseFolderRule(r));
  }

  /**
   * Get a folder rule by path
   */
  public getFolderRule(folderPath: string): FolderRule | null {
    const results = this.query<DbFolderRule>(
      'SELECT * FROM folder_rules WHERE folder_path = ?',
      [folderPath]
    );
    return results.length > 0 ? this.parseFolderRule(results[0]) : null;
  }

  /**
   * Create a new folder rule
   */
  public createFolderRule(
    folderPath: string,
    inheritedTags: string[],
    options: { recursive?: boolean; priority?: number } = {}
  ): boolean {
    const { recursive = true, priority = 0 } = options;

    try {
      this.run(
        `INSERT INTO folder_rules (folder_path, inherited_tags, recursive, priority, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          folderPath,
          JSON.stringify(inheritedTags.map((t) => t.toLowerCase())),
          recursive ? 1 : 0,
          priority,
          Date.now(),
        ]
      );
      return true;
    } catch {
      // Already exists
      return false;
    }
  }

  /**
   * Update a folder rule
   */
  public updateFolderRule(
    folderPath: string,
    updates: {
      inheritedTags?: string[];
      recursive?: boolean;
      priority?: number;
    }
  ): boolean {
    const existing = this.getFolderRule(folderPath);
    if (!existing) {
      return false;
    }

    const newTags = updates.inheritedTags ?? existing.inheritedTags;
    const newRecursive = updates.recursive ?? existing.recursive;
    const newPriority = updates.priority ?? existing.priority;

    this.run(
      `UPDATE folder_rules 
       SET inherited_tags = ?, recursive = ?, priority = ?
       WHERE folder_path = ?`,
      [
        JSON.stringify(newTags.map((t) => t.toLowerCase())),
        newRecursive ? 1 : 0,
        newPriority,
        folderPath,
      ]
    );
    return true;
  }

  /**
   * Delete a folder rule
   */
  public deleteFolderRule(folderPath: string): boolean {
    const result = this.run(
      'DELETE FROM folder_rules WHERE folder_path = ?',
      [folderPath]
    );
    return result.changes > 0;
  }

  /**
   * Add a tag to a folder rule's inherited tags
   */
  public addTagToFolderRule(folderPath: string, tag: string): boolean {
    const existing = this.getFolderRule(folderPath);
    if (!existing) {
      return false;
    }

    const normalizedTag = tag.toLowerCase();
    if (existing.inheritedTags.includes(normalizedTag)) {
      return true; // Already has this tag
    }

    const newTags = [...existing.inheritedTags, normalizedTag];
    return this.updateFolderRule(folderPath, { inheritedTags: newTags });
  }

  /**
   * Remove a tag from a folder rule's inherited tags
   */
  public removeTagFromFolderRule(folderPath: string, tag: string): boolean {
    const existing = this.getFolderRule(folderPath);
    if (!existing) {
      return false;
    }

    const normalizedTag = tag.toLowerCase();
    const newTags = existing.inheritedTags.filter((t) => t !== normalizedTag);
    return this.updateFolderRule(folderPath, { inheritedTags: newTags });
  }

  /**
   * Parse a DB folder rule to the application format
   */
  public parseFolderRule(dbRule: DbFolderRule): FolderRule {
    return {
      folderPath: dbRule.folder_path,
      inheritedTags: JSON.parse(dbRule.inherited_tags) as string[],
      recursive: dbRule.recursive === 1,
      priority: dbRule.priority,
      createdAt: dbRule.created_at,
    };
  }

  // ============================================================
  // FILE TAG EXCLUSION OPERATIONS
  // ============================================================

  /**
   * Add an exclusion - file will not inherit this tag
   */
  public addFileTagExclusion(fileId: string, tagName: string): boolean {
    const normalizedTag = tagName.toLowerCase();
    try {
      this.run(
        'INSERT INTO file_tag_exclusions (file_id, tag_name) VALUES (?, ?)',
        [fileId, normalizedTag]
      );
      return true;
    } catch {
      // Already exists
      return false;
    }
  }

  /**
   * Remove an exclusion
   */
  public removeFileTagExclusion(fileId: string, tagName: string): boolean {
    const normalizedTag = tagName.toLowerCase();
    const result = this.run(
      'DELETE FROM file_tag_exclusions WHERE file_id = ? AND tag_name = ?',
      [fileId, normalizedTag]
    );
    return result.changes > 0;
  }

  /**
   * Get all excluded tags for a file
   */
  public getFileTagExclusions(fileId: string): string[] {
    const results = this.query<DbFileTagExclusion>(
      'SELECT * FROM file_tag_exclusions WHERE file_id = ?',
      [fileId]
    );
    return results.map((r) => r.tag_name);
  }

  /**
   * Get all exclusions (for management UI)
   */
  public getAllFileTagExclusions(): Array<{ fileId: string; tagName: string }> {
    const results = this.query<DbFileTagExclusion>(
      'SELECT * FROM file_tag_exclusions'
    );
    return results.map((r) => ({ fileId: r.file_id, tagName: r.tag_name }));
  }

  /**
   * Get effective inherited tags for a file (inherited minus exclusions)
   */
  public getEffectiveInheritedTags(filePath: string, fileId: string): string[] {
    const inherited = this.getInheritedTags(filePath);
    const exclusions = new Set(this.getFileTagExclusions(fileId));
    return inherited.filter((tag) => !exclusions.has(tag));
  }

  /**
   * Get all effective tags for a file (explicit + inherited)
   */
  public getEffectiveTags(filePath: string): { explicit: string[]; inherited: string[] } {
    const file = this.getFileByPath(filePath);
    if (!file) {
      return { explicit: [], inherited: this.getInheritedTags(filePath) };
    }

    const explicitTags = this.getTagsForFile(file.id);
    const explicit = explicitTags.map((t) => t.name);
    const inherited = this.getEffectiveInheritedTags(filePath, file.id);
    
    // Filter out inherited tags that are already explicit
    const explicitSet = new Set(explicit);
    const uniqueInherited = inherited.filter((t) => !explicitSet.has(t));

    return { explicit, inherited: uniqueInherited };
  }

  // ============================================================
  // TAG TEMPLATE OPERATIONS
  // ============================================================

  /**
   * Create a new tag template
   */
  public createTemplate(
    name: string,
    tagsToAdd: string[],
    options?: {
      description?: string;
      tagsToRemove?: string[];
      shortcut?: string;
      conditions?: unknown;
    }
  ): string {
    const id = nanoid();
    const now = Date.now();
    this.run(
      `INSERT INTO tag_templates (id, name, description, tags_to_add, tags_to_remove, shortcut, conditions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        options?.description ?? null,
        JSON.stringify(tagsToAdd.map((t) => t.toLowerCase())),
        options?.tagsToRemove ? JSON.stringify(options.tagsToRemove.map((t) => t.toLowerCase())) : null,
        options?.shortcut ?? null,
        options?.conditions ? JSON.stringify(options.conditions) : null,
        now,
      ]
    );
    return id;
  }

  /**
   * Get a template by ID
   */
  public getTemplate(id: string): DbTagTemplate | null {
    return this.queryOne<DbTagTemplate>(
      'SELECT * FROM tag_templates WHERE id = ?',
      [id]
    );
  }

  /**
   * Get a template by name
   */
  public getTemplateByName(name: string): DbTagTemplate | null {
    return this.queryOne<DbTagTemplate>(
      'SELECT * FROM tag_templates WHERE name = ?',
      [name]
    );
  }

  /**
   * Get all templates
   */
  public getAllTemplates(): DbTagTemplate[] {
    return this.query<DbTagTemplate>(
      'SELECT * FROM tag_templates ORDER BY name'
    );
  }

  /**
   * Update a template
   */
  public updateTemplate(
    id: string,
    updates: {
      name?: string;
      description?: string | null;
      tagsToAdd?: string[];
      tagsToRemove?: string[] | null;
      shortcut?: string | null;
      conditions?: unknown | null;
    }
  ): boolean {
    const existing = this.getTemplate(id);
    if (!existing) return false;

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      params.push(updates.description);
    }
    if (updates.tagsToAdd !== undefined) {
      setClauses.push('tags_to_add = ?');
      params.push(JSON.stringify(updates.tagsToAdd.map((t) => t.toLowerCase())));
    }
    if (updates.tagsToRemove !== undefined) {
      setClauses.push('tags_to_remove = ?');
      params.push(updates.tagsToRemove ? JSON.stringify(updates.tagsToRemove.map((t) => t.toLowerCase())) : null);
    }
    if (updates.shortcut !== undefined) {
      setClauses.push('shortcut = ?');
      params.push(updates.shortcut);
    }
    if (updates.conditions !== undefined) {
      setClauses.push('conditions = ?');
      params.push(updates.conditions ? JSON.stringify(updates.conditions) : null);
    }

    if (setClauses.length === 0) return true;

    params.push(id);
    this.run(
      `UPDATE tag_templates SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
    return true;
  }

  /**
   * Delete a template
   */
  public deleteTemplate(id: string): boolean {
    const existing = this.getTemplate(id);
    if (!existing) return false;

    this.run('DELETE FROM tag_templates WHERE id = ?', [id]);
    return true;
  }

  /**
   * Parse a DbTagTemplate into a TagTemplate
   */
  public parseTemplate(dbTemplate: DbTagTemplate): TagTemplate {
    return {
      id: dbTemplate.id,
      name: dbTemplate.name,
      description: dbTemplate.description,
      tagsToAdd: JSON.parse(dbTemplate.tags_to_add) as string[],
      tagsToRemove: dbTemplate.tags_to_remove
        ? (JSON.parse(dbTemplate.tags_to_remove) as string[])
        : [],
      shortcut: dbTemplate.shortcut,
      conditions: dbTemplate.conditions
        ? (JSON.parse(dbTemplate.conditions) as TagExpression)
        : null,
      createdAt: dbTemplate.created_at,
    };
  }

  /**
   * Get all templates as parsed TagTemplate objects
   */
  public getAllTemplatesParsed(): TagTemplate[] {
    return this.getAllTemplates().map((t) => this.parseTemplate(t));
  }

  // ============================================================
  // TAG ALIAS OPERATIONS
  // ============================================================

  /**
   * Create an alias that resolves to a primary tag.
   * When users add the alias, the primary tag is applied instead.
   */
  public createAlias(alias: string, primaryTag: string): boolean {
    const normalizedAlias = alias.toLowerCase().trim();
    const normalizedPrimary = primaryTag.toLowerCase().trim();

    // Check if alias already exists
    if (this.getAlias(normalizedAlias)) {
      return false;
    }

    // Ensure the primary tag exists
    if (!this.getTag(normalizedPrimary)) {
      // Auto-create the primary tag
      this.upsertTag(normalizedPrimary, primaryTag);
    }

    this.run(
      'INSERT INTO tag_aliases (alias, primary_tag) VALUES (?, ?)',
      [normalizedAlias, normalizedPrimary]
    );
    return true;
  }

  /**
   * Get an alias record
   */
  public getAlias(alias: string): DbTagAlias | null {
    return this.queryOne<DbTagAlias>(
      'SELECT * FROM tag_aliases WHERE alias = ?',
      [alias.toLowerCase().trim()]
    );
  }

  /**
   * Resolve a tag name: if it's an alias, return the primary tag; otherwise return as-is.
   * This is the core function used when adding tags to files.
   */
  public resolveAlias(tagName: string): string {
    const normalized = tagName.toLowerCase().trim();
    const alias = this.getAlias(normalized);
    return alias ? alias.primary_tag : normalized;
  }

  /**
   * Resolve multiple tags at once, returning the resolved names
   */
  public resolveAliases(tagNames: string[]): string[] {
    return tagNames.map((t) => this.resolveAlias(t));
  }

  /**
   * Get all aliases for a specific primary tag
   */
  public getAliasesForTag(primaryTag: string): string[] {
    const results = this.query<DbTagAlias>(
      'SELECT * FROM tag_aliases WHERE primary_tag = ?',
      [primaryTag.toLowerCase().trim()]
    );
    return results.map((r) => r.alias);
  }

  /**
   * Get all aliases in the system
   */
  public getAllAliases(): DbTagAlias[] {
    return this.query<DbTagAlias>('SELECT * FROM tag_aliases ORDER BY alias');
  }

  /**
   * Delete an alias
   */
  public deleteAlias(alias: string): boolean {
    const existing = this.getAlias(alias);
    if (!existing) return false;

    this.run('DELETE FROM tag_aliases WHERE alias = ?', [alias.toLowerCase().trim()]);
    return true;
  }

  /**
   * Update an alias to point to a different primary tag
   */
  public updateAlias(alias: string, newPrimaryTag: string): boolean {
    const normalizedAlias = alias.toLowerCase().trim();
    const normalizedPrimary = newPrimaryTag.toLowerCase().trim();

    const existing = this.getAlias(normalizedAlias);
    if (!existing) return false;

    // Ensure the new primary tag exists
    if (!this.getTag(normalizedPrimary)) {
      this.upsertTag(normalizedPrimary, newPrimaryTag);
    }

    this.run(
      'UPDATE tag_aliases SET primary_tag = ? WHERE alias = ?',
      [normalizedPrimary, normalizedAlias]
    );
    return true;
  }

  /**
   * Check if a tag name is an alias
   */
  public isAlias(tagName: string): boolean {
    return this.getAlias(tagName) !== null;
  }

  /**
   * Get all tags with their aliases for display
   */
  public getTagsWithAliases(): Array<{ tag: DbTag; aliases: string[] }> {
    const tags = this.query<DbTag>('SELECT * FROM tags ORDER BY display_name');
    return tags.map((tag) => ({
      tag,
      aliases: this.getAliasesForTag(tag.name),
    }));
  }

  // ============================================================
  // TAG HIERARCHY OPERATIONS
  // ============================================================

  /**
   * Set the parent of a tag (creates hierarchy).
   * Use `::` separator in display: "Programming::Python::Django"
   */
  public setTagParent(childTag: string, parentTag: string | null): boolean {
    const normalizedChild = childTag.toLowerCase().trim();
    const normalizedParent = parentTag?.toLowerCase().trim() ?? null;

    // Check child exists
    if (!this.getTag(normalizedChild)) {
      return false;
    }

    // Check parent exists (if provided)
    if (normalizedParent && !this.getTag(normalizedParent)) {
      return false;
    }

    // Prevent circular references
    if (normalizedParent) {
      const ancestors = this.getTagAncestors(normalizedParent);
      if (ancestors.includes(normalizedChild)) {
        return false; // Would create a cycle
      }
    }

    this.run('UPDATE tags SET parent_tag = ? WHERE name = ?', [
      normalizedParent,
      normalizedChild,
    ]);
    return true;
  }

  /**
   * Get the parent tag of a tag (if any)
   */
  public getTagParent(tagName: string): string | null {
    const tag = this.getTag(tagName);
    return tag?.parent_tag ?? null;
  }

  /**
   * Get direct children of a tag
   */
  public getTagChildren(parentTag: string): DbTag[] {
    return this.query<DbTag>(
      'SELECT * FROM tags WHERE parent_tag = ? ORDER BY display_name',
      [parentTag.toLowerCase().trim()]
    );
  }

  /**
   * Get all ancestors of a tag (parent, grandparent, etc.)
   * Returns array from immediate parent to root.
   */
  public getTagAncestors(tagName: string): string[] {
    const ancestors: string[] = [];
    let current = this.getTag(tagName);
    const visited = new Set<string>(); // Prevent infinite loops

    while (current?.parent_tag && !visited.has(current.parent_tag)) {
      visited.add(current.parent_tag);
      ancestors.push(current.parent_tag);
      current = this.getTag(current.parent_tag);
    }

    return ancestors;
  }

  /**
   * Get all descendants of a tag (children, grandchildren, etc.)
   * Returns flat array of all descendant tag names.
   */
  public getTagDescendants(parentTag: string): string[] {
    const descendants: string[] = [];
    const queue = [parentTag.toLowerCase().trim()];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const children = this.getTagChildren(current);
      for (const child of children) {
        descendants.push(child.name);
        queue.push(child.name);
      }
    }

    return descendants;
  }

  /**
   * Get the full hierarchy path for a tag (from root to this tag)
   * Returns array like ["programming", "python", "django"]
   */
  public getTagPath(tagName: string): string[] {
    const ancestors = this.getTagAncestors(tagName);
    return [...ancestors.reverse(), tagName.toLowerCase().trim()];
  }

  /**
   * Get display path for a tag (using `::` separator)
   * Returns "Programming::Python::Django" format
   */
  public getTagDisplayPath(tagName: string): string {
    const path = this.getTagPath(tagName);
    const displayNames = path.map((t) => {
      const tag = this.getTag(t);
      return tag?.display_name ?? t;
    });
    return displayNames.join('::');
  }

  /**
   * Get root tags (tags with no parent)
   */
  public getRootTags(): DbTag[] {
    return this.query<DbTag>(
      'SELECT * FROM tags WHERE parent_tag IS NULL ORDER BY display_name'
    );
  }

  /**
   * Get files with a tag OR any of its descendants
   */
  public getFilesWithTagOrDescendants(tagName: string): DbFile[] {
    const normalized = tagName.toLowerCase().trim();
    const descendants = this.getTagDescendants(normalized);
    const allTags = [normalized, ...descendants];

    if (allTags.length === 0) {
      return [];
    }

    // Build query with placeholders
    const placeholders = allTags.map(() => '?').join(', ');
    return this.query<DbFile>(
      `SELECT DISTINCT f.*
       FROM files f
       JOIN tag_instances ti ON f.id = ti.file_id
       WHERE ti.tag_name IN (${placeholders})
       ORDER BY f.path`,
      allTags
    );
  }

  /**
   * Get the tag hierarchy as a tree structure
   */
  public getTagHierarchy(): TagHierarchyNode[] {
    const rootTags = this.getRootTags();
    return rootTags.map((tag) => this.buildHierarchyNode(tag));
  }

  /**
   * Build a hierarchy node recursively
   */
  private buildHierarchyNode(tag: DbTag): TagHierarchyNode {
    const children = this.getTagChildren(tag.name);
    return {
      tag,
      children: children.map((child) => this.buildHierarchyNode(child)),
      fileCount: this.getTagFileCount(tag.name),
      totalFileCount: this.getTagTotalFileCount(tag.name),
    };
  }

  /**
   * Get file count for a specific tag (not including descendants)
   */
  private getTagFileCount(tagName: string): number {
    const result = this.queryOne<{ count: number }>(
      'SELECT COUNT(DISTINCT file_id) as count FROM tag_instances WHERE tag_name = ?',
      [tagName.toLowerCase().trim()]
    );
    return result?.count ?? 0;
  }

  /**
   * Get total file count for a tag including all descendants
   */
  private getTagTotalFileCount(tagName: string): number {
    const normalized = tagName.toLowerCase().trim();
    const descendants = this.getTagDescendants(normalized);
    const allTags = [normalized, ...descendants];

    if (allTags.length === 0) return 0;

    const placeholders = allTags.map(() => '?').join(', ');
    const result = this.queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT file_id) as count FROM tag_instances WHERE tag_name IN (${placeholders})`,
      allTags
    );
    return result?.count ?? 0;
  }
}

