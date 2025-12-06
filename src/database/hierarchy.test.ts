/**
 * Tests for Tag Hierarchy operations
 *
 * Uses sql.js directly for database operations (no VS Code context needed)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { DbTag, TagHierarchyNode } from './types';
import { nanoid } from 'nanoid';

/**
 * Helper class that mirrors LatticeDatabase hierarchy methods for testing
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

  // Create a tag
  upsertTag(name: string, displayName: string, parentTag?: string | null): void {
    const now = Date.now();
    this.run(
      `INSERT INTO tags (name, display_name, parent_tag, visibility, created_at)
       VALUES (?, ?, ?, 'normal', ?)
       ON CONFLICT(name) DO UPDATE SET 
         display_name = excluded.display_name,
         parent_tag = COALESCE(excluded.parent_tag, tags.parent_tag)`,
      [name.toLowerCase(), displayName, parentTag?.toLowerCase() ?? null, now]
    );
  }

  getTag(name: string): DbTag | null {
    return this.queryOne<DbTag>('SELECT * FROM tags WHERE name = ?', [name.toLowerCase()]);
  }

  // Add a file with tags
  addFileWithTags(path: string, tags: string[]): string {
    const fileId = nanoid(12);
    const now = Date.now();
    this.run(
      `INSERT INTO files (id, path, filename, status, created_at) VALUES (?, ?, ?, 'ok', ?)`,
      [fileId, path, path.split('/').pop() || path, now]
    );
    for (const tag of tags) {
      this.run(
        `INSERT INTO tag_instances (id, file_id, tag_name, created_at) VALUES (?, ?, ?, ?)`,
        [nanoid(), fileId, tag.toLowerCase(), now]
      );
    }
    return fileId;
  }

  // Hierarchy operations
  setTagParent(childTag: string, parentTag: string | null): boolean {
    const normalizedChild = childTag.toLowerCase().trim();
    const normalizedParent = parentTag?.toLowerCase().trim() ?? null;

    if (!this.getTag(normalizedChild)) return false;
    if (normalizedParent && !this.getTag(normalizedParent)) return false;

    // Prevent circular references
    if (normalizedParent) {
      const ancestors = this.getTagAncestors(normalizedParent);
      if (ancestors.includes(normalizedChild)) return false;
    }

    this.run('UPDATE tags SET parent_tag = ? WHERE name = ?', [normalizedParent, normalizedChild]);
    return true;
  }

  getTagParent(tagName: string): string | null {
    const tag = this.getTag(tagName);
    return tag?.parent_tag ?? null;
  }

  getTagChildren(parentTag: string): DbTag[] {
    return this.query<DbTag>(
      'SELECT * FROM tags WHERE parent_tag = ? ORDER BY display_name',
      [parentTag.toLowerCase().trim()]
    );
  }

  getTagAncestors(tagName: string): string[] {
    const ancestors: string[] = [];
    let current = this.getTag(tagName);
    const visited = new Set<string>();

    while (current?.parent_tag && !visited.has(current.parent_tag)) {
      visited.add(current.parent_tag);
      ancestors.push(current.parent_tag);
      current = this.getTag(current.parent_tag);
    }

    return ancestors;
  }

  getTagDescendants(parentTag: string): string[] {
    const descendants: string[] = [];
    const queue = [parentTag.toLowerCase().trim()];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const children = this.getTagChildren(current);
      for (const child of children) {
        descendants.push(child.name);
        queue.push(child.name);
      }
    }

    return descendants;
  }

  getTagPath(tagName: string): string[] {
    const ancestors = this.getTagAncestors(tagName);
    return [...ancestors.reverse(), tagName.toLowerCase().trim()];
  }

  getTagDisplayPath(tagName: string): string {
    const path = this.getTagPath(tagName);
    const displayNames = path.map((t) => {
      const tag = this.getTag(t);
      return tag?.display_name ?? t;
    });
    return displayNames.join('::');
  }

  getRootTags(): DbTag[] {
    return this.query<DbTag>('SELECT * FROM tags WHERE parent_tag IS NULL ORDER BY display_name');
  }

  getFilesWithTagOrDescendants(tagName: string): Array<{ id: string; path: string }> {
    const normalized = tagName.toLowerCase().trim();
    const descendants = this.getTagDescendants(normalized);
    const allTags = [normalized, ...descendants];

    if (allTags.length === 0) return [];

    const placeholders = allTags.map(() => '?').join(', ');
    return this.query<{ id: string; path: string }>(
      `SELECT DISTINCT f.id, f.path
       FROM files f
       JOIN tag_instances ti ON f.id = ti.file_id
       WHERE ti.tag_name IN (${placeholders})
       ORDER BY f.path`,
      allTags
    );
  }

  private getTagFileCount(tagName: string): number {
    const result = this.queryOne<{ count: number }>(
      'SELECT COUNT(DISTINCT file_id) as count FROM tag_instances WHERE tag_name = ?',
      [tagName.toLowerCase().trim()]
    );
    return result?.count ?? 0;
  }

  private getTagTotalFileCount(tagName: string): number {
    const normalized = tagName.toLowerCase().trim();
    const descendants = this.getTagDescendants(normalized);
    const allTags = [normalized, ...descendants];

    if (allTags.length === 0) return 0;

    const placeholders = allTags.map(() => '?').join(', ');
    const result = this.queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT file_id) as count FROM tag_instances WHERE tag_name IN (${placeholders})`,
      allTags
    );
    return result?.count ?? 0;
  }

  getTagHierarchy(): TagHierarchyNode[] {
    const rootTags = this.getRootTags();
    return rootTags.map((tag) => this.buildHierarchyNode(tag));
  }

  private buildHierarchyNode(tag: DbTag): TagHierarchyNode {
    const children = this.getTagChildren(tag.name);
    return {
      tag,
      children: children.map((child) => this.buildHierarchyNode(child)),
      fileCount: this.getTagFileCount(tag.name),
      totalFileCount: this.getTagTotalFileCount(tag.name),
    };
  }
}

describe('Tag Hierarchy Operations', () => {
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

  describe('setTagParent', () => {
    it('should set parent for a tag', () => {
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python');

      const result = db.setTagParent('python', 'programming');

      expect(result).toBe(true);
      expect(db.getTagParent('python')).toBe('programming');
    });

    it('should allow removing parent (set to null)', () => {
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python', 'programming');

      expect(db.getTagParent('python')).toBe('programming');

      const result = db.setTagParent('python', null);

      expect(result).toBe(true);
      expect(db.getTagParent('python')).toBeNull();
    });

    it('should return false for non-existent child tag', () => {
      db.upsertTag('programming', 'Programming');

      const result = db.setTagParent('non-existent', 'programming');

      expect(result).toBe(false);
    });

    it('should return false for non-existent parent tag', () => {
      db.upsertTag('python', 'Python');

      const result = db.setTagParent('python', 'non-existent');

      expect(result).toBe(false);
    });

    it('should prevent circular references', () => {
      db.upsertTag('a', 'A');
      db.upsertTag('b', 'B');
      db.upsertTag('c', 'C');

      db.setTagParent('b', 'a'); // a -> b
      db.setTagParent('c', 'b'); // a -> b -> c

      // Try to make a's parent c (would create cycle)
      const result = db.setTagParent('a', 'c');

      expect(result).toBe(false);
      expect(db.getTagParent('a')).toBeNull();
    });
  });

  describe('getTagChildren', () => {
    it('should return direct children', () => {
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python', 'programming');
      db.upsertTag('javascript', 'JavaScript', 'programming');
      db.upsertTag('django', 'Django', 'python'); // Not direct child of programming

      const children = db.getTagChildren('programming');

      expect(children.length).toBe(2);
      expect(children.map((c) => c.name)).toContain('python');
      expect(children.map((c) => c.name)).toContain('javascript');
      expect(children.map((c) => c.name)).not.toContain('django');
    });

    it('should return empty array for tag with no children', () => {
      db.upsertTag('lonely', 'Lonely');

      const children = db.getTagChildren('lonely');

      expect(children).toEqual([]);
    });
  });

  describe('getTagAncestors', () => {
    it('should return ancestors from parent to root', () => {
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python', 'programming');
      db.upsertTag('django', 'Django', 'python');

      const ancestors = db.getTagAncestors('django');

      expect(ancestors).toEqual(['python', 'programming']);
    });

    it('should return empty array for root tag', () => {
      db.upsertTag('root', 'Root');

      const ancestors = db.getTagAncestors('root');

      expect(ancestors).toEqual([]);
    });
  });

  describe('getTagDescendants', () => {
    it('should return all descendants', () => {
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python', 'programming');
      db.upsertTag('javascript', 'JavaScript', 'programming');
      db.upsertTag('django', 'Django', 'python');
      db.upsertTag('flask', 'Flask', 'python');
      db.upsertTag('react', 'React', 'javascript');

      const descendants = db.getTagDescendants('programming');

      expect(descendants.length).toBe(5);
      expect(descendants).toContain('python');
      expect(descendants).toContain('javascript');
      expect(descendants).toContain('django');
      expect(descendants).toContain('flask');
      expect(descendants).toContain('react');
    });

    it('should return empty array for leaf tag', () => {
      db.upsertTag('leaf', 'Leaf');

      const descendants = db.getTagDescendants('leaf');

      expect(descendants).toEqual([]);
    });
  });

  describe('getTagPath', () => {
    it('should return full path from root to tag', () => {
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python', 'programming');
      db.upsertTag('django', 'Django', 'python');

      const path = db.getTagPath('django');

      expect(path).toEqual(['programming', 'python', 'django']);
    });

    it('should return single element for root tag', () => {
      db.upsertTag('root', 'Root');

      const path = db.getTagPath('root');

      expect(path).toEqual(['root']);
    });
  });

  describe('getTagDisplayPath', () => {
    it('should return formatted display path with separator', () => {
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python', 'programming');
      db.upsertTag('django', 'Django', 'python');

      const displayPath = db.getTagDisplayPath('django');

      expect(displayPath).toBe('Programming::Python::Django');
    });
  });

  describe('getRootTags', () => {
    it('should return only tags without parents', () => {
      db.upsertTag('programming', 'Programming');
      db.upsertTag('science', 'Science');
      db.upsertTag('python', 'Python', 'programming');
      db.upsertTag('physics', 'Physics', 'science');

      const roots = db.getRootTags();

      expect(roots.length).toBe(2);
      expect(roots.map((r) => r.name)).toContain('programming');
      expect(roots.map((r) => r.name)).toContain('science');
      expect(roots.map((r) => r.name)).not.toContain('python');
    });
  });

  describe('getFilesWithTagOrDescendants', () => {
    it('should return files with tag or any descendant', () => {
      // Create hierarchy
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python', 'programming');
      db.upsertTag('django', 'Django', 'python');

      // Create files with different tags
      db.addFileWithTags('file1.py', ['programming']);
      db.addFileWithTags('file2.py', ['python']);
      db.addFileWithTags('file3.py', ['django']);
      db.addFileWithTags('file4.txt', ['unrelated']);

      // Query for 'programming' should include all 3 programming files
      const files = db.getFilesWithTagOrDescendants('programming');

      expect(files.length).toBe(3);
      expect(files.map((f) => f.path)).toContain('file1.py');
      expect(files.map((f) => f.path)).toContain('file2.py');
      expect(files.map((f) => f.path)).toContain('file3.py');
      expect(files.map((f) => f.path)).not.toContain('file4.txt');
    });

    it('should return only direct files for leaf tag', () => {
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python', 'programming');

      db.addFileWithTags('file1.py', ['programming']);
      db.addFileWithTags('file2.py', ['python']);

      const files = db.getFilesWithTagOrDescendants('python');

      expect(files.length).toBe(1);
      expect(files[0].path).toBe('file2.py');
    });
  });

  describe('getTagHierarchy', () => {
    it('should return tree structure of tags', () => {
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python', 'programming');
      db.upsertTag('django', 'Django', 'python');
      db.upsertTag('science', 'Science');

      db.addFileWithTags('file1.py', ['programming']);
      db.addFileWithTags('file2.py', ['python']);
      db.addFileWithTags('file3.py', ['django']);

      const hierarchy = db.getTagHierarchy();

      expect(hierarchy.length).toBe(2); // programming and science

      const programming = hierarchy.find((h) => h.tag.name === 'programming');
      expect(programming).toBeDefined();
      expect(programming!.fileCount).toBe(1); // Only direct files
      expect(programming!.totalFileCount).toBe(3); // Including descendants
      expect(programming!.children.length).toBe(1); // python

      const python = programming!.children[0];
      expect(python.tag.name).toBe('python');
      expect(python.fileCount).toBe(1);
      expect(python.totalFileCount).toBe(2); // python + django
      expect(python.children.length).toBe(1); // django
    });
  });

  describe('real-world scenarios', () => {
    it('should handle programming language hierarchy', () => {
      // Create hierarchy: Programming > [Python > [Django, Flask], JavaScript > [React, Vue]]
      db.upsertTag('programming', 'Programming');
      db.upsertTag('python', 'Python', 'programming');
      db.upsertTag('javascript', 'JavaScript', 'programming');
      db.upsertTag('django', 'Django', 'python');
      db.upsertTag('flask', 'Flask', 'python');
      db.upsertTag('react', 'React', 'javascript');
      db.upsertTag('vue', 'Vue', 'javascript');

      // Add files
      db.addFileWithTags('django-tutorial.md', ['django']);
      db.addFileWithTags('react-hooks.md', ['react']);
      db.addFileWithTags('python-basics.md', ['python']);
      db.addFileWithTags('programming-concepts.md', ['programming']);

      // Query at different levels
      const programmingFiles = db.getFilesWithTagOrDescendants('programming');
      expect(programmingFiles.length).toBe(4);

      const pythonFiles = db.getFilesWithTagOrDescendants('python');
      expect(pythonFiles.length).toBe(2); // python-basics + django-tutorial

      const djangoFiles = db.getFilesWithTagOrDescendants('django');
      expect(djangoFiles.length).toBe(1);

      // Check display path
      expect(db.getTagDisplayPath('django')).toBe('Programming::Python::Django');
      expect(db.getTagDisplayPath('react')).toBe('Programming::JavaScript::React');
    });

    it('should handle academic subject hierarchy', () => {
      // Science > [Physics > [Quantum, Classical], Biology > [Genetics, Ecology]]
      db.upsertTag('science', 'Science');
      db.upsertTag('physics', 'Physics', 'science');
      db.upsertTag('biology', 'Biology', 'science');
      db.upsertTag('quantum', 'Quantum Mechanics', 'physics');
      db.upsertTag('classical', 'Classical Mechanics', 'physics');
      db.upsertTag('genetics', 'Genetics', 'biology');
      db.upsertTag('ecology', 'Ecology', 'biology');

      db.addFileWithTags('quantum-paper.pdf', ['quantum']);
      db.addFileWithTags('dna-research.pdf', ['genetics']);
      db.addFileWithTags('science-overview.md', ['science']);

      // Check hierarchy
      const hierarchy = db.getTagHierarchy();
      const science = hierarchy.find((h) => h.tag.name === 'science');
      
      expect(science).toBeDefined();
      expect(science!.children.length).toBe(2); // physics, biology
      expect(science!.totalFileCount).toBe(3);
    });
  });
});

