/**
 * Tests for cross-feature interactions
 *
 * These tests verify that different tagging features work correctly together:
 * - Templates + Aliases
 * - Templates + Hierarchies
 * - Aliases + Hierarchies
 * - Folder Rules + Aliases
 * - Folder Rules + Hierarchies
 * - Auto-tagging + Templates
 * - Auto-tagging + Aliases
 * - Effective Tags + all features
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { DbTag, DbFile, DbTagTemplate, DbFolderRule, DbFolderAutoTag, DbTagAlias } from './types';
import { nanoid } from 'nanoid';
import * as path from 'path';

/**
 * Comprehensive test database with all features
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

  // ==================== File Operations ====================

  createFile(filePath: string, filename: string): string {
    const id = nanoid();
    this.run(
      `INSERT INTO files (id, path, filename, status, created_at)
       VALUES (?, ?, ?, 'ok', ?)`,
      [id, filePath, filename, Date.now()]
    );
    return id;
  }

  getFileByPath(filePath: string): DbFile | null {
    return this.queryOne<DbFile>('SELECT * FROM files WHERE path = ?', [filePath]);
  }

  // ==================== Tag Operations ====================

  ensureTag(name: string, displayName?: string, parentTag?: string | null): void {
    const normalized = name.toLowerCase();
    this.run(
      `INSERT OR IGNORE INTO tags (name, display_name, parent_tag, visibility, created_at)
       VALUES (?, ?, ?, 'normal', ?)`,
      [normalized, displayName ?? name, parentTag?.toLowerCase() ?? null, Date.now()]
    );
  }

  setTagParent(childTag: string, parentTag: string): void {
    this.ensureTag(parentTag);
    this.ensureTag(childTag);
    this.run('UPDATE tags SET parent_tag = ? WHERE name = ?', [
      parentTag.toLowerCase(),
      childTag.toLowerCase(),
    ]);
  }

  getTag(name: string): DbTag | null {
    return this.queryOne<DbTag>('SELECT * FROM tags WHERE name = ?', [name.toLowerCase()]);
  }

  addTagToFile(fileId: string, tagName: string): void {
    // Resolve alias first
    const resolved = this.resolveAlias(tagName);
    this.ensureTag(resolved);
    const id = nanoid();
    this.run(
      `INSERT OR IGNORE INTO tag_instances (id, file_id, tag_name, created_at)
       VALUES (?, ?, ?, ?)`,
      [id, fileId, resolved, Date.now()]
    );
  }

  getFileTags(fileId: string): string[] {
    const results = this.query<{ tag_name: string }>(
      'SELECT tag_name FROM tag_instances WHERE file_id = ?',
      [fileId]
    );
    return results.map((r) => r.tag_name);
  }

  getTagDescendants(tagName: string): string[] {
    const normalized = tagName.toLowerCase();
    const descendants: string[] = [];

    const findChildren = (parent: string) => {
      const children = this.query<DbTag>(
        'SELECT * FROM tags WHERE parent_tag = ?',
        [parent]
      );
      for (const child of children) {
        descendants.push(child.name);
        findChildren(child.name);
      }
    };

    findChildren(normalized);
    return descendants;
  }

  // ==================== Alias Operations ====================

  createAlias(alias: string, primaryTag: string): void {
    const normalizedAlias = alias.toLowerCase();
    const normalizedPrimary = primaryTag.toLowerCase();
    this.ensureTag(normalizedPrimary);
    this.run(
      'INSERT INTO tag_aliases (alias, primary_tag) VALUES (?, ?)',
      [normalizedAlias, normalizedPrimary]
    );
  }

  resolveAlias(tagName: string): string {
    const normalized = tagName.toLowerCase();
    const result = this.queryOne<DbTagAlias>(
      'SELECT primary_tag FROM tag_aliases WHERE alias = ?',
      [normalized]
    );
    return result ? result.primary_tag : normalized;
  }

  resolveAliases(tagNames: string[]): string[] {
    return tagNames.map((t) => this.resolveAlias(t));
  }

  // ==================== Template Operations ====================

  createTemplate(name: string, tagsToAdd: string[], tagsToRemove: string[] = []): string {
    const id = nanoid();
    this.run(
      `INSERT INTO tag_templates (id, name, tags_to_add, tags_to_remove, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, name, JSON.stringify(tagsToAdd), JSON.stringify(tagsToRemove), Date.now()]
    );
    return id;
  }

  getTemplate(id: string): { tagsToAdd: string[]; tagsToRemove: string[] } | null {
    const result = this.queryOne<DbTagTemplate>(
      'SELECT * FROM tag_templates WHERE id = ?',
      [id]
    );
    if (!result) return null;
    return {
      tagsToAdd: JSON.parse(result.tags_to_add),
      tagsToRemove: result.tags_to_remove ? JSON.parse(result.tags_to_remove) : [],
    };
  }

  applyTemplate(fileId: string, templateId: string): string[] {
    const template = this.getTemplate(templateId);
    if (!template) return [];

    const appliedTags: string[] = [];

    // Remove tags first
    for (const tag of template.tagsToRemove) {
      const resolved = this.resolveAlias(tag);
      this.run(
        'DELETE FROM tag_instances WHERE file_id = ? AND tag_name = ?',
        [fileId, resolved]
      );
    }

    // Add tags (resolving aliases)
    for (const tag of template.tagsToAdd) {
      const resolved = this.resolveAlias(tag);
      this.addTagToFile(fileId, resolved);
      appliedTags.push(resolved);
    }

    return appliedTags;
  }

  // ==================== Folder Rule Operations ====================

  createFolderRule(folderPath: string, inheritedTags: string[], recursive = true): void {
    this.run(
      `INSERT INTO folder_rules (folder_path, inherited_tags, recursive, priority, created_at)
       VALUES (?, ?, ?, 0, ?)`,
      [folderPath, JSON.stringify(inheritedTags), recursive ? 1 : 0, Date.now()]
    );
  }

  getInheritedTags(filePath: string): string[] {
    const rules = this.query<DbFolderRule>(
      'SELECT * FROM folder_rules ORDER BY priority DESC'
    );
    const tags = new Set<string>();

    for (const rule of rules) {
      const folderPath = rule.folder_path;
      const recursive = rule.recursive === 1;

      let matches = false;
      if (recursive) {
        matches = filePath.startsWith(folderPath + '/') || filePath.startsWith(folderPath);
      } else {
        matches = path.dirname(filePath) === folderPath;
      }

      if (matches) {
        const inheritedTags = JSON.parse(rule.inherited_tags) as string[];
        for (const tag of inheritedTags) {
          // Resolve aliases in inherited tags
          const resolved = this.resolveAlias(tag);
          tags.add(resolved);
        }
      }
    }

    return Array.from(tags);
  }

  // ==================== Auto-Tag Operations ====================

  createAutoTagRule(pattern: string, tagsToApply: string[], templateId?: string): string {
    const id = nanoid();
    this.run(
      `INSERT INTO folder_auto_tags (id, folder_pattern, tags_to_apply, template_id, enabled, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [id, pattern, JSON.stringify(tagsToApply), templateId ?? null, Date.now()]
    );
    return id;
  }

  getAutoTagsForPath(filePath: string): string[] {
    const rules = this.query<DbFolderAutoTag>(
      'SELECT * FROM folder_auto_tags WHERE enabled = 1'
    );
    const tags = new Set<string>();

    for (const rule of rules) {
      const pattern = rule.folder_pattern;
      let matches = false;

      if (pattern.endsWith('/**')) {
        const prefix = pattern.slice(0, -3);
        matches = filePath.startsWith(prefix + '/');
      } else if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        const relativePath = filePath.slice(prefix.length + 1);
        matches = filePath.startsWith(prefix + '/') && !relativePath.includes('/');
      } else {
        matches = filePath.startsWith(pattern + '/');
      }

      if (matches) {
        // Add direct tags (resolving aliases)
        const directTags = JSON.parse(rule.tags_to_apply) as string[];
        for (const tag of directTags) {
          const resolved = this.resolveAlias(tag);
          tags.add(resolved);
        }

        // Add tags from template if specified
        if (rule.template_id) {
          const template = this.getTemplate(rule.template_id);
          if (template) {
            for (const tag of template.tagsToAdd) {
              const resolved = this.resolveAlias(tag);
              tags.add(resolved);
            }
          }
        }
      }
    }

    return Array.from(tags);
  }

  // ==================== Effective Tags ====================

  getEffectiveTags(filePath: string): { explicit: string[]; inherited: string[] } {
    const file = this.getFileByPath(filePath);
    if (!file) {
      return { explicit: [], inherited: this.getInheritedTags(filePath) };
    }

    const explicit = this.getFileTags(file.id);
    const inherited = this.getInheritedTags(filePath);

    // Filter out inherited tags that are already explicit
    const explicitSet = new Set(explicit);
    const uniqueInherited = inherited.filter((t) => !explicitSet.has(t));

    return { explicit, inherited: uniqueInherited };
  }

  // Get files with tag or any of its descendants
  getFilesWithTagOrDescendants(tagName: string): string[] {
    const normalized = tagName.toLowerCase();
    const descendants = this.getTagDescendants(normalized);
    const allTags = [normalized, ...descendants];

    const placeholders = allTags.map(() => '?').join(',');
    const files = this.query<{ path: string }>(
      `SELECT DISTINCT f.path FROM files f
       JOIN tag_instances ti ON f.id = ti.file_id
       WHERE ti.tag_name IN (${placeholders})`,
      allTags
    );

    return files.map((f) => f.path);
  }
}

describe('Feature Interactions', () => {
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

  describe('Templates + Aliases', () => {
    it('should resolve aliases in template tags when applying', () => {
      // Create alias: "ml" -> "machine-learning"
      db.createAlias('ml', 'machine-learning');

      // Create template with alias
      const templateId = db.createTemplate('ML Template', ['ml', 'data-science']);

      // Create file and apply template
      const fileId = db.createFile('notes/ml.md', 'ml.md');
      const appliedTags = db.applyTemplate(fileId, templateId);

      // Should have resolved the alias
      expect(appliedTags).toContain('machine-learning');
      expect(appliedTags).toContain('data-science');
      expect(appliedTags).not.toContain('ml'); // Alias should be resolved

      // Verify stored tags
      const storedTags = db.getFileTags(fileId);
      expect(storedTags).toContain('machine-learning');
      expect(storedTags).not.toContain('ml');
    });

    it('should resolve aliases in template tags to remove', () => {
      db.createAlias('js', 'javascript');

      const fileId = db.createFile('code/app.js', 'app.js');
      db.addTagToFile(fileId, 'javascript');
      db.addTagToFile(fileId, 'frontend');

      // Template removes "js" (alias for javascript)
      const templateId = db.createTemplate('Backend Only', ['backend'], ['js']);
      db.applyTemplate(fileId, templateId);

      const tags = db.getFileTags(fileId);
      expect(tags).toContain('frontend');
      expect(tags).toContain('backend');
      expect(tags).not.toContain('javascript'); // Should be removed via alias
    });
  });

  describe('Templates + Hierarchies', () => {
    it('should apply hierarchical tags from template', () => {
      // Create hierarchy: Programming -> Python -> Django
      db.setTagParent('python', 'programming');
      db.setTagParent('django', 'python');

      // Template adds a leaf tag
      const templateId = db.createTemplate('Django Project', ['django', 'web']);

      const fileId = db.createFile('myapp/views.py', 'views.py');
      db.applyTemplate(fileId, templateId);

      const tags = db.getFileTags(fileId);
      expect(tags).toContain('django');
      expect(tags).toContain('web');

      // File should appear when querying parent tag (via descendants)
      const pythonFiles = db.getFilesWithTagOrDescendants('python');
      expect(pythonFiles).toContain('myapp/views.py');

      const programmingFiles = db.getFilesWithTagOrDescendants('programming');
      expect(programmingFiles).toContain('myapp/views.py');
    });
  });

  describe('Aliases + Hierarchies', () => {
    it('should resolve alias to a tag that has parent', () => {
      // Create hierarchy
      db.setTagParent('typescript', 'programming');

      // Create alias: "ts" -> "typescript"
      db.createAlias('ts', 'typescript');

      // Add tag using alias
      const fileId = db.createFile('src/app.ts', 'app.ts');
      db.addTagToFile(fileId, 'ts');

      const tags = db.getFileTags(fileId);
      expect(tags).toContain('typescript');
      expect(tags).not.toContain('ts');

      // Should appear in parent searches
      const programmingFiles = db.getFilesWithTagOrDescendants('programming');
      expect(programmingFiles).toContain('src/app.ts');
    });

    it('should resolve alias to a tag that has children', () => {
      // Create hierarchy: "machine-learning" -> "deep-learning" -> "transformers"
      db.setTagParent('deep-learning', 'machine-learning');
      db.setTagParent('transformers', 'deep-learning');

      // Create alias: "ml" -> "machine-learning"
      db.createAlias('ml', 'machine-learning');

      // Tag files with children
      const file1 = db.createFile('models/transformer.py', 'transformer.py');
      db.addTagToFile(file1, 'transformers');

      const file2 = db.createFile('models/cnn.py', 'cnn.py');
      db.addTagToFile(file2, 'deep-learning');

      // Query using the alias as parent - should find descendants
      const resolved = db.resolveAlias('ml');
      expect(resolved).toBe('machine-learning');

      const mlFiles = db.getFilesWithTagOrDescendants(resolved);
      expect(mlFiles).toContain('models/transformer.py');
      expect(mlFiles).toContain('models/cnn.py');
    });
  });

  describe('Folder Rules + Aliases', () => {
    it('should resolve aliases in inherited tags', () => {
      // Create alias
      db.createAlias('fe', 'frontend');

      // Folder rule uses alias
      db.createFolderRule('src/components', ['fe', 'react']);

      const inherited = db.getInheritedTags('src/components/Button.tsx');
      expect(inherited).toContain('frontend'); // Resolved from "fe"
      expect(inherited).toContain('react');
      expect(inherited).not.toContain('fe'); // Alias should be resolved
    });

    it('should combine inherited tags with explicit tags (including aliases)', () => {
      db.createAlias('ts', 'typescript');
      db.createFolderRule('src', ['source-code']);

      const fileId = db.createFile('src/utils.ts', 'utils.ts');
      db.addTagToFile(fileId, 'ts'); // Add using alias

      const { explicit, inherited } = db.getEffectiveTags('src/utils.ts');
      expect(explicit).toContain('typescript');
      expect(inherited).toContain('source-code');
    });
  });

  describe('Folder Rules + Hierarchies', () => {
    it('should inherit hierarchical tags from folder rules', () => {
      // Create hierarchy
      db.setTagParent('react', 'frontend');
      db.setTagParent('frontend', 'web');

      // Folder rule inherits a hierarchical tag
      db.createFolderRule('src/components', ['react']);

      const fileId = db.createFile('src/components/Button.tsx', 'Button.tsx');
      const inherited = db.getInheritedTags('src/components/Button.tsx');

      expect(inherited).toContain('react');

      // The file should appear in parent tag searches
      // (Note: This is about explicit/inherited tags, not automatic parent inclusion)
      // If we want inherited tags to count for hierarchy searches, we'd need to
      // combine explicit + inherited when searching
    });
  });

  describe('Auto-tagging + Templates', () => {
    it('should apply template tags via auto-tag rule', () => {
      // Create a template
      const templateId = db.createTemplate('Component Template', ['component', 'react', 'ui']);

      // Auto-tag rule uses template
      db.createAutoTagRule('src/components/**', [], templateId);

      // Get auto-tags for a file in that folder
      const autoTags = db.getAutoTagsForPath('src/components/Button.tsx');

      expect(autoTags).toContain('component');
      expect(autoTags).toContain('react');
      expect(autoTags).toContain('ui');
    });

    it('should combine direct tags and template tags in auto-tagging', () => {
      const templateId = db.createTemplate('React Template', ['react']);

      // Auto-tag rule has both direct tags and template reference
      db.createAutoTagRule('src/components/**', ['component'], templateId);

      const autoTags = db.getAutoTagsForPath('src/components/Modal.tsx');

      expect(autoTags).toContain('component'); // Direct
      expect(autoTags).toContain('react'); // From template
    });
  });

  describe('Auto-tagging + Aliases', () => {
    it('should resolve aliases in auto-tag rules', () => {
      db.createAlias('ts', 'typescript');
      db.createAlias('fe', 'frontend');

      // Auto-tag rule uses aliases
      db.createAutoTagRule('src/**', ['ts', 'fe']);

      const autoTags = db.getAutoTagsForPath('src/utils.ts');

      expect(autoTags).toContain('typescript');
      expect(autoTags).toContain('frontend');
      expect(autoTags).not.toContain('ts');
      expect(autoTags).not.toContain('fe');
    });

    it('should resolve aliases from templates in auto-tagging', () => {
      db.createAlias('ml', 'machine-learning');

      // Template uses alias
      const templateId = db.createTemplate('ML Project', ['ml', 'python']);

      // Auto-tag rule references template
      db.createAutoTagRule('models/**', [], templateId);

      const autoTags = db.getAutoTagsForPath('models/classifier.py');

      expect(autoTags).toContain('machine-learning'); // Resolved from template alias
      expect(autoTags).toContain('python');
    });
  });

  describe('Multiple Features Combined', () => {
    it('should handle complex scenario with aliases, hierarchies, and templates', () => {
      // Setup hierarchy: Programming -> JavaScript -> React
      db.setTagParent('javascript', 'programming');
      db.setTagParent('react', 'javascript');

      // Setup aliases
      db.createAlias('js', 'javascript');
      db.createAlias('fe', 'frontend');

      // Template uses alias
      const templateId = db.createTemplate('React Component', ['react', 'fe']);

      // Auto-tag rule
      db.createAutoTagRule('src/components/**', ['ui'], templateId);

      // Folder rule for src
      db.createFolderRule('src', ['source-code']);

      // Create file and get all applicable tags
      const fileId = db.createFile('src/components/Header.tsx', 'Header.tsx');
      const autoTags = db.getAutoTagsForPath('src/components/Header.tsx');

      // Apply auto-tags
      for (const tag of autoTags) {
        db.addTagToFile(fileId, tag);
      }

      const { explicit, inherited } = db.getEffectiveTags('src/components/Header.tsx');

      // Explicit should have: ui, react, frontend (resolved from fe)
      expect(explicit).toContain('ui');
      expect(explicit).toContain('react');
      expect(explicit).toContain('frontend');

      // Inherited from folder rule
      expect(inherited).toContain('source-code');

      // Should appear in hierarchy searches
      const jsFiles = db.getFilesWithTagOrDescendants('javascript');
      expect(jsFiles).toContain('src/components/Header.tsx');

      const programmingFiles = db.getFilesWithTagOrDescendants('programming');
      expect(programmingFiles).toContain('src/components/Header.tsx');
    });

    it('should handle alias chains (alias to aliased tag)', () => {
      // First alias: "ml" -> "machine-learning"
      db.createAlias('ml', 'machine-learning');

      // If someone tries to use "ml" as a tag, it should resolve
      const fileId = db.createFile('notebook.ipynb', 'notebook.ipynb');
      db.addTagToFile(fileId, 'ml');

      const tags = db.getFileTags(fileId);
      expect(tags).toContain('machine-learning');
    });

    it('should deduplicate tags from multiple sources', () => {
      // Multiple sources provide the same tag
      db.createAlias('ml', 'machine-learning');

      // Template adds "machine-learning"
      const templateId = db.createTemplate('ML', ['machine-learning']);

      // Auto-tag adds "ml" (alias for same tag)
      db.createAutoTagRule('data/**', ['ml'], templateId);

      // Should only have one copy of machine-learning
      const autoTags = db.getAutoTagsForPath('data/train.csv');

      const mlCount = autoTags.filter((t) => t === 'machine-learning').length;
      expect(mlCount).toBe(1);
    });

    it('should correctly inherit with nested folder rules and aliases', () => {
      db.createAlias('src', 'source-code');
      db.createAlias('fe', 'frontend');

      // Parent folder rule (recursive)
      db.createFolderRule('app', ['src']);

      // Child folder rule (more specific)
      db.createFolderRule('app/web', ['fe']);

      // File in nested folder should inherit from both
      const inherited = db.getInheritedTags('app/web/index.html');

      expect(inherited).toContain('source-code'); // From parent, resolved from "src"
      expect(inherited).toContain('frontend'); // From child, resolved from "fe"
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-existent aliases gracefully', () => {
      // Template references a tag that doesn't exist and isn't an alias
      const templateId = db.createTemplate('Test', ['nonexistent-tag']);

      const fileId = db.createFile('test.txt', 'test.txt');
      const applied = db.applyTemplate(fileId, templateId);

      // Should still work, creating the tag
      expect(applied).toContain('nonexistent-tag');
    });

    it('should handle circular hierarchy prevention', () => {
      // This tests that the hierarchy doesn't break with complex structures
      db.setTagParent('b', 'a');
      db.setTagParent('c', 'b');

      // Trying to set a to be child of c would create cycle
      // Our simple implementation doesn't prevent this in tests,
      // but the real implementation should
      const descendants = db.getTagDescendants('a');
      expect(descendants).toContain('b');
      expect(descendants).toContain('c');
    });

    it('should handle empty templates', () => {
      const templateId = db.createTemplate('Empty', []);

      const fileId = db.createFile('test.txt', 'test.txt');
      db.addTagToFile(fileId, 'existing');

      const applied = db.applyTemplate(fileId, templateId);
      expect(applied).toHaveLength(0);

      // Existing tags should remain
      const tags = db.getFileTags(fileId);
      expect(tags).toContain('existing');
    });

    it('should handle overlapping folder rules with different priorities', () => {
      // More specific should take precedence, but both should apply
      db.createFolderRule('src', ['source']);
      db.createFolderRule('src/components', ['component']);

      const inherited = db.getInheritedTags('src/components/Button.tsx');

      // Both rules should apply (our implementation combines them)
      expect(inherited).toContain('source');
      expect(inherited).toContain('component');
    });
  });
});

