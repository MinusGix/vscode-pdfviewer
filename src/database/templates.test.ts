/**
 * Tests for Tag Template operations
 *
 * Uses sql.js directly for database operations (no VS Code context needed)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { DbTagTemplate, TagTemplate, TagExpression } from './types';
import { nanoid } from 'nanoid';

/**
 * Helper class that mirrors LatticeDatabase template methods for testing
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

  createTemplate(
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
        options?.tagsToRemove
          ? JSON.stringify(options.tagsToRemove.map((t) => t.toLowerCase()))
          : null,
        options?.shortcut ?? null,
        options?.conditions ? JSON.stringify(options.conditions) : null,
        now,
      ]
    );
    return id;
  }

  getTemplate(id: string): DbTagTemplate | null {
    return this.queryOne<DbTagTemplate>(
      'SELECT * FROM tag_templates WHERE id = ?',
      [id]
    );
  }

  getTemplateByName(name: string): DbTagTemplate | null {
    return this.queryOne<DbTagTemplate>(
      'SELECT * FROM tag_templates WHERE name = ?',
      [name]
    );
  }

  getAllTemplates(): DbTagTemplate[] {
    return this.query<DbTagTemplate>('SELECT * FROM tag_templates ORDER BY name');
  }

  updateTemplate(
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
      params.push(
        updates.tagsToRemove
          ? JSON.stringify(updates.tagsToRemove.map((t) => t.toLowerCase()))
          : null
      );
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

  deleteTemplate(id: string): boolean {
    const existing = this.getTemplate(id);
    if (!existing) return false;

    this.run('DELETE FROM tag_templates WHERE id = ?', [id]);
    return true;
  }

  parseTemplate(dbTemplate: DbTagTemplate): TagTemplate {
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

  getAllTemplatesParsed(): TagTemplate[] {
    return this.getAllTemplates().map((t) => this.parseTemplate(t));
  }
}

describe('Tag Template Operations', () => {
  let SQL: SqlJsStatic;
  let rawDb: Database;
  let db: TestDatabase;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  beforeEach(() => {
    // Fresh database for each test
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

  describe('createTemplate', () => {
    it('should create a simple template', () => {
      const id = db.createTemplate('New Paper', ['paper', 'unread']);

      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');

      const template = db.getTemplate(id);
      expect(template).not.toBeNull();
      expect(template!.name).toBe('New Paper');
      expect(JSON.parse(template!.tags_to_add)).toEqual(['paper', 'unread']);
    });

    it('should normalize tag names to lowercase', () => {
      const id = db.createTemplate('Test', ['ML', 'Research', 'IMPORTANT']);

      const template = db.getTemplate(id);
      const tags = JSON.parse(template!.tags_to_add);

      expect(tags).toEqual(['ml', 'research', 'important']);
    });

    it('should create template with description', () => {
      const id = db.createTemplate('ML Paper', ['ml', 'paper'], {
        description: 'Template for machine learning papers',
      });

      const template = db.getTemplate(id);
      expect(template!.description).toBe('Template for machine learning papers');
    });

    it('should create template with tagsToRemove', () => {
      const id = db.createTemplate('Mark Read', ['read'], {
        tagsToRemove: ['unread', 'to-read'],
      });

      const template = db.getTemplate(id);
      expect(template!.tags_to_remove).not.toBeNull();
      expect(JSON.parse(template!.tags_to_remove!)).toEqual(['unread', 'to-read']);
    });

    it('should create template with shortcut', () => {
      const id = db.createTemplate('Quick Archive', ['archived'], {
        shortcut: 'ctrl+shift+a',
      });

      const template = db.getTemplate(id);
      expect(template!.shortcut).toBe('ctrl+shift+a');
    });

    it('should create template with conditions', () => {
      const conditions: TagExpression = {
        type: 'extension',
        ext: '.pdf',
      };

      const id = db.createTemplate('PDF Template', ['document'], {
        conditions,
      });

      const template = db.getTemplate(id);
      expect(template!.conditions).not.toBeNull();
      expect(JSON.parse(template!.conditions!)).toEqual(conditions);
    });

    it('should create template with complex conditions', () => {
      const conditions: TagExpression = {
        type: 'and',
        exprs: [
          { type: 'extension', ext: '.pdf' },
          { type: 'missing-tag', tag: 'processed' },
          {
            type: 'or',
            exprs: [
              { type: 'in-folder', pattern: 'Papers/*' },
              { type: 'in-folder', pattern: 'Research/*' },
            ],
          },
        ],
      };

      const id = db.createTemplate('Research PDF', ['research', 'pdf'], {
        conditions,
      });

      const template = db.getTemplate(id);
      const parsed = JSON.parse(template!.conditions!) as TagExpression;
      expect(parsed.type).toBe('and');
    });
  });

  describe('getTemplate / getTemplateByName', () => {
    it('should return null for non-existent template', () => {
      expect(db.getTemplate('non-existent-id')).toBeNull();
      expect(db.getTemplateByName('Non Existent')).toBeNull();
    });

    it('should find template by name', () => {
      const id = db.createTemplate('My Template', ['tag1', 'tag2']);

      const byId = db.getTemplate(id);
      const byName = db.getTemplateByName('My Template');

      expect(byId).toEqual(byName);
    });
  });

  describe('getAllTemplates', () => {
    it('should return empty array when no templates', () => {
      const templates = db.getAllTemplates();
      expect(templates).toEqual([]);
    });

    it('should return all templates sorted by name', () => {
      db.createTemplate('Zebra', ['z']);
      db.createTemplate('Alpha', ['a']);
      db.createTemplate('Mango', ['m']);

      const templates = db.getAllTemplates();

      expect(templates.length).toBe(3);
      expect(templates[0].name).toBe('Alpha');
      expect(templates[1].name).toBe('Mango');
      expect(templates[2].name).toBe('Zebra');
    });
  });

  describe('updateTemplate', () => {
    it('should return false for non-existent template', () => {
      const result = db.updateTemplate('non-existent', { name: 'New Name' });
      expect(result).toBe(false);
    });

    it('should update template name', () => {
      const id = db.createTemplate('Old Name', ['tag']);
      
      const result = db.updateTemplate(id, { name: 'New Name' });
      
      expect(result).toBe(true);
      expect(db.getTemplate(id)!.name).toBe('New Name');
    });

    it('should update template description', () => {
      const id = db.createTemplate('Template', ['tag']);
      
      db.updateTemplate(id, { description: 'New description' });
      expect(db.getTemplate(id)!.description).toBe('New description');

      db.updateTemplate(id, { description: null });
      expect(db.getTemplate(id)!.description).toBeNull();
    });

    it('should update tagsToAdd', () => {
      const id = db.createTemplate('Template', ['old-tag']);
      
      db.updateTemplate(id, { tagsToAdd: ['New-Tag', 'Another'] });
      
      const template = db.getTemplate(id);
      expect(JSON.parse(template!.tags_to_add)).toEqual(['new-tag', 'another']);
    });

    it('should update tagsToRemove', () => {
      const id = db.createTemplate('Template', ['tag']);
      
      db.updateTemplate(id, { tagsToRemove: ['remove-me'] });
      expect(JSON.parse(db.getTemplate(id)!.tags_to_remove!)).toEqual(['remove-me']);

      db.updateTemplate(id, { tagsToRemove: null });
      expect(db.getTemplate(id)!.tags_to_remove).toBeNull();
    });

    it('should update shortcut', () => {
      const id = db.createTemplate('Template', ['tag']);
      
      db.updateTemplate(id, { shortcut: 'ctrl+k' });
      expect(db.getTemplate(id)!.shortcut).toBe('ctrl+k');

      db.updateTemplate(id, { shortcut: null });
      expect(db.getTemplate(id)!.shortcut).toBeNull();
    });

    it('should update conditions', () => {
      const id = db.createTemplate('Template', ['tag']);
      
      const conditions: TagExpression = { type: 'extension', ext: '.md' };
      db.updateTemplate(id, { conditions });
      expect(JSON.parse(db.getTemplate(id)!.conditions!)).toEqual(conditions);

      db.updateTemplate(id, { conditions: null });
      expect(db.getTemplate(id)!.conditions).toBeNull();
    });

    it('should update multiple fields at once', () => {
      const id = db.createTemplate('Template', ['tag']);
      
      db.updateTemplate(id, {
        name: 'Updated Template',
        description: 'New desc',
        tagsToAdd: ['new', 'tags'],
        shortcut: 'ctrl+t',
      });

      const template = db.getTemplate(id);
      expect(template!.name).toBe('Updated Template');
      expect(template!.description).toBe('New desc');
      expect(JSON.parse(template!.tags_to_add)).toEqual(['new', 'tags']);
      expect(template!.shortcut).toBe('ctrl+t');
    });
  });

  describe('deleteTemplate', () => {
    it('should return false for non-existent template', () => {
      expect(db.deleteTemplate('non-existent')).toBe(false);
    });

    it('should delete template', () => {
      const id = db.createTemplate('To Delete', ['tag']);
      expect(db.getTemplate(id)).not.toBeNull();

      const result = db.deleteTemplate(id);
      
      expect(result).toBe(true);
      expect(db.getTemplate(id)).toBeNull();
    });
  });

  describe('parseTemplate', () => {
    it('should parse DbTagTemplate to TagTemplate', () => {
      const id = db.createTemplate('Test Template', ['ml', 'paper'], {
        description: 'A test template',
        tagsToRemove: ['draft'],
        shortcut: 'ctrl+t',
      });

      const dbTemplate = db.getTemplate(id)!;
      const parsed = db.parseTemplate(dbTemplate);

      expect(parsed.id).toBe(id);
      expect(parsed.name).toBe('Test Template');
      expect(parsed.description).toBe('A test template');
      expect(parsed.tagsToAdd).toEqual(['ml', 'paper']);
      expect(parsed.tagsToRemove).toEqual(['draft']);
      expect(parsed.shortcut).toBe('ctrl+t');
      expect(parsed.conditions).toBeNull();
      expect(typeof parsed.createdAt).toBe('number');
    });

    it('should parse template with conditions', () => {
      const conditions: TagExpression = {
        type: 'and',
        exprs: [
          { type: 'extension', ext: '.pdf' },
          { type: 'missing-tag', tag: 'read' },
        ],
      };

      const id = db.createTemplate('Conditional', ['auto-tag'], {
        conditions,
      });

      const parsed = db.parseTemplate(db.getTemplate(id)!);

      expect(parsed.conditions).toEqual(conditions);
    });

    it('should handle null tagsToRemove', () => {
      const id = db.createTemplate('Simple', ['tag']);
      const parsed = db.parseTemplate(db.getTemplate(id)!);

      expect(parsed.tagsToRemove).toEqual([]);
    });
  });

  describe('getAllTemplatesParsed', () => {
    it('should return all templates as parsed TagTemplate objects', () => {
      db.createTemplate('Template A', ['a'], { description: 'First' });
      db.createTemplate('Template B', ['b'], { tagsToRemove: ['x'] });
      db.createTemplate('Template C', ['c']);

      const templates = db.getAllTemplatesParsed();

      expect(templates.length).toBe(3);
      expect(templates.every((t) => Array.isArray(t.tagsToAdd))).toBe(true);
      expect(templates.every((t) => Array.isArray(t.tagsToRemove))).toBe(true);
    });
  });

  describe('Real-world template scenarios', () => {
    it('should support "New ML Paper" workflow', () => {
      const id = db.createTemplate('New ML Paper', ['ml', 'paper', 'unread', 'to-annotate'], {
        description: 'Apply to newly downloaded ML papers',
        conditions: {
          type: 'and',
          exprs: [
            { type: 'extension', ext: '.pdf' },
            { type: 'in-folder', pattern: 'Papers/ML/*' },
          ],
        },
      });

      const template = db.parseTemplate(db.getTemplate(id)!);

      expect(template.tagsToAdd).toContain('ml');
      expect(template.tagsToAdd).toContain('unread');
      expect(template.conditions?.type).toBe('and');
    });

    it('should support "Mark Read" workflow', () => {
      const id = db.createTemplate('Mark Read', ['read'], {
        tagsToRemove: ['unread', 'to-read'],
        description: 'Mark a document as read',
      });

      const template = db.parseTemplate(db.getTemplate(id)!);

      expect(template.tagsToAdd).toEqual(['read']);
      expect(template.tagsToRemove).toContain('unread');
      expect(template.tagsToRemove).toContain('to-read');
    });

    it('should support "Archive" workflow', () => {
      const id = db.createTemplate('Archive', ['archived'], {
        tagsToRemove: ['active', 'urgent', 'wip', 'in-progress'],
        shortcut: 'ctrl+shift+a',
      });

      const template = db.parseTemplate(db.getTemplate(id)!);

      expect(template.tagsToAdd).toEqual(['archived']);
      expect(template.tagsToRemove.length).toBe(4);
      expect(template.shortcut).toBe('ctrl+shift+a');
    });
  });
});

