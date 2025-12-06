/**
 * Tests for TagManagerSqlite template operations
 *
 * These tests verify the TagManager integration with templates,
 * using sql.js directly (no VS Code context needed).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from '../database/schema';
import { nanoid } from 'nanoid';

/**
 * Simplified TagManagerSqlite for testing (no vscode dependencies)
 */
class TestTagManager {
  private pathToIdCache: Map<string, string> = new Map();

  constructor(private db: Database) {}

  // ============== Database helpers ==============

  private run(sql: string, params: unknown[] = []): void {
    this.db.run(sql, params as (string | number | Uint8Array | null)[]);
  }

  private query<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | Uint8Array | null)[]);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  private queryOne<T>(sql: string, params: unknown[] = []): T | null {
    const results = this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  // ============== File operations ==============

  addTags(path: string, tags: string[]): void {
    let fileId = this.pathToIdCache.get(path);

    if (!fileId) {
      const existing = this.queryOne<{ id: string }>('SELECT id FROM files WHERE path = ?', [path]);
      if (existing) {
        fileId = existing.id;
        this.pathToIdCache.set(path, fileId);
      }
    }

    if (!fileId) {
      fileId = nanoid(12);
      const now = Date.now();
      this.run(
        `INSERT INTO files (id, path, filename, status, created_at) VALUES (?, ?, ?, 'ok', ?)`,
        [fileId, path, path.split('/').pop() || path, now]
      );
      this.pathToIdCache.set(path, fileId);
    }

    for (const tag of tags) {
      const normalizedTag = tag.toLowerCase().trim();
      
      // Ensure tag exists
      if (!this.queryOne('SELECT name FROM tags WHERE name = ?', [normalizedTag])) {
        this.run(
          `INSERT INTO tags (name, display_name, visibility, created_at) VALUES (?, ?, 'normal', ?)`,
          [normalizedTag, tag, Date.now()]
        );
      }

      // Add tag to file
      if (!this.queryOne('SELECT id FROM tag_instances WHERE file_id = ? AND tag_name = ?', [fileId, normalizedTag])) {
        this.run(
          `INSERT INTO tag_instances (id, file_id, tag_name, created_at) VALUES (?, ?, ?, ?)`,
          [nanoid(), fileId, normalizedTag, Date.now()]
        );
      }
    }
  }

  removeTags(path: string, tags: string[]): void {
    const fileId = this.pathToIdCache.get(path);
    if (!fileId) return;

    for (const tag of tags) {
      this.run('DELETE FROM tag_instances WHERE file_id = ? AND tag_name = ?', [fileId, tag.toLowerCase().trim()]);
    }
  }

  getTags(path: string): string[] {
    const fileId = this.pathToIdCache.get(path);
    if (!fileId) return [];

    const results = this.query<{ tag_name: string }>('SELECT tag_name FROM tag_instances WHERE file_id = ?', [fileId]);
    return results.map((r) => r.tag_name);
  }

  // ============== Template operations ==============

  createTemplate(
    name: string,
    tagsToAdd: string[],
    options?: {
      description?: string;
      tagsToRemove?: string[];
    }
  ): string {
    const id = nanoid();
    const now = Date.now();
    this.run(
      `INSERT INTO tag_templates (id, name, description, tags_to_add, tags_to_remove, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        options?.description ?? null,
        JSON.stringify(tagsToAdd.map((t) => t.toLowerCase())),
        options?.tagsToRemove ? JSON.stringify(options.tagsToRemove.map((t) => t.toLowerCase())) : null,
        now,
      ]
    );
    return id;
  }

  getTemplate(id: string): { id: string; name: string; tagsToAdd: string[]; tagsToRemove: string[] } | null {
    const result = this.queryOne<{ id: string; name: string; tags_to_add: string; tags_to_remove: string | null }>(
      'SELECT * FROM tag_templates WHERE id = ?',
      [id]
    );
    if (!result) return null;
    return {
      id: result.id,
      name: result.name,
      tagsToAdd: JSON.parse(result.tags_to_add),
      tagsToRemove: result.tags_to_remove ? JSON.parse(result.tags_to_remove) : [],
    };
  }

  getAllTemplates(): Array<{ id: string; name: string; tagsToAdd: string[]; tagsToRemove: string[] }> {
    const results = this.query<{ id: string; name: string; tags_to_add: string; tags_to_remove: string | null }>(
      'SELECT * FROM tag_templates ORDER BY name'
    );
    return results.map((r) => ({
      id: r.id,
      name: r.name,
      tagsToAdd: JSON.parse(r.tags_to_add),
      tagsToRemove: r.tags_to_remove ? JSON.parse(r.tags_to_remove) : [],
    }));
  }

  deleteTemplate(id: string): boolean {
    const existing = this.getTemplate(id);
    if (!existing) return false;
    this.run('DELETE FROM tag_templates WHERE id = ?', [id]);
    return true;
  }

  applyTemplate(path: string, templateId: string): boolean {
    const template = this.getTemplate(templateId);
    if (!template) return false;

    // Remove tags first
    if (template.tagsToRemove.length > 0) {
      this.removeTags(path, template.tagsToRemove);
    }

    // Add tags
    if (template.tagsToAdd.length > 0) {
      this.addTags(path, template.tagsToAdd);
    }

    return true;
  }
}

describe('TagManager Template Operations', () => {
  let SQL: SqlJsStatic;
  let rawDb: Database;
  let tagManager: TestTagManager;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  beforeEach(() => {
    rawDb = new SQL.Database();
    rawDb.run(SCHEMA_SQL);
    rawDb.run("INSERT INTO schema_info (key, value) VALUES ('version', ?)", [
      SCHEMA_VERSION.toString(),
    ]);
    tagManager = new TestTagManager(rawDb);
  });

  afterAll(() => {
    rawDb?.close();
  });

  describe('applyTemplate', () => {
    it('should apply tags from template to file', () => {
      const templateId = tagManager.createTemplate('Test Template', ['ml', 'paper', 'unread']);

      tagManager.applyTemplate('test.pdf', templateId);

      const tags = tagManager.getTags('test.pdf');
      expect(tags).toContain('ml');
      expect(tags).toContain('paper');
      expect(tags).toContain('unread');
    });

    it('should remove tags when applying template', () => {
      // First, add some tags to the file
      tagManager.addTags('test.pdf', ['draft', 'wip', 'ml']);

      // Create template that adds 'read' and removes 'draft', 'wip'
      const templateId = tagManager.createTemplate('Mark Complete', ['read'], {
        tagsToRemove: ['draft', 'wip'],
      });

      tagManager.applyTemplate('test.pdf', templateId);

      const tags = tagManager.getTags('test.pdf');
      expect(tags).toContain('read');
      expect(tags).toContain('ml'); // Should still have ml
      expect(tags).not.toContain('draft');
      expect(tags).not.toContain('wip');
    });

    it('should return false for non-existent template', () => {
      const result = tagManager.applyTemplate('test.pdf', 'non-existent');
      expect(result).toBe(false);
    });

    it('should work with "New ML Paper" workflow', () => {
      const templateId = tagManager.createTemplate('New ML Paper', ['ml', 'paper', 'unread', 'to-annotate'], {
        description: 'Apply to newly downloaded ML papers',
      });

      tagManager.applyTemplate('transformer.pdf', templateId);
      tagManager.applyTemplate('attention.pdf', templateId);

      expect(tagManager.getTags('transformer.pdf')).toEqual(['ml', 'paper', 'unread', 'to-annotate']);
      expect(tagManager.getTags('attention.pdf')).toEqual(['ml', 'paper', 'unread', 'to-annotate']);
    });

    it('should work with "Mark Read" workflow', () => {
      // Setup: file has unread tags
      tagManager.addTags('paper.pdf', ['ml', 'paper', 'unread', 'to-read']);

      // Create "Mark Read" template
      const templateId = tagManager.createTemplate('Mark Read', ['read'], {
        tagsToRemove: ['unread', 'to-read'],
      });

      tagManager.applyTemplate('paper.pdf', templateId);

      const tags = tagManager.getTags('paper.pdf');
      expect(tags).toContain('read');
      expect(tags).toContain('ml');
      expect(tags).toContain('paper');
      expect(tags).not.toContain('unread');
      expect(tags).not.toContain('to-read');
    });

    it('should work with "Archive" workflow', () => {
      // Setup: file has active tags
      tagManager.addTags('project.md', ['active', 'urgent', 'wip', 'project']);

      // Create "Archive" template
      const templateId = tagManager.createTemplate('Archive', ['archived'], {
        tagsToRemove: ['active', 'urgent', 'wip', 'in-progress'],
      });

      tagManager.applyTemplate('project.md', templateId);

      const tags = tagManager.getTags('project.md');
      expect(tags).toContain('archived');
      expect(tags).toContain('project'); // Still has project tag
      expect(tags).not.toContain('active');
      expect(tags).not.toContain('urgent');
      expect(tags).not.toContain('wip');
    });
  });

  describe('template CRUD through TagManager', () => {
    it('should create and retrieve templates', () => {
      const id = tagManager.createTemplate('Test', ['a', 'b']);
      
      const template = tagManager.getTemplate(id);
      expect(template).not.toBeNull();
      expect(template!.name).toBe('Test');
      expect(template!.tagsToAdd).toEqual(['a', 'b']);
    });

    it('should list all templates', () => {
      tagManager.createTemplate('Alpha', ['a']);
      tagManager.createTemplate('Bravo', ['b']);
      tagManager.createTemplate('Charlie', ['c']);

      const templates = tagManager.getAllTemplates();
      expect(templates.length).toBe(3);
      expect(templates.map((t) => t.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('should delete templates', () => {
      const id = tagManager.createTemplate('To Delete', ['x']);
      expect(tagManager.getTemplate(id)).not.toBeNull();

      const result = tagManager.deleteTemplate(id);
      expect(result).toBe(true);
      expect(tagManager.getTemplate(id)).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle applying template to non-existent file (creates file)', () => {
      const templateId = tagManager.createTemplate('Test', ['tag1']);
      
      tagManager.applyTemplate('new-file.pdf', templateId);
      
      const tags = tagManager.getTags('new-file.pdf');
      expect(tags).toContain('tag1');
    });

    it('should handle template with empty tagsToRemove', () => {
      const templateId = tagManager.createTemplate('Add Only', ['new-tag']);
      tagManager.addTags('file.pdf', ['existing']);

      tagManager.applyTemplate('file.pdf', templateId);

      const tags = tagManager.getTags('file.pdf');
      expect(tags).toContain('existing');
      expect(tags).toContain('new-tag');
    });

    it('should handle removing tags that do not exist on file', () => {
      const templateId = tagManager.createTemplate('Test', ['add'], {
        tagsToRemove: ['does-not-exist'],
      });

      // Should not throw
      tagManager.applyTemplate('file.pdf', templateId);
      
      const tags = tagManager.getTags('file.pdf');
      expect(tags).toContain('add');
    });

    it('should handle duplicate tags in template', () => {
      // addTags should handle duplicates gracefully
      tagManager.addTags('file.pdf', ['dup', 'dup', 'dup']);
      
      const tags = tagManager.getTags('file.pdf');
      expect(tags.filter((t) => t === 'dup').length).toBe(1);
    });
  });
});

