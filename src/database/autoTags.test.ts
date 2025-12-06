/**
 * Tests for folder auto-tag operations
 *
 * Uses sql.js directly for database operations (no VS Code context needed)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { DbFolderAutoTag, FolderAutoTagRule, TagExpression } from './types';
import { nanoid } from 'nanoid';

/**
 * Helper class that mirrors LatticeDatabase auto-tag methods for testing
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

  // Auto-tag rule operations
  getAllAutoTagRules(): FolderAutoTagRule[] {
    const dbRules = this.query<DbFolderAutoTag>(
      'SELECT * FROM folder_auto_tags ORDER BY folder_pattern ASC'
    );
    return dbRules.map((r) => this.parseAutoTagRule(r));
  }

  getAutoTagRule(id: string): FolderAutoTagRule | null {
    const result = this.queryOne<DbFolderAutoTag>(
      'SELECT * FROM folder_auto_tags WHERE id = ?',
      [id]
    );
    return result ? this.parseAutoTagRule(result) : null;
  }

  getAutoTagRulesForPath(filePath: string): FolderAutoTagRule[] {
    const allRules = this.getAllAutoTagRules().filter((r) => r.enabled);

    return allRules.filter((rule) => {
      const pattern = rule.folderPattern;

      if (pattern.endsWith('/**')) {
        const prefix = pattern.slice(0, -3);
        return filePath.startsWith(prefix + '/') || filePath === prefix;
      } else if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        const relativePath = filePath.slice(prefix.length + 1);
        return filePath.startsWith(prefix + '/') && !relativePath.includes('/');
      } else {
        return filePath.startsWith(pattern + '/');
      }
    });
  }

  createAutoTagRule(
    folderPattern: string,
    tagsToApply: string[],
    options: {
      templateId?: string;
      conditions?: TagExpression;
      enabled?: boolean;
    } = {}
  ): string {
    const id = nanoid();
    const { templateId = null, conditions = null, enabled = true } = options;

    this.run(
      `INSERT INTO folder_auto_tags (id, folder_pattern, tags_to_apply, template_id, conditions, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        folderPattern,
        JSON.stringify(tagsToApply.map((t) => t.toLowerCase())),
        templateId,
        conditions ? JSON.stringify(conditions) : null,
        enabled ? 1 : 0,
        Date.now(),
      ]
    );
    return id;
  }

  updateAutoTagRule(
    id: string,
    updates: {
      folderPattern?: string;
      tagsToApply?: string[];
      templateId?: string | null;
      conditions?: TagExpression | null;
      enabled?: boolean;
    }
  ): boolean {
    const existing = this.getAutoTagRule(id);
    if (!existing) {
      return false;
    }

    const newPattern = updates.folderPattern ?? existing.folderPattern;
    const newTags = updates.tagsToApply ?? existing.tagsToApply;
    const newTemplateId = updates.templateId !== undefined ? updates.templateId : existing.templateId;
    const newConditions = updates.conditions !== undefined ? updates.conditions : existing.conditions;
    const newEnabled = updates.enabled ?? existing.enabled;

    this.run(
      `UPDATE folder_auto_tags 
       SET folder_pattern = ?, tags_to_apply = ?, template_id = ?, conditions = ?, enabled = ?
       WHERE id = ?`,
      [
        newPattern,
        JSON.stringify(newTags.map((t) => t.toLowerCase())),
        newTemplateId,
        newConditions ? JSON.stringify(newConditions) : null,
        newEnabled ? 1 : 0,
        id,
      ]
    );
    return true;
  }

  deleteAutoTagRule(id: string): boolean {
    const result = this.run('DELETE FROM folder_auto_tags WHERE id = ?', [id]);
    return result.changes > 0;
  }

  setAutoTagRuleEnabled(id: string, enabled: boolean): boolean {
    const result = this.run(
      'UPDATE folder_auto_tags SET enabled = ? WHERE id = ?',
      [enabled ? 1 : 0, id]
    );
    return result.changes > 0;
  }

  parseAutoTagRule(dbRule: DbFolderAutoTag): FolderAutoTagRule {
    return {
      id: dbRule.id,
      folderPattern: dbRule.folder_pattern,
      tagsToApply: JSON.parse(dbRule.tags_to_apply) as string[],
      templateId: dbRule.template_id,
      conditions: dbRule.conditions ? JSON.parse(dbRule.conditions) : null,
      enabled: dbRule.enabled === 1,
      createdAt: dbRule.created_at,
    };
  }

  getAutoTagsForPath(filePath: string): string[] {
    const rules = this.getAutoTagRulesForPath(filePath);
    const tags = new Set<string>();

    for (const rule of rules) {
      for (const tag of rule.tagsToApply) {
        tags.add(tag);
      }
    }

    return Array.from(tags);
  }
}

describe('Folder Auto-Tag Rules', () => {
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

  describe('createAutoTagRule', () => {
    it('should create a rule with basic options', () => {
      const id = db.createAutoTagRule('src/components/**', ['frontend', 'react']);
      expect(id).toBeTruthy();

      const rule = db.getAutoTagRule(id);
      expect(rule).not.toBeNull();
      expect(rule?.folderPattern).toBe('src/components/**');
      expect(rule?.tagsToApply).toEqual(['frontend', 'react']);
      expect(rule?.enabled).toBe(true);
    });

    it('should normalize tags to lowercase', () => {
      const id = db.createAutoTagRule('src/**', ['Frontend', 'REACT']);
      const rule = db.getAutoTagRule(id);
      expect(rule?.tagsToApply).toEqual(['frontend', 'react']);
    });

    it('should support disabled rules', () => {
      const id = db.createAutoTagRule('src/**', ['tag'], { enabled: false });
      const rule = db.getAutoTagRule(id);
      expect(rule?.enabled).toBe(false);
    });

    it('should support conditions', () => {
      const condition: TagExpression = { type: 'extension', ext: '.tsx' };
      const id = db.createAutoTagRule('src/**', ['tag'], { conditions: condition });
      const rule = db.getAutoTagRule(id);
      expect(rule?.conditions).toEqual(condition);
    });

    it('should support template reference', () => {
      const id = db.createAutoTagRule('src/**', ['tag'], { templateId: 'template-123' });
      const rule = db.getAutoTagRule(id);
      expect(rule?.templateId).toBe('template-123');
    });
  });

  describe('updateAutoTagRule', () => {
    let ruleId: string;

    beforeEach(() => {
      ruleId = db.createAutoTagRule('src/**', ['initial']);
    });

    it('should update folder pattern', () => {
      db.updateAutoTagRule(ruleId, { folderPattern: 'lib/**' });
      const rule = db.getAutoTagRule(ruleId);
      expect(rule?.folderPattern).toBe('lib/**');
    });

    it('should update tags', () => {
      db.updateAutoTagRule(ruleId, { tagsToApply: ['updated', 'tags'] });
      const rule = db.getAutoTagRule(ruleId);
      expect(rule?.tagsToApply).toEqual(['updated', 'tags']);
    });

    it('should update enabled status', () => {
      db.updateAutoTagRule(ruleId, { enabled: false });
      const rule = db.getAutoTagRule(ruleId);
      expect(rule?.enabled).toBe(false);
    });

    it('should return false for non-existent rule', () => {
      const result = db.updateAutoTagRule('nonexistent', { enabled: false });
      expect(result).toBe(false);
    });
  });

  describe('deleteAutoTagRule', () => {
    it('should delete a rule', () => {
      const id = db.createAutoTagRule('src/**', ['tag']);
      expect(db.getAutoTagRule(id)).not.toBeNull();

      const result = db.deleteAutoTagRule(id);
      expect(result).toBe(true);
      expect(db.getAutoTagRule(id)).toBeNull();
    });

    it('should return false for non-existent rule', () => {
      const result = db.deleteAutoTagRule('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('setAutoTagRuleEnabled', () => {
    it('should enable a disabled rule', () => {
      const id = db.createAutoTagRule('src/**', ['tag'], { enabled: false });
      expect(db.getAutoTagRule(id)?.enabled).toBe(false);

      db.setAutoTagRuleEnabled(id, true);
      expect(db.getAutoTagRule(id)?.enabled).toBe(true);
    });

    it('should disable an enabled rule', () => {
      const id = db.createAutoTagRule('src/**', ['tag']);
      expect(db.getAutoTagRule(id)?.enabled).toBe(true);

      db.setAutoTagRuleEnabled(id, false);
      expect(db.getAutoTagRule(id)?.enabled).toBe(false);
    });
  });

  describe('getAllAutoTagRules', () => {
    it('should return all rules ordered by pattern', () => {
      db.createAutoTagRule('docs/**', ['doc']);
      db.createAutoTagRule('src/**', ['source']);
      db.createAutoTagRule('lib/**', ['library']);

      const rules = db.getAllAutoTagRules();
      expect(rules).toHaveLength(3);
      expect(rules[0].folderPattern).toBe('docs/**');
      expect(rules[1].folderPattern).toBe('lib/**');
      expect(rules[2].folderPattern).toBe('src/**');
    });

    it('should return empty array when no rules exist', () => {
      const rules = db.getAllAutoTagRules();
      expect(rules).toHaveLength(0);
    });
  });

  describe('getAutoTagRulesForPath', () => {
    beforeEach(() => {
      // Recursive rule for src
      db.createAutoTagRule('src/**', ['source']);
      // Non-recursive rule for components
      db.createAutoTagRule('src/components/*', ['component']);
      // Recursive rule for utils
      db.createAutoTagRule('src/utils/**', ['utility']);
      // Disabled rule
      db.createAutoTagRule('docs/**', ['documentation'], { enabled: false });
    });

    it('should match recursive patterns', () => {
      const rules = db.getAutoTagRulesForPath('src/components/Button.tsx');
      const patterns = rules.map((r) => r.folderPattern);
      expect(patterns).toContain('src/**');
    });

    it('should match non-recursive patterns for direct children only', () => {
      const rulesDirectChild = db.getAutoTagRulesForPath('src/components/Button.tsx');
      expect(rulesDirectChild.some((r) => r.folderPattern === 'src/components/*')).toBe(true);

      const rulesNested = db.getAutoTagRulesForPath('src/components/forms/Input.tsx');
      expect(rulesNested.some((r) => r.folderPattern === 'src/components/*')).toBe(false);
    });

    it('should not include disabled rules', () => {
      const rules = db.getAutoTagRulesForPath('docs/README.md');
      expect(rules).toHaveLength(0);
    });

    it('should match multiple rules', () => {
      const rules = db.getAutoTagRulesForPath('src/utils/helpers.ts');
      expect(rules).toHaveLength(2); // src/** and src/utils/**
    });
  });

  describe('getAutoTagsForPath', () => {
    beforeEach(() => {
      db.createAutoTagRule('src/**', ['source']);
      db.createAutoTagRule('src/components/**', ['component', 'react']);
      db.createAutoTagRule('src/utils/**', ['utility']);
    });

    it('should get all auto-tags from matching rules', () => {
      const tags = db.getAutoTagsForPath('src/components/Button.tsx');
      expect(tags).toContain('source');
      expect(tags).toContain('component');
      expect(tags).toContain('react');
    });

    it('should deduplicate tags from multiple rules', () => {
      // Add another rule with overlapping tag
      db.createAutoTagRule('src/components/forms/**', ['source', 'form']);
      
      const tags = db.getAutoTagsForPath('src/components/forms/Input.tsx');
      expect(tags.filter((t) => t === 'source')).toHaveLength(1);
      expect(tags).toContain('form');
    });

    it('should return empty array for non-matching path', () => {
      const tags = db.getAutoTagsForPath('other/file.ts');
      expect(tags).toHaveLength(0);
    });
  });
});

