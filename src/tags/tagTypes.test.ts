import { describe, it, expect } from 'vitest';
import { DEFAULT_TAG_DATABASE, TaggedFile, Tag } from './tagTypes';

describe('tagTypes', () => {
  describe('DEFAULT_TAG_DATABASE', () => {
    it('should have correct structure', () => {
      expect(DEFAULT_TAG_DATABASE).toHaveProperty('version');
      expect(DEFAULT_TAG_DATABASE).toHaveProperty('files');
      expect(DEFAULT_TAG_DATABASE).toHaveProperty('tags');
      expect(DEFAULT_TAG_DATABASE).toHaveProperty('tagDisplayNames');
    });

    it('should have version 1', () => {
      expect(DEFAULT_TAG_DATABASE.version).toBe(1);
    });

    it('should have empty files and tags', () => {
      expect(Object.keys(DEFAULT_TAG_DATABASE.files)).toHaveLength(0);
      expect(Object.keys(DEFAULT_TAG_DATABASE.tags)).toHaveLength(0);
      expect(Object.keys(DEFAULT_TAG_DATABASE.tagDisplayNames)).toHaveLength(0);
    });
  });

  describe('type structures', () => {
    it('should allow creating valid TaggedFile', () => {
      const file: TaggedFile = {
        id: 'abc123',
        path: 'notes/test.md',
        filename: 'test.md',
        tags: ['ml', 'physics'],
        status: 'ok',
      };

      expect(file.id).toBe('abc123');
      expect(file.tags).toContain('ml');
      expect(file.status).toBe('ok');
    });

    it('should allow creating valid Tag', () => {
      const tag: Tag = {
        name: 'machine-learning',
        displayName: 'Machine Learning',
        color: '#ff0000',
        fileCount: 5,
      };

      expect(tag.name).toBe('machine-learning');
      expect(tag.displayName).toBe('Machine Learning');
      expect(tag.fileCount).toBe(5);
    });

    it('should allow TaggedFile with optional fields', () => {
      const file: TaggedFile = {
        id: 'xyz789',
        path: 'docs/readme.md',
        filename: 'readme.md',
        fileSize: 1024,
        lastModified: Date.now(),
        contentSignature: 'abc123def456',
        tags: [],
        lastSeen: Date.now(),
        status: 'missing',
      };

      expect(file.fileSize).toBe(1024);
      expect(file.contentSignature).toBe('abc123def456');
    });
  });
});
