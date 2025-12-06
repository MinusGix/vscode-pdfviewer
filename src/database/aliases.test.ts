/**
 * Tests for Tag Alias operations
 *
 * Uses sql.js directly for database operations (no VS Code context needed)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { DbTagAlias } from './types';

/**
 * Helper class that mirrors LatticeDatabase alias methods for testing
 */
class TestDatabase {
  constructor(private db: Database) {}

  run(sql: string, params: unknown[] = []): void {
    this.db.run(sql, params as (string | number | Uint8Array | null)[]);
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

  // Tag operations
  upsertTag(name: string, displayName: string, color?: string | null): void {
    const now = Date.now();
    this.run(
      `INSERT INTO tags (name, display_name, color, visibility, created_at)
       VALUES (?, ?, ?, 'normal', ?)
       ON CONFLICT(name) DO UPDATE SET display_name = excluded.display_name`,
      [name.toLowerCase(), displayName, color ?? null, now]
    );
  }

  getTag(name: string): { name: string; display_name: string } | null {
    return this.queryOne('SELECT * FROM tags WHERE name = ?', [name.toLowerCase()]);
  }

  // Alias operations
  createAlias(alias: string, primaryTag: string): boolean {
    const normalizedAlias = alias.toLowerCase().trim();
    const normalizedPrimary = primaryTag.toLowerCase().trim();

    if (this.getAlias(normalizedAlias)) {
      return false;
    }

    if (!this.getTag(normalizedPrimary)) {
      this.upsertTag(normalizedPrimary, primaryTag);
    }

    this.run(
      'INSERT INTO tag_aliases (alias, primary_tag) VALUES (?, ?)',
      [normalizedAlias, normalizedPrimary]
    );
    return true;
  }

  getAlias(alias: string): DbTagAlias | null {
    return this.queryOne<DbTagAlias>(
      'SELECT * FROM tag_aliases WHERE alias = ?',
      [alias.toLowerCase().trim()]
    );
  }

  resolveAlias(tagName: string): string {
    const normalized = tagName.toLowerCase().trim();
    const alias = this.getAlias(normalized);
    return alias ? alias.primary_tag : normalized;
  }

  resolveAliases(tagNames: string[]): string[] {
    return tagNames.map((t) => this.resolveAlias(t));
  }

  getAliasesForTag(primaryTag: string): string[] {
    const results = this.query<DbTagAlias>(
      'SELECT * FROM tag_aliases WHERE primary_tag = ?',
      [primaryTag.toLowerCase().trim()]
    );
    return results.map((r) => r.alias);
  }

  getAllAliases(): DbTagAlias[] {
    return this.query<DbTagAlias>('SELECT * FROM tag_aliases ORDER BY alias');
  }

  deleteAlias(alias: string): boolean {
    const existing = this.getAlias(alias);
    if (!existing) return false;

    this.run('DELETE FROM tag_aliases WHERE alias = ?', [alias.toLowerCase().trim()]);
    return true;
  }

  updateAlias(alias: string, newPrimaryTag: string): boolean {
    const normalizedAlias = alias.toLowerCase().trim();
    const normalizedPrimary = newPrimaryTag.toLowerCase().trim();

    const existing = this.getAlias(normalizedAlias);
    if (!existing) return false;

    if (!this.getTag(normalizedPrimary)) {
      this.upsertTag(normalizedPrimary, newPrimaryTag);
    }

    this.run(
      'UPDATE tag_aliases SET primary_tag = ? WHERE alias = ?',
      [normalizedPrimary, normalizedAlias]
    );
    return true;
  }

  isAlias(tagName: string): boolean {
    return this.getAlias(tagName) !== null;
  }
}

describe('Tag Alias Operations', () => {
  let SQL: SqlJsStatic;
  let rawDb: Database;
  let db: TestDatabase;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  beforeEach(() => {
    rawDb = new SQL.Database();
    rawDb.run(SCHEMA_SQL);
    rawDb.run("INSERT INTO schema_info (key, value) VALUES ('version', ?)", [
      SCHEMA_VERSION.toString(),
    ]);
    db = new TestDatabase(rawDb);
  });

  afterAll(() => {
    rawDb?.close();
  });

  describe('createAlias', () => {
    it('should create a simple alias', () => {
      db.upsertTag('machine-learning', 'Machine Learning');

      const result = db.createAlias('ml', 'machine-learning');

      expect(result).toBe(true);
      expect(db.getAlias('ml')).not.toBeNull();
      expect(db.getAlias('ml')!.primary_tag).toBe('machine-learning');
    });

    it('should auto-create primary tag if it does not exist', () => {
      expect(db.getTag('neural-networks')).toBeNull();

      db.createAlias('nn', 'neural-networks');

      expect(db.getTag('neural-networks')).not.toBeNull();
      expect(db.getAlias('nn')!.primary_tag).toBe('neural-networks');
    });

    it('should normalize alias to lowercase', () => {
      db.createAlias('ML', 'machine-learning');

      expect(db.getAlias('ml')).not.toBeNull();
      expect(db.getAlias('ML')).not.toBeNull(); // Should find same alias
    });

    it('should return false if alias already exists', () => {
      db.createAlias('ml', 'machine-learning');

      const result = db.createAlias('ml', 'different-tag');

      expect(result).toBe(false);
      expect(db.getAlias('ml')!.primary_tag).toBe('machine-learning'); // Unchanged
    });
  });

  describe('resolveAlias', () => {
    it('should resolve alias to primary tag', () => {
      db.createAlias('ml', 'machine-learning');

      expect(db.resolveAlias('ml')).toBe('machine-learning');
      expect(db.resolveAlias('ML')).toBe('machine-learning'); // Case insensitive
    });

    it('should return tag as-is if not an alias', () => {
      expect(db.resolveAlias('some-tag')).toBe('some-tag');
      expect(db.resolveAlias('Another Tag')).toBe('another tag'); // Normalized
    });

    it('should resolve multiple aliases at once', () => {
      db.createAlias('ml', 'machine-learning');
      db.createAlias('dl', 'deep-learning');
      db.createAlias('nn', 'neural-networks');

      const resolved = db.resolveAliases(['ml', 'dl', 'regular-tag', 'nn']);

      expect(resolved).toEqual([
        'machine-learning',
        'deep-learning',
        'regular-tag',
        'neural-networks',
      ]);
    });
  });

  describe('getAliasesForTag', () => {
    it('should return all aliases for a tag', () => {
      db.upsertTag('machine-learning', 'Machine Learning');
      db.createAlias('ml', 'machine-learning');
      db.createAlias('machinelearning', 'machine-learning');
      db.createAlias('ai-ml', 'machine-learning');

      const aliases = db.getAliasesForTag('machine-learning');

      expect(aliases).toHaveLength(3);
      expect(aliases).toContain('ml');
      expect(aliases).toContain('machinelearning');
      expect(aliases).toContain('ai-ml');
    });

    it('should return empty array for tag with no aliases', () => {
      db.upsertTag('lonely-tag', 'Lonely Tag');

      const aliases = db.getAliasesForTag('lonely-tag');

      expect(aliases).toEqual([]);
    });
  });

  describe('getAllAliases', () => {
    it('should return empty array when no aliases exist', () => {
      expect(db.getAllAliases()).toEqual([]);
    });

    it('should return all aliases sorted by alias name', () => {
      db.createAlias('zz', 'zebra');
      db.createAlias('aa', 'alpha');
      db.createAlias('mm', 'middle');

      const aliases = db.getAllAliases();

      expect(aliases.length).toBe(3);
      expect(aliases[0].alias).toBe('aa');
      expect(aliases[1].alias).toBe('mm');
      expect(aliases[2].alias).toBe('zz');
    });
  });

  describe('deleteAlias', () => {
    it('should delete an alias', () => {
      db.createAlias('ml', 'machine-learning');
      expect(db.getAlias('ml')).not.toBeNull();

      const result = db.deleteAlias('ml');

      expect(result).toBe(true);
      expect(db.getAlias('ml')).toBeNull();
    });

    it('should return false for non-existent alias', () => {
      const result = db.deleteAlias('non-existent');
      expect(result).toBe(false);
    });

    it('should not delete the primary tag', () => {
      db.upsertTag('machine-learning', 'Machine Learning');
      db.createAlias('ml', 'machine-learning');

      db.deleteAlias('ml');

      expect(db.getTag('machine-learning')).not.toBeNull();
    });
  });

  describe('updateAlias', () => {
    it('should update alias to point to different tag', () => {
      db.createAlias('ai', 'artificial-intelligence');

      const result = db.updateAlias('ai', 'machine-learning');

      expect(result).toBe(true);
      expect(db.getAlias('ai')!.primary_tag).toBe('machine-learning');
    });

    it('should return false for non-existent alias', () => {
      const result = db.updateAlias('non-existent', 'some-tag');
      expect(result).toBe(false);
    });

    it('should auto-create new primary tag if needed', () => {
      db.createAlias('ai', 'old-tag');

      db.updateAlias('ai', 'new-tag');

      expect(db.getTag('new-tag')).not.toBeNull();
    });
  });

  describe('isAlias', () => {
    it('should return true for aliases', () => {
      db.createAlias('ml', 'machine-learning');

      expect(db.isAlias('ml')).toBe(true);
      expect(db.isAlias('ML')).toBe(true); // Case insensitive
    });

    it('should return false for regular tags', () => {
      db.upsertTag('machine-learning', 'Machine Learning');

      expect(db.isAlias('machine-learning')).toBe(false);
    });

    it('should return false for non-existent tags', () => {
      expect(db.isAlias('does-not-exist')).toBe(false);
    });
  });

  describe('real-world scenarios', () => {
    it('should support multiple aliases for ML synonyms', () => {
      db.upsertTag('machine-learning', 'Machine Learning');

      db.createAlias('ml', 'machine-learning');
      db.createAlias('machinelearning', 'machine-learning');
      db.createAlias('machine_learning', 'machine-learning');
      db.createAlias('deep-learning', 'machine-learning'); // DL often grouped with ML

      const tags = ['ml', 'machinelearning', 'different-tag'];
      const resolved = db.resolveAliases(tags);

      expect(resolved).toEqual([
        'machine-learning',
        'machine-learning',
        'different-tag',
      ]);
    });

    it('should support alternate spellings', () => {
      db.upsertTag('color', 'Color');
      db.createAlias('colour', 'color');

      expect(db.resolveAlias('colour')).toBe('color');
      expect(db.resolveAlias('color')).toBe('color');
    });

    it('should support abbreviations', () => {
      db.createAlias('js', 'javascript');
      db.createAlias('ts', 'typescript');
      db.createAlias('py', 'python');
      db.createAlias('rb', 'ruby');

      expect(db.resolveAlias('js')).toBe('javascript');
      expect(db.resolveAlias('ts')).toBe('typescript');
      expect(db.resolveAlias('py')).toBe('python');
      expect(db.resolveAlias('rb')).toBe('ruby');
    });

    it('should handle import cleanup scenario', () => {
      // AI-generated verbose tags can be aliased to cleaner manual ones
      db.upsertTag('ml', 'ML');
      db.createAlias('artificial-intelligence-machine-learning', 'ml');
      db.createAlias('machine-learning-algorithms', 'ml');
      db.createAlias('ml-models', 'ml');

      const verboseTags = [
        'artificial-intelligence-machine-learning',
        'other-tag',
        'ml-models',
      ];

      const clean = db.resolveAliases(verboseTags);
      expect(clean).toEqual(['ml', 'other-tag', 'ml']);
    });
  });
});

