/**
 * Tests for database types and schema
 * Note: Full integration tests require VS Code extension context
 */

import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION, SCHEMA_SQL, DROP_ALL_SQL } from './schema';
import {
  DbFile,
  DbTag,
  DbTagInstance,
  DbCard,
  TagExpression,
} from './types';

describe('Database Schema', () => {
  it('should have a valid schema version', () => {
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
    expect(typeof SCHEMA_VERSION).toBe('number');
  });

  it('should have schema SQL that creates tables', () => {
    expect(SCHEMA_SQL).toContain('CREATE TABLE');
    expect(SCHEMA_SQL).toContain('files');
    expect(SCHEMA_SQL).toContain('tags');
    expect(SCHEMA_SQL).toContain('tag_instances');
    expect(SCHEMA_SQL).toContain('cards');
    expect(SCHEMA_SQL).toContain('document_metadata');
    expect(SCHEMA_SQL).toContain('notes_associations');
  });

  it('should have schema SQL with indexes', () => {
    expect(SCHEMA_SQL).toContain('CREATE INDEX');
    expect(SCHEMA_SQL).toContain('idx_files_path');
    expect(SCHEMA_SQL).toContain('idx_tag_instances_file');
    expect(SCHEMA_SQL).toContain('idx_tag_instances_tag');
  });

  it('should have drop SQL for all tables', () => {
    expect(DROP_ALL_SQL).toContain('DROP TABLE');
    expect(DROP_ALL_SQL).toContain('files');
    expect(DROP_ALL_SQL).toContain('tags');
  });
});

describe('Database Types', () => {
  describe('DbFile', () => {
    it('should allow creating valid file records', () => {
      const file: DbFile = {
        id: 'abc123',
        path: 'notes/test.md',
        filename: 'test.md',
        file_size: 1024,
        last_modified: Date.now(),
        content_signature: 'sig123',
        last_seen: Date.now(),
        status: 'ok',
        created_at: Date.now(),
      };

      expect(file.id).toBe('abc123');
      expect(file.status).toBe('ok');
    });

    it('should allow nullable fields', () => {
      const file: DbFile = {
        id: 'xyz789',
        path: 'docs/readme.md',
        filename: 'readme.md',
        file_size: null,
        last_modified: null,
        content_signature: null,
        last_seen: null,
        status: 'missing',
        created_at: Date.now(),
      };

      expect(file.file_size).toBeNull();
      expect(file.status).toBe('missing');
    });
  });

  describe('DbTag', () => {
    it('should allow creating tag records', () => {
      const tag: DbTag = {
        name: 'machine-learning',
        display_name: 'Machine Learning',
        color: '#ff0000',
        parent_tag: null,
        visibility: 'normal',
        shadowed_by: null,
        created_at: Date.now(),
      };

      expect(tag.name).toBe('machine-learning');
      expect(tag.visibility).toBe('normal');
    });

    it('should support hierarchical tags', () => {
      const parentTag: DbTag = {
        name: 'programming',
        display_name: 'Programming',
        color: null,
        parent_tag: null,
        visibility: 'normal',
        shadowed_by: null,
        created_at: Date.now(),
      };

      const childTag: DbTag = {
        name: 'python',
        display_name: 'Python',
        color: null,
        parent_tag: 'programming',
        visibility: 'normal',
        shadowed_by: null,
        created_at: Date.now(),
      };

      expect(childTag.parent_tag).toBe(parentTag.name);
    });

    it('should support shadow tags', () => {
      const shadowTag: DbTag = {
        name: 'ml',
        display_name: 'ML',
        color: null,
        parent_tag: null,
        visibility: 'shadow',
        shadowed_by: 'machine-learning',
        created_at: Date.now(),
      };

      expect(shadowTag.visibility).toBe('shadow');
      expect(shadowTag.shadowed_by).toBe('machine-learning');
    });
  });

  describe('DbTagInstance', () => {
    it('should allow creating tag instances', () => {
      const instance: DbTagInstance = {
        id: 'inst1',
        file_id: 'file1',
        tag_name: 'important',
        parent_instance_id: null,
        metadata: null,
        created_at: Date.now(),
      };

      expect(instance.tag_name).toBe('important');
    });

    it('should allow structured tags with parent instances', () => {
      const characterInstance: DbTagInstance = {
        id: 'inst1',
        file_id: 'file1',
        tag_name: 'male',
        parent_instance_id: null,
        metadata: JSON.stringify({ name: 'Character A' }),
        created_at: Date.now(),
      };

      const hairInstance: DbTagInstance = {
        id: 'inst2',
        file_id: 'file1',
        tag_name: 'black_hair',
        parent_instance_id: 'inst1', // Links to character
        metadata: null,
        created_at: Date.now(),
      };

      expect(hairInstance.parent_instance_id).toBe(characterInstance.id);
    });

    it('should support metadata as JSON', () => {
      const instance: DbTagInstance = {
        id: 'inst1',
        file_id: 'file1',
        tag_name: 'person',
        parent_instance_id: null,
        metadata: JSON.stringify({
          bbox: [10, 20, 100, 200],
          confidence: 0.95,
        }),
        created_at: Date.now(),
      };

      const parsed = JSON.parse(instance.metadata!);
      expect(parsed.bbox).toEqual([10, 20, 100, 200]);
      expect(parsed.confidence).toBe(0.95);
    });
  });

  describe('DbCard', () => {
    it('should allow creating card records', () => {
      const card: DbCard = {
        id: 'card1',
        file_path: 'notes/flashcards.md',
        fsrs_state: JSON.stringify({ due: new Date().toISOString() }),
        last_review_date: null,
        deleted: 0,
        created_at: Date.now(),
      };

      expect(card.id).toBe('card1');
      expect(card.deleted).toBe(0);
    });
  });

  describe('TagExpression', () => {
    it('should support simple expressions', () => {
      const hasTag: TagExpression = { type: 'has-tag', tag: 'important' };
      expect(hasTag.type).toBe('has-tag');
      expect(hasTag.tag).toBe('important');

      const extension: TagExpression = { type: 'extension', ext: '.pdf' };
      expect(extension.ext).toBe('.pdf');
    });

    it('should support compound expressions', () => {
      const expr: TagExpression = {
        type: 'and',
        exprs: [
          { type: 'extension', ext: '.pdf' },
          { type: 'missing-tag', tag: 'read' },
          { type: 'has-tag', tag: 'paper' },
        ],
      };

      expect(expr.type).toBe('and');
      expect(expr.exprs).toHaveLength(3);
    });

    it('should support nested expressions', () => {
      const expr: TagExpression = {
        type: 'or',
        exprs: [
          {
            type: 'and',
            exprs: [
              { type: 'has-tag', tag: 'draft' },
              { type: 'modified-within', days: 7 },
            ],
          },
          { type: 'has-tag', tag: 'urgent' },
        ],
      };

      expect(expr.type).toBe('or');
    });

    it('should support negation', () => {
      const expr: TagExpression = {
        type: 'not',
        expr: { type: 'has-tag', tag: 'archived' },
      };

      expect(expr.type).toBe('not');
    });
  });
});

