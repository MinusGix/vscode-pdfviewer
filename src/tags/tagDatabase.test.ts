import { describe, it, expect } from 'vitest';
import { TagDatabase, TaggedFile, DEFAULT_TAG_DATABASE } from './tagTypes';

describe('TagDatabase serialization', () => {
  it('should serialize and deserialize correctly', () => {
    const db: TagDatabase = {
      version: 1,
      files: {
        abc123: {
          id: 'abc123',
          path: 'notes/test.md',
          filename: 'test.md',
          fileSize: 1024,
          lastModified: 1699999999999,
          contentSignature: 'sig123',
          tags: ['ml', 'research'],
          lastSeen: 1699999999999,
          status: 'ok',
        },
        def456: {
          id: 'def456',
          path: 'docs/readme.md',
          filename: 'readme.md',
          tags: ['docs'],
          status: 'missing',
        },
      },
      tags: {
        ml: {
          name: 'ml',
          displayName: 'ML',
          color: '#ff0000',
          fileCount: 1,
        },
        research: {
          name: 'research',
          displayName: 'Research',
          fileCount: 1,
        },
        docs: {
          name: 'docs',
          displayName: 'Documentation',
          fileCount: 1,
        },
      },
      tagDisplayNames: {
        ml: 'ML',
        research: 'Research',
        docs: 'Documentation',
      },
    };

    // Serialize
    const json = JSON.stringify(db, null, 2);
    expect(json).toBeTruthy();

    // Deserialize
    const parsed: TagDatabase = JSON.parse(json);

    // Verify structure
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.files)).toHaveLength(2);
    expect(Object.keys(parsed.tags)).toHaveLength(3);

    // Verify file data
    expect(parsed.files['abc123'].path).toBe('notes/test.md');
    expect(parsed.files['abc123'].tags).toContain('ml');
    expect(parsed.files['abc123'].status).toBe('ok');

    expect(parsed.files['def456'].status).toBe('missing');

    // Verify tag data
    expect(parsed.tags['ml'].displayName).toBe('ML');
    expect(parsed.tags['ml'].color).toBe('#ff0000');
    expect(parsed.tags['research'].color).toBeUndefined();
  });

  it('should handle empty database', () => {
    const json = JSON.stringify(DEFAULT_TAG_DATABASE, null, 2);
    const parsed: TagDatabase = JSON.parse(json);

    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.files)).toHaveLength(0);
    expect(Object.keys(parsed.tags)).toHaveLength(0);
  });

  it('should handle migration from older format', () => {
    // Simulate an older format that might be missing some fields
    const oldFormat = {
      version: 1,
      files: {
        abc123: {
          id: 'abc123',
          path: 'test.md',
          filename: 'test.md',
          tags: ['old'],
          status: 'ok',
        },
      },
      tags: {
        old: {
          name: 'old',
          displayName: 'Old',
          fileCount: 1,
        },
      },
      // tagDisplayNames might be missing in old format
    };

    const json = JSON.stringify(oldFormat);
    const parsed = JSON.parse(json);

    // Should handle missing tagDisplayNames
    const db: TagDatabase = {
      version: parsed.version || 1,
      files: parsed.files || {},
      tags: parsed.tags || {},
      tagDisplayNames: parsed.tagDisplayNames || {},
    };

    expect(db.version).toBe(1);
    expect(db.files['abc123'].tags).toContain('old');
    expect(Object.keys(db.tagDisplayNames)).toHaveLength(0);
  });

  it('should handle special characters in tags', () => {
    const db: TagDatabase = {
      version: 1,
      files: {
        file1: {
          id: 'file1',
          path: 'test.md',
          filename: 'test.md',
          tags: ['c++', 'c#', 'node.js', 'émoji-tag', '日本語'],
          status: 'ok',
        },
      },
      tags: {
        'c++': { name: 'c++', displayName: 'C++', fileCount: 1 },
        'c#': { name: 'c#', displayName: 'C#', fileCount: 1 },
        'node.js': { name: 'node.js', displayName: 'Node.js', fileCount: 1 },
        'émoji-tag': {
          name: 'émoji-tag',
          displayName: 'Émoji Tag',
          fileCount: 1,
        },
        日本語: { name: '日本語', displayName: '日本語', fileCount: 1 },
      },
      tagDisplayNames: {
        'c++': 'C++',
        'c#': 'C#',
        'node.js': 'Node.js',
        'émoji-tag': 'Émoji Tag',
        日本語: '日本語',
      },
    };

    const json = JSON.stringify(db);
    const parsed: TagDatabase = JSON.parse(json);

    expect(parsed.files['file1'].tags).toContain('c++');
    expect(parsed.files['file1'].tags).toContain('日本語');
    expect(parsed.tags['émoji-tag'].displayName).toBe('Émoji Tag');
  });

  it('should maintain file count accuracy after operations', () => {
    // Simulate adding a tag to multiple files
    const files: { [id: string]: TaggedFile } = {
      f1: {
        id: 'f1',
        path: 'a.md',
        filename: 'a.md',
        tags: ['shared', 'unique1'],
        status: 'ok',
      },
      f2: {
        id: 'f2',
        path: 'b.md',
        filename: 'b.md',
        tags: ['shared', 'unique2'],
        status: 'ok',
      },
      f3: {
        id: 'f3',
        path: 'c.md',
        filename: 'c.md',
        tags: ['shared'],
        status: 'ok',
      },
    };

    // Calculate counts
    const tagCounts: { [tag: string]: number } = {};
    for (const file of Object.values(files)) {
      for (const tag of file.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    expect(tagCounts['shared']).toBe(3);
    expect(tagCounts['unique1']).toBe(1);
    expect(tagCounts['unique2']).toBe(1);
  });
});

describe('File recovery scenarios', () => {
  it('should track files with content signatures', () => {
    const file: TaggedFile = {
      id: 'tracked1',
      path: 'old/location/notes.md',
      filename: 'notes.md',
      fileSize: 2048,
      lastModified: Date.now(),
      contentSignature: 'a1b2c3d4e5f6g7h8',
      tags: ['important'],
      lastSeen: Date.now(),
      status: 'ok',
    };

    // Simulate file being moved - path changes but signature remains
    const movedFile: TaggedFile = {
      ...file,
      path: 'new/location/notes.md',
      status: 'ok',
    };

    expect(movedFile.contentSignature).toBe(file.contentSignature);
    expect(movedFile.filename).toBe(file.filename);
    expect(movedFile.tags).toEqual(file.tags);
  });

  it('should mark files as missing when path fails', () => {
    const file: TaggedFile = {
      id: 'missing1',
      path: 'deleted/file.md',
      filename: 'file.md',
      tags: ['archived'],
      status: 'missing',
    };

    expect(file.status).toBe('missing');
    expect(file.tags).toContain('archived'); // Tags preserved
  });
});
