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
  DbTagInstance,
  DbCard,
  DbDocumentMetadata,
  DbNotesAssociation,
  DbFolderRule,
  DbViewMode,
  TagInstanceWithMetadata,
  FileWithTags,
  TagWithCount,
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
  public run(sql: string, params: unknown[] = []): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(sql, params as (string | number | Uint8Array | null)[]);
    this.markDirty();
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
}

