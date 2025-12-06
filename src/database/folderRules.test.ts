/**
 * Tests for folder rule operations
 *
 * Uses sql.js directly for database operations (no VS Code context needed)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { DbFolderRule, DbFileTagExclusion, DbFile, DbTag, FolderRule } from './types';
import { nanoid } from 'nanoid';
import * as path from 'path';

/**
 * Helper class that mirrors LatticeDatabase folder rule methods for testing
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

  // Create a file
  createFile(filePath: string, filename: string): string {
    const id = nanoid();
    const now = Date.now();
    this.run(
      `INSERT INTO files (id, path, filename, status, created_at)
       VALUES (?, ?, ?, 'ok', ?)`,
      [id, filePath, filename, now]
    );
    return id;
  }

  // Get file by path
  getFileByPath(filePath: string): DbFile | null {
    return this.queryOne<DbFile>('SELECT * FROM files WHERE path = ?', [filePath]);
  }

  // Create a tag
  ensureTag(name: string, displayName?: string): void {
    const now = Date.now();
    this.run(
      `INSERT OR IGNORE INTO tags (name, display_name, visibility, created_at)
       VALUES (?, ?, 'normal', ?)`,
      [name.toLowerCase(), displayName ?? name, now]
    );
  }

  // Add tag to file
  addTagToFile(fileId: string, tagName: string): void {
    const normalizedTag = tagName.toLowerCase();
    this.ensureTag(normalizedTag);
    const id = nanoid();
    const now = Date.now();
    this.run(
      `INSERT OR IGNORE INTO tag_instances (id, file_id, tag_name, created_at)
       VALUES (?, ?, ?, ?)`,
      [id, fileId, normalizedTag, now]
    );
  }

  // Get tags for file
  getFileTags(fileId: string): string[] {
    const results = this.query<{ tag_name: string }>(
      'SELECT tag_name FROM tag_instances WHERE file_id = ?',
      [fileId]
    );
    return results.map((r) => r.tag_name);
  }

  // Folder rule operations
  getAllFolderRules(): FolderRule[] {
    const dbRules = this.query<DbFolderRule>(
      'SELECT * FROM folder_rules ORDER BY priority DESC, folder_path ASC'
    );
    return dbRules.map((r) => this.parseFolderRule(r));
  }

  getFolderRule(folderPath: string): FolderRule | null {
    const results = this.query<DbFolderRule>(
      'SELECT * FROM folder_rules WHERE folder_path = ?',
      [folderPath]
    );
    return results.length > 0 ? this.parseFolderRule(results[0]) : null;
  }

  createFolderRule(
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
      return false;
    }
  }

  updateFolderRule(
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

  deleteFolderRule(folderPath: string): boolean {
    const result = this.run(
      'DELETE FROM folder_rules WHERE folder_path = ?',
      [folderPath]
    );
    return result.changes > 0;
  }

  addTagToFolderRule(folderPath: string, tag: string): boolean {
    const existing = this.getFolderRule(folderPath);
    if (!existing) {
      return false;
    }

    const normalizedTag = tag.toLowerCase();
    if (existing.inheritedTags.includes(normalizedTag)) {
      return true;
    }

    const newTags = [...existing.inheritedTags, normalizedTag];
    return this.updateFolderRule(folderPath, { inheritedTags: newTags });
  }

  removeTagFromFolderRule(folderPath: string, tag: string): boolean {
    const existing = this.getFolderRule(folderPath);
    if (!existing) {
      return false;
    }

    const normalizedTag = tag.toLowerCase();
    const newTags = existing.inheritedTags.filter((t) => t !== normalizedTag);
    return this.updateFolderRule(folderPath, { inheritedTags: newTags });
  }

  parseFolderRule(dbRule: DbFolderRule): FolderRule {
    return {
      folderPath: dbRule.folder_path,
      inheritedTags: JSON.parse(dbRule.inherited_tags) as string[],
      recursive: dbRule.recursive === 1,
      priority: dbRule.priority,
      createdAt: dbRule.created_at,
    };
  }

  getFolderRulesForPath(filePath: string): DbFolderRule[] {
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

  getInheritedTags(filePath: string): string[] {
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

  // File tag exclusion operations
  addFileTagExclusion(fileId: string, tagName: string): boolean {
    const normalizedTag = tagName.toLowerCase();
    try {
      this.run(
        'INSERT INTO file_tag_exclusions (file_id, tag_name) VALUES (?, ?)',
        [fileId, normalizedTag]
      );
      return true;
    } catch {
      return false;
    }
  }

  removeFileTagExclusion(fileId: string, tagName: string): boolean {
    const normalizedTag = tagName.toLowerCase();
    const result = this.run(
      'DELETE FROM file_tag_exclusions WHERE file_id = ? AND tag_name = ?',
      [fileId, normalizedTag]
    );
    return result.changes > 0;
  }

  getFileTagExclusions(fileId: string): string[] {
    const results = this.query<DbFileTagExclusion>(
      'SELECT * FROM file_tag_exclusions WHERE file_id = ?',
      [fileId]
    );
    return results.map((r) => r.tag_name);
  }

  getAllFileTagExclusions(): Array<{ fileId: string; tagName: string }> {
    const results = this.query<DbFileTagExclusion>(
      'SELECT * FROM file_tag_exclusions'
    );
    return results.map((r) => ({ fileId: r.file_id, tagName: r.tag_name }));
  }

  getEffectiveInheritedTags(filePath: string, fileId: string): string[] {
    const inherited = this.getInheritedTags(filePath);
    const exclusions = new Set(this.getFileTagExclusions(fileId));
    return inherited.filter((tag) => !exclusions.has(tag));
  }

  getEffectiveTags(filePath: string): { explicit: string[]; inherited: string[] } {
    const file = this.getFileByPath(filePath);
    if (!file) {
      return { explicit: [], inherited: this.getInheritedTags(filePath) };
    }

    const explicit = this.getFileTags(file.id);
    const inherited = this.getEffectiveInheritedTags(filePath, file.id);

    // Filter out inherited tags that are already explicit
    const explicitSet = new Set(explicit);
    const uniqueInherited = inherited.filter((t) => !explicitSet.has(t));

    return { explicit, inherited: uniqueInherited };
  }
}

describe('Folder Rules', () => {
  let SQL: SqlJsStatic;
  let rawDb: Database;
  let db: TestDatabase;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  beforeEach(() => {
    rawDb = new SQL.Database();
    rawDb.run(SCHEMA_SQL);
    rawDb.run(`INSERT INTO schema_info (key, value) VALUES ('version', '${SCHEMA_VERSION}')`);
    db = new TestDatabase(rawDb);
  });

  afterAll(() => {
    rawDb?.close();
  });

  describe('createFolderRule', () => {
    it('should create a folder rule', () => {
      const result = db.createFolderRule('src/components', ['frontend', 'react']);
      expect(result).toBe(true);

      const rule = db.getFolderRule('src/components');
      expect(rule).not.toBeNull();
      expect(rule?.folderPath).toBe('src/components');
      expect(rule?.inheritedTags).toEqual(['frontend', 'react']);
      expect(rule?.recursive).toBe(true);
      expect(rule?.priority).toBe(0);
    });

    it('should normalize tags to lowercase', () => {
      db.createFolderRule('src', ['Frontend', 'REACT']);
      const rule = db.getFolderRule('src');
      expect(rule?.inheritedTags).toEqual(['frontend', 'react']);
    });

    it('should support non-recursive rules', () => {
      db.createFolderRule('docs', ['documentation'], { recursive: false });
      const rule = db.getFolderRule('docs');
      expect(rule?.recursive).toBe(false);
    });

    it('should support priority', () => {
      db.createFolderRule('important', ['critical'], { priority: 100 });
      const rule = db.getFolderRule('important');
      expect(rule?.priority).toBe(100);
    });

    it('should return false if rule already exists', () => {
      db.createFolderRule('src', ['tag1']);
      const result = db.createFolderRule('src', ['tag2']);
      expect(result).toBe(false);
    });
  });

  describe('updateFolderRule', () => {
    beforeEach(() => {
      db.createFolderRule('src', ['initial'], { recursive: true, priority: 0 });
    });

    it('should update inherited tags', () => {
      const result = db.updateFolderRule('src', { inheritedTags: ['updated', 'tags'] });
      expect(result).toBe(true);

      const rule = db.getFolderRule('src');
      expect(rule?.inheritedTags).toEqual(['updated', 'tags']);
    });

    it('should update recursive flag', () => {
      db.updateFolderRule('src', { recursive: false });
      const rule = db.getFolderRule('src');
      expect(rule?.recursive).toBe(false);
    });

    it('should update priority', () => {
      db.updateFolderRule('src', { priority: 50 });
      const rule = db.getFolderRule('src');
      expect(rule?.priority).toBe(50);
    });

    it('should return false for non-existent rule', () => {
      const result = db.updateFolderRule('nonexistent', { inheritedTags: ['tag'] });
      expect(result).toBe(false);
    });
  });

  describe('deleteFolderRule', () => {
    it('should delete a folder rule', () => {
      db.createFolderRule('src', ['tag1']);
      expect(db.getFolderRule('src')).not.toBeNull();

      const result = db.deleteFolderRule('src');
      expect(result).toBe(true);
      expect(db.getFolderRule('src')).toBeNull();
    });

    it('should return false for non-existent rule', () => {
      const result = db.deleteFolderRule('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getAllFolderRules', () => {
    it('should return all rules ordered by priority', () => {
      db.createFolderRule('low', ['tag'], { priority: 1 });
      db.createFolderRule('high', ['tag'], { priority: 100 });
      db.createFolderRule('medium', ['tag'], { priority: 50 });

      const rules = db.getAllFolderRules();
      expect(rules).toHaveLength(3);
      expect(rules[0].folderPath).toBe('high');
      expect(rules[1].folderPath).toBe('medium');
      expect(rules[2].folderPath).toBe('low');
    });

    it('should return empty array when no rules exist', () => {
      const rules = db.getAllFolderRules();
      expect(rules).toHaveLength(0);
    });
  });

  describe('addTagToFolderRule', () => {
    beforeEach(() => {
      db.createFolderRule('src', ['existing']);
    });

    it('should add a tag to existing rule', () => {
      const result = db.addTagToFolderRule('src', 'newtag');
      expect(result).toBe(true);

      const rule = db.getFolderRule('src');
      expect(rule?.inheritedTags).toContain('existing');
      expect(rule?.inheritedTags).toContain('newtag');
    });

    it('should not duplicate existing tags', () => {
      db.addTagToFolderRule('src', 'existing');
      const rule = db.getFolderRule('src');
      expect(rule?.inheritedTags).toEqual(['existing']);
    });

    it('should return false for non-existent rule', () => {
      const result = db.addTagToFolderRule('nonexistent', 'tag');
      expect(result).toBe(false);
    });
  });

  describe('removeTagFromFolderRule', () => {
    beforeEach(() => {
      db.createFolderRule('src', ['tag1', 'tag2', 'tag3']);
    });

    it('should remove a tag from existing rule', () => {
      const result = db.removeTagFromFolderRule('src', 'tag2');
      expect(result).toBe(true);

      const rule = db.getFolderRule('src');
      expect(rule?.inheritedTags).toEqual(['tag1', 'tag3']);
    });

    it('should return false for non-existent rule', () => {
      const result = db.removeTagFromFolderRule('nonexistent', 'tag');
      expect(result).toBe(false);
    });
  });

  describe('getFolderRulesForPath', () => {
    beforeEach(() => {
      db.createFolderRule('src', ['source'], { recursive: true });
      db.createFolderRule('src/components', ['component'], { recursive: true });
      db.createFolderRule('docs', ['documentation'], { recursive: false });
    });

    it('should get recursive rules for nested file', () => {
      const rules = db.getFolderRulesForPath('src/components/Button.tsx');
      expect(rules).toHaveLength(2);
      expect(rules.map((r) => r.folder_path)).toContain('src');
      expect(rules.map((r) => r.folder_path)).toContain('src/components');
    });

    it('should get direct parent rule for non-recursive', () => {
      const rules = db.getFolderRulesForPath('docs/README.md');
      expect(rules).toHaveLength(1);
      expect(rules[0].folder_path).toBe('docs');
    });

    it('should not get non-recursive rule for nested file', () => {
      const rules = db.getFolderRulesForPath('docs/api/endpoints.md');
      expect(rules).toHaveLength(0);
    });
  });

  describe('getInheritedTags', () => {
    beforeEach(() => {
      db.createFolderRule('src', ['source'], { priority: 0 });
      db.createFolderRule('src/components', ['component', 'react'], { priority: 10 });
    });

    it('should get all inherited tags from matching rules', () => {
      const tags = db.getInheritedTags('src/components/Button.tsx');
      expect(tags).toContain('source');
      expect(tags).toContain('component');
      expect(tags).toContain('react');
    });

    it('should return empty array when no rules match', () => {
      const tags = db.getInheritedTags('other/file.txt');
      expect(tags).toHaveLength(0);
    });

    it('should deduplicate tags from multiple rules', () => {
      db.updateFolderRule('src/components', { inheritedTags: ['source', 'component'] });
      const tags = db.getInheritedTags('src/components/Button.tsx');
      expect(tags.filter((t) => t === 'source')).toHaveLength(1);
    });
  });
});

describe('File Tag Exclusions', () => {
  let SQL: SqlJsStatic;
  let rawDb: Database;
  let db: TestDatabase;
  let fileId: string;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  beforeEach(() => {
    rawDb = new SQL.Database();
    rawDb.run(SCHEMA_SQL);
    rawDb.run(`INSERT INTO schema_info (key, value) VALUES ('version', '${SCHEMA_VERSION}')`);
    db = new TestDatabase(rawDb);
    fileId = db.createFile('src/file.ts', 'file.ts');
  });

  afterAll(() => {
    rawDb?.close();
  });

  describe('addFileTagExclusion', () => {
    it('should add an exclusion', () => {
      const result = db.addFileTagExclusion(fileId, 'inherited-tag');
      expect(result).toBe(true);

      const exclusions = db.getFileTagExclusions(fileId);
      expect(exclusions).toContain('inherited-tag');
    });

    it('should normalize tag name to lowercase', () => {
      db.addFileTagExclusion(fileId, 'UPPERCASE');
      const exclusions = db.getFileTagExclusions(fileId);
      expect(exclusions).toContain('uppercase');
    });

    it('should return false for duplicate exclusion', () => {
      db.addFileTagExclusion(fileId, 'tag');
      const result = db.addFileTagExclusion(fileId, 'tag');
      expect(result).toBe(false);
    });
  });

  describe('removeFileTagExclusion', () => {
    beforeEach(() => {
      db.addFileTagExclusion(fileId, 'tag1');
      db.addFileTagExclusion(fileId, 'tag2');
    });

    it('should remove an exclusion', () => {
      const result = db.removeFileTagExclusion(fileId, 'tag1');
      expect(result).toBe(true);

      const exclusions = db.getFileTagExclusions(fileId);
      expect(exclusions).not.toContain('tag1');
      expect(exclusions).toContain('tag2');
    });

    it('should return false for non-existent exclusion', () => {
      const result = db.removeFileTagExclusion(fileId, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getFileTagExclusions', () => {
    it('should return all exclusions for a file', () => {
      db.addFileTagExclusion(fileId, 'tag1');
      db.addFileTagExclusion(fileId, 'tag2');
      db.addFileTagExclusion(fileId, 'tag3');

      const exclusions = db.getFileTagExclusions(fileId);
      expect(exclusions).toHaveLength(3);
      expect(exclusions).toEqual(expect.arrayContaining(['tag1', 'tag2', 'tag3']));
    });

    it('should return empty array for file with no exclusions', () => {
      const exclusions = db.getFileTagExclusions(fileId);
      expect(exclusions).toHaveLength(0);
    });
  });

  describe('getAllFileTagExclusions', () => {
    it('should return all exclusions across all files', () => {
      const fileId2 = db.createFile('src/file2.ts', 'file2.ts');
      db.addFileTagExclusion(fileId, 'tag1');
      db.addFileTagExclusion(fileId2, 'tag2');

      const all = db.getAllFileTagExclusions();
      expect(all).toHaveLength(2);
      expect(all).toContainEqual({ fileId, tagName: 'tag1' });
      expect(all).toContainEqual({ fileId: fileId2, tagName: 'tag2' });
    });
  });

  describe('getEffectiveInheritedTags', () => {
    beforeEach(() => {
      db.createFolderRule('src', ['inherited1', 'inherited2', 'inherited3']);
    });

    it('should return inherited tags minus exclusions', () => {
      db.addFileTagExclusion(fileId, 'inherited2');

      const effective = db.getEffectiveInheritedTags('src/file.ts', fileId);
      expect(effective).toContain('inherited1');
      expect(effective).toContain('inherited3');
      expect(effective).not.toContain('inherited2');
    });

    it('should return all inherited tags when no exclusions', () => {
      const effective = db.getEffectiveInheritedTags('src/file.ts', fileId);
      expect(effective).toEqual(expect.arrayContaining(['inherited1', 'inherited2', 'inherited3']));
    });
  });

  describe('getEffectiveTags', () => {
    beforeEach(() => {
      db.createFolderRule('src', ['inherited1', 'inherited2']);
      db.addTagToFile(fileId, 'explicit1');
    });

    it('should return both explicit and inherited tags', () => {
      const { explicit, inherited } = db.getEffectiveTags('src/file.ts');
      expect(explicit).toContain('explicit1');
      expect(inherited).toContain('inherited1');
      expect(inherited).toContain('inherited2');
    });

    it('should not duplicate tags in inherited that are also explicit', () => {
      db.addTagToFile(fileId, 'inherited1');

      const { explicit, inherited } = db.getEffectiveTags('src/file.ts');
      expect(explicit).toContain('inherited1');
      expect(inherited).not.toContain('inherited1');
      expect(inherited).toContain('inherited2');
    });

    it('should respect exclusions', () => {
      db.addFileTagExclusion(fileId, 'inherited2');

      const { inherited } = db.getEffectiveTags('src/file.ts');
      expect(inherited).toContain('inherited1');
      expect(inherited).not.toContain('inherited2');
    });

    it('should handle non-existent file gracefully', () => {
      const { explicit, inherited } = db.getEffectiveTags('nonexistent/file.ts');
      expect(explicit).toHaveLength(0);
      expect(inherited).toHaveLength(0);
    });
  });
});
