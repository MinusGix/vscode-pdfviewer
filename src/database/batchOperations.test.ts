/**
 * Tests for batch tag operations
 *
 * Uses sql.js directly for database operations (no VS Code context needed)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { DbFile } from './types';
import { nanoid } from 'nanoid';

/**
 * Helper class that mirrors LatticeDatabase batch methods for testing
 */
class TestDatabase {
  constructor(private db: Database) {}

  run(sql: string, params: unknown[] = []): { changes: number } {
    this.db.run(sql, params as (string | number | Uint8Array | null)[]);
    return { changes: this.db.getRowsModified() };
  }

  query<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | Uint8Array | null)[]);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  queryOne<T>(sql: string, params: unknown[] = []): T | null {
    const results = this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  // File operations
  createFile(filePath: string, filename: string): string {
    const id = nanoid();
    this.run(
      `INSERT INTO files (id, path, filename, status, created_at)
       VALUES (?, ?, ?, 'ok', ?)`,
      [id, filePath, filename, Date.now()]
    );
    return id;
  }

  getAllFiles(): DbFile[] {
    return this.query<DbFile>('SELECT * FROM files ORDER BY path');
  }

  // Tag operations
  ensureTag(name: string): void {
    this.run(
      `INSERT OR IGNORE INTO tags (name, display_name, visibility, created_at)
       VALUES (?, ?, 'normal', ?)`,
      [name.toLowerCase(), name, Date.now()]
    );
  }

  getFileTags(fileId: string): string[] {
    const results = this.query<{ tag_name: string }>(
      'SELECT tag_name FROM tag_instances WHERE file_id = ?',
      [fileId]
    );
    return results.map((r) => r.tag_name);
  }

  // Batch operations
  addTagToFiles(fileIds: string[], tagName: string): number {
    const normalizedTag = tagName.toLowerCase();
    this.ensureTag(normalizedTag);

    let added = 0;
    const now = Date.now();

    for (const fileId of fileIds) {
      const existing = this.queryOne<{ id: string }>(
        'SELECT id FROM tag_instances WHERE file_id = ? AND tag_name = ?',
        [fileId, normalizedTag]
      );

      if (!existing) {
        const id = nanoid();
        this.run(
          `INSERT INTO tag_instances (id, file_id, tag_name, created_at)
           VALUES (?, ?, ?, ?)`,
          [id, fileId, normalizedTag, now]
        );
        added++;
      }
    }

    return added;
  }

  removeTagFromFiles(fileIds: string[], tagName: string): number {
    const normalizedTag = tagName.toLowerCase();
    let removed = 0;

    for (const fileId of fileIds) {
      const result = this.run(
        'DELETE FROM tag_instances WHERE file_id = ? AND tag_name = ?',
        [fileId, normalizedTag]
      );
      removed += result.changes;
    }

    return removed;
  }

  addTagsToFile(fileId: string, tagNames: string[]): number {
    let added = 0;
    for (const tag of tagNames) {
      const normalizedTag = tag.toLowerCase();
      this.ensureTag(normalizedTag);

      const existing = this.queryOne<{ id: string }>(
        'SELECT id FROM tag_instances WHERE file_id = ? AND tag_name = ?',
        [fileId, normalizedTag]
      );

      if (!existing) {
        const id = nanoid();
        this.run(
          `INSERT INTO tag_instances (id, file_id, tag_name, created_at)
           VALUES (?, ?, ?, ?)`,
          [id, fileId, normalizedTag, Date.now()]
        );
        added++;
      }
    }
    return added;
  }

  removeTagsFromFile(fileId: string, tagNames: string[]): number {
    let removed = 0;
    for (const tag of tagNames) {
      const result = this.run(
        'DELETE FROM tag_instances WHERE file_id = ? AND tag_name = ?',
        [fileId, tag.toLowerCase()]
      );
      removed += result.changes;
    }
    return removed;
  }

  addTagsToFiles(fileIds: string[], tagNames: string[]): { filesAffected: number; tagsAdded: number } {
    let tagsAdded = 0;
    const filesAffected = new Set<string>();

    for (const tag of tagNames) {
      const normalizedTag = tag.toLowerCase();
      this.ensureTag(normalizedTag);

      for (const fileId of fileIds) {
        const existing = this.queryOne<{ id: string }>(
          'SELECT id FROM tag_instances WHERE file_id = ? AND tag_name = ?',
          [fileId, normalizedTag]
        );

        if (!existing) {
          const id = nanoid();
          this.run(
            `INSERT INTO tag_instances (id, file_id, tag_name, created_at)
             VALUES (?, ?, ?, ?)`,
            [id, fileId, normalizedTag, Date.now()]
          );
          tagsAdded++;
          filesAffected.add(fileId);
        }
      }
    }

    return { filesAffected: filesAffected.size, tagsAdded };
  }

  removeTagsFromFiles(fileIds: string[], tagNames: string[]): { filesAffected: number; tagsRemoved: number } {
    let tagsRemoved = 0;
    const filesAffected = new Set<string>();

    for (const tag of tagNames) {
      for (const fileId of fileIds) {
        const result = this.run(
          'DELETE FROM tag_instances WHERE file_id = ? AND tag_name = ?',
          [fileId, tag.toLowerCase()]
        );
        if (result.changes > 0) {
          tagsRemoved += result.changes;
          filesAffected.add(fileId);
        }
      }
    }

    return { filesAffected: filesAffected.size, tagsRemoved };
  }

  setTagsForFiles(fileIds: string[], tagNames: string[]): { filesAffected: number } {
    const normalizedTags = tagNames.map((t) => t.toLowerCase());

    for (const tag of normalizedTags) {
      this.ensureTag(tag);
    }

    for (const fileId of fileIds) {
      this.run('DELETE FROM tag_instances WHERE file_id = ?', [fileId]);

      for (const tag of normalizedTags) {
        const id = nanoid();
        this.run(
          `INSERT INTO tag_instances (id, file_id, tag_name, created_at)
           VALUES (?, ?, ?, ?)`,
          [id, fileId, tag, Date.now()]
        );
      }
    }

    return { filesAffected: fileIds.length };
  }

  getFilesWithAllTags(tagNames: string[]): DbFile[] {
    if (tagNames.length === 0) return [];

    const normalizedTags = tagNames.map((t) => t.toLowerCase());
    const placeholders = normalizedTags.map(() => '?').join(',');

    return this.query<DbFile>(
      `SELECT f.* FROM files f
       WHERE f.id IN (
         SELECT file_id FROM tag_instances
         WHERE tag_name IN (${placeholders})
         GROUP BY file_id
         HAVING COUNT(DISTINCT tag_name) = ?
       )`,
      [...normalizedTags, normalizedTags.length]
    );
  }

  getFilesWithAnyTags(tagNames: string[]): DbFile[] {
    if (tagNames.length === 0) return [];

    const normalizedTags = tagNames.map((t) => t.toLowerCase());
    const placeholders = normalizedTags.map(() => '?').join(',');

    return this.query<DbFile>(
      `SELECT DISTINCT f.* FROM files f
       JOIN tag_instances ti ON f.id = ti.file_id
       WHERE ti.tag_name IN (${placeholders})`,
      normalizedTags
    );
  }

  getFilesWithoutTags(tagNames: string[]): DbFile[] {
    if (tagNames.length === 0) {
      return this.getAllFiles();
    }

    const normalizedTags = tagNames.map((t) => t.toLowerCase());
    const placeholders = normalizedTags.map(() => '?').join(',');

    return this.query<DbFile>(
      `SELECT f.* FROM files f
       WHERE f.id NOT IN (
         SELECT DISTINCT file_id FROM tag_instances
         WHERE tag_name IN (${placeholders})
       )`,
      normalizedTags
    );
  }

  getUntaggedFiles(): DbFile[] {
    return this.query<DbFile>(
      `SELECT f.* FROM files f
       WHERE f.id NOT IN (SELECT DISTINCT file_id FROM tag_instances)`
    );
  }

  getCommonTags(fileIds: string[]): string[] {
    if (fileIds.length === 0) return [];
    if (fileIds.length === 1) {
      return this.getFileTags(fileIds[0]);
    }

    const placeholders = fileIds.map(() => '?').join(',');

    const results = this.query<{ tag_name: string }>(
      `SELECT tag_name FROM tag_instances
       WHERE file_id IN (${placeholders})
       GROUP BY tag_name
       HAVING COUNT(DISTINCT file_id) = ?`,
      [...fileIds, fileIds.length]
    );

    return results.map((r) => r.tag_name);
  }

  getAllTagsForFiles(fileIds: string[]): string[] {
    if (fileIds.length === 0) return [];

    const placeholders = fileIds.map(() => '?').join(',');

    const results = this.query<{ tag_name: string }>(
      `SELECT DISTINCT tag_name FROM tag_instances
       WHERE file_id IN (${placeholders})`,
      fileIds
    );

    return results.map((r) => r.tag_name);
  }

  getTagCountsForFiles(fileIds: string[]): Array<{ tagName: string; count: number }> {
    if (fileIds.length === 0) return [];

    const placeholders = fileIds.map(() => '?').join(',');

    return this.query<{ tagName: string; count: number }>(
      `SELECT tag_name as tagName, COUNT(*) as count 
       FROM tag_instances
       WHERE file_id IN (${placeholders})
       GROUP BY tag_name
       ORDER BY count DESC`,
      fileIds
    );
  }
}

describe('Batch Tag Operations', () => {
  let SQL: SqlJsStatic;
  let rawDb: Database;
  let db: TestDatabase;
  let file1: string, file2: string, file3: string, file4: string;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  beforeEach(() => {
    rawDb = new SQL.Database();
    rawDb.run(SCHEMA_SQL);
    rawDb.run(`INSERT INTO schema_info (key, value) VALUES ('version', '${SCHEMA_VERSION}')`);
    db = new TestDatabase(rawDb);

    // Create test files
    file1 = db.createFile('src/app.ts', 'app.ts');
    file2 = db.createFile('src/utils.ts', 'utils.ts');
    file3 = db.createFile('src/types.ts', 'types.ts');
    file4 = db.createFile('docs/readme.md', 'readme.md');
  });

  afterAll(() => {
    rawDb?.close();
  });

  describe('addTagToFiles', () => {
    it('should add a tag to multiple files', () => {
      const added = db.addTagToFiles([file1, file2, file3], 'typescript');

      expect(added).toBe(3);
      expect(db.getFileTags(file1)).toContain('typescript');
      expect(db.getFileTags(file2)).toContain('typescript');
      expect(db.getFileTags(file3)).toContain('typescript');
      expect(db.getFileTags(file4)).not.toContain('typescript');
    });

    it('should not duplicate tags', () => {
      db.addTagToFiles([file1], 'tag');
      const added = db.addTagToFiles([file1, file2], 'tag');

      expect(added).toBe(1); // Only file2 was newly tagged
      expect(db.getFileTags(file1)).toEqual(['tag']);
    });

    it('should handle empty file list', () => {
      const added = db.addTagToFiles([], 'tag');
      expect(added).toBe(0);
    });
  });

  describe('removeTagFromFiles', () => {
    beforeEach(() => {
      db.addTagToFiles([file1, file2, file3], 'remove-me');
    });

    it('should remove a tag from multiple files', () => {
      const removed = db.removeTagFromFiles([file1, file2], 'remove-me');

      expect(removed).toBe(2);
      expect(db.getFileTags(file1)).not.toContain('remove-me');
      expect(db.getFileTags(file2)).not.toContain('remove-me');
      expect(db.getFileTags(file3)).toContain('remove-me');
    });

    it('should return 0 for files without the tag', () => {
      const removed = db.removeTagFromFiles([file4], 'remove-me');
      expect(removed).toBe(0);
    });
  });

  describe('addTagsToFile', () => {
    it('should add multiple tags to a file', () => {
      const added = db.addTagsToFile(file1, ['tag1', 'tag2', 'tag3']);

      expect(added).toBe(3);
      expect(db.getFileTags(file1)).toEqual(expect.arrayContaining(['tag1', 'tag2', 'tag3']));
    });

    it('should skip existing tags', () => {
      db.addTagsToFile(file1, ['existing']);
      const added = db.addTagsToFile(file1, ['existing', 'new']);

      expect(added).toBe(1); // Only 'new' was added
    });
  });

  describe('removeTagsFromFile', () => {
    beforeEach(() => {
      db.addTagsToFile(file1, ['a', 'b', 'c', 'd']);
    });

    it('should remove multiple tags from a file', () => {
      const removed = db.removeTagsFromFile(file1, ['a', 'c']);

      expect(removed).toBe(2);
      expect(db.getFileTags(file1)).toEqual(expect.arrayContaining(['b', 'd']));
      expect(db.getFileTags(file1)).not.toContain('a');
      expect(db.getFileTags(file1)).not.toContain('c');
    });
  });

  describe('addTagsToFiles', () => {
    it('should add multiple tags to multiple files', () => {
      const result = db.addTagsToFiles([file1, file2], ['frontend', 'typescript']);

      expect(result.filesAffected).toBe(2);
      expect(result.tagsAdded).toBe(4); // 2 files × 2 tags

      expect(db.getFileTags(file1)).toEqual(expect.arrayContaining(['frontend', 'typescript']));
      expect(db.getFileTags(file2)).toEqual(expect.arrayContaining(['frontend', 'typescript']));
    });

    it('should handle partial overlaps', () => {
      db.addTagsToFile(file1, ['existing']);
      const result = db.addTagsToFiles([file1, file2], ['existing', 'new']);

      expect(result.filesAffected).toBe(2);
      expect(result.tagsAdded).toBe(3); // file1 gets 'new', file2 gets both
    });
  });

  describe('removeTagsFromFiles', () => {
    beforeEach(() => {
      db.addTagsToFiles([file1, file2, file3], ['a', 'b', 'c']);
    });

    it('should remove multiple tags from multiple files', () => {
      const result = db.removeTagsFromFiles([file1, file2], ['a', 'b']);

      expect(result.filesAffected).toBe(2);
      expect(result.tagsRemoved).toBe(4);

      expect(db.getFileTags(file1)).toEqual(['c']);
      expect(db.getFileTags(file2)).toEqual(['c']);
      expect(db.getFileTags(file3)).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    });
  });

  describe('setTagsForFiles', () => {
    beforeEach(() => {
      db.addTagsToFile(file1, ['old1', 'old2']);
      db.addTagsToFile(file2, ['different']);
    });

    it('should replace all tags on multiple files', () => {
      const result = db.setTagsForFiles([file1, file2], ['new1', 'new2']);

      expect(result.filesAffected).toBe(2);

      const tags1 = db.getFileTags(file1);
      const tags2 = db.getFileTags(file2);

      expect(tags1).toEqual(expect.arrayContaining(['new1', 'new2']));
      expect(tags1).toHaveLength(2);
      expect(tags2).toEqual(expect.arrayContaining(['new1', 'new2']));
      expect(tags2).toHaveLength(2);
    });

    it('should handle empty tags list (clear all tags)', () => {
      db.setTagsForFiles([file1], []);

      expect(db.getFileTags(file1)).toHaveLength(0);
    });
  });

  describe('getFilesWithAllTags', () => {
    beforeEach(() => {
      db.addTagsToFile(file1, ['a', 'b', 'c']);
      db.addTagsToFile(file2, ['a', 'b']);
      db.addTagsToFile(file3, ['a']);
    });

    it('should find files with all specified tags', () => {
      const files = db.getFilesWithAllTags(['a', 'b']);

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.id)).toContain(file1);
      expect(files.map((f) => f.id)).toContain(file2);
    });

    it('should return empty for impossible combinations', () => {
      const files = db.getFilesWithAllTags(['a', 'b', 'c', 'd']);
      expect(files).toHaveLength(0);
    });

    it('should handle empty input', () => {
      const files = db.getFilesWithAllTags([]);
      expect(files).toHaveLength(0);
    });
  });

  describe('getFilesWithAnyTags', () => {
    beforeEach(() => {
      db.addTagsToFile(file1, ['x']);
      db.addTagsToFile(file2, ['y']);
      db.addTagsToFile(file3, ['z']);
    });

    it('should find files with any of the specified tags', () => {
      const files = db.getFilesWithAnyTags(['x', 'y']);

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.id)).toContain(file1);
      expect(files.map((f) => f.id)).toContain(file2);
    });

    it('should handle empty input', () => {
      const files = db.getFilesWithAnyTags([]);
      expect(files).toHaveLength(0);
    });
  });

  describe('getFilesWithoutTags', () => {
    beforeEach(() => {
      db.addTagsToFile(file1, ['tagged']);
      db.addTagsToFile(file2, ['tagged']);
    });

    it('should find files without the specified tags', () => {
      const files = db.getFilesWithoutTags(['tagged']);

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.id)).toContain(file3);
      expect(files.map((f) => f.id)).toContain(file4);
    });

    it('should return all files for empty input', () => {
      const files = db.getFilesWithoutTags([]);
      expect(files).toHaveLength(4);
    });
  });

  describe('getUntaggedFiles', () => {
    beforeEach(() => {
      db.addTagsToFile(file1, ['tag']);
      db.addTagsToFile(file2, ['tag']);
    });

    it('should find files with no tags', () => {
      const files = db.getUntaggedFiles();

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.id)).toContain(file3);
      expect(files.map((f) => f.id)).toContain(file4);
    });
  });

  describe('getCommonTags', () => {
    beforeEach(() => {
      db.addTagsToFile(file1, ['common', 'a', 'b']);
      db.addTagsToFile(file2, ['common', 'a', 'c']);
      db.addTagsToFile(file3, ['common', 'd']);
    });

    it('should find tags shared by all files', () => {
      const common = db.getCommonTags([file1, file2, file3]);

      expect(common).toEqual(['common']);
    });

    it('should find more tags when fewer files selected', () => {
      const common = db.getCommonTags([file1, file2]);

      expect(common).toEqual(expect.arrayContaining(['common', 'a']));
      expect(common).toHaveLength(2);
    });

    it('should handle single file', () => {
      const common = db.getCommonTags([file1]);

      expect(common).toEqual(expect.arrayContaining(['common', 'a', 'b']));
    });

    it('should handle empty input', () => {
      const common = db.getCommonTags([]);
      expect(common).toHaveLength(0);
    });
  });

  describe('getAllTagsForFiles', () => {
    beforeEach(() => {
      db.addTagsToFile(file1, ['a', 'b']);
      db.addTagsToFile(file2, ['b', 'c']);
    });

    it('should get all unique tags across files', () => {
      const tags = db.getAllTagsForFiles([file1, file2]);

      expect(tags).toEqual(expect.arrayContaining(['a', 'b', 'c']));
      expect(tags).toHaveLength(3);
    });

    it('should handle empty input', () => {
      const tags = db.getAllTagsForFiles([]);
      expect(tags).toHaveLength(0);
    });
  });

  describe('getTagCountsForFiles', () => {
    beforeEach(() => {
      db.addTagsToFile(file1, ['common', 'a']);
      db.addTagsToFile(file2, ['common', 'b']);
      db.addTagsToFile(file3, ['common', 'c']);
    });

    it('should return tag counts sorted by frequency', () => {
      const counts = db.getTagCountsForFiles([file1, file2, file3]);

      expect(counts[0]).toEqual({ tagName: 'common', count: 3 });
      expect(counts).toHaveLength(4);
    });

    it('should handle empty input', () => {
      const counts = db.getTagCountsForFiles([]);
      expect(counts).toHaveLength(0);
    });
  });
});

