/**
 * Integration tests for migration with real data
 * 
 * NOTE: These tests use copied real data from test-data/ directory
 * The actual user data is not committed to git.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { MigrationSource } from './types';

// Path to test data (real cards JSON copied for testing)
const TEST_DATA_DIR = path.join(__dirname, '../../test-data');
const CARDS_JSON_PATH = path.join(TEST_DATA_DIR, 'lattice.cards.json');

describe('Migration Integration Tests', () => {
  let SQL: SqlJsStatic;
  let db: Database;

  beforeAll(async () => {
    // Initialize sql.js
    SQL = await initSqlJs();
    db = new SQL.Database();
    
    // Create schema
    db.run(SCHEMA_SQL);
    db.run(
      "INSERT INTO schema_info (key, value) VALUES ('version', ?)",
      [SCHEMA_VERSION.toString()]
    );
  });

  describe('Cards Migration', () => {
    it('should read and parse the real cards JSON file', () => {
      // Skip if test data doesn't exist
      if (!fs.existsSync(CARDS_JSON_PATH)) {
        console.log('Skipping: test data not available');
        return;
      }

      const cardsJson = JSON.parse(fs.readFileSync(CARDS_JSON_PATH, 'utf-8'));
      
      expect(Array.isArray(cardsJson)).toBe(true);
      expect(cardsJson.length).toBeGreaterThan(0);
      
      // Check structure of first card
      const firstCard = cardsJson[0];
      expect(firstCard).toHaveProperty('cardId');
      expect(firstCard).toHaveProperty('fsrsCard');
    });

    it('should migrate all cards to SQLite', () => {
      if (!fs.existsSync(CARDS_JSON_PATH)) {
        console.log('Skipping: test data not available');
        return;
      }

      const cardsJson = JSON.parse(fs.readFileSync(CARDS_JSON_PATH, 'utf-8'));
      const now = Date.now();
      let migratedCount = 0;

      // Migrate cards
      for (const card of cardsJson) {
        if (!card.cardId) continue;

        db.run(
          `INSERT INTO cards (id, file_path, fsrs_state, last_review_date, deleted, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            card.cardId,
            null, // file_path not tracked in old format
            JSON.stringify(card.fsrsCard),
            card.lastReviewDate ?? null,
            card.deleted ? 1 : 0,
            now,
          ]
        );
        migratedCount++;
      }

      expect(migratedCount).toBe(cardsJson.length);

      // Verify cards in database
      const result = db.exec('SELECT COUNT(*) as count FROM cards');
      expect(result[0].values[0][0]).toBe(cardsJson.length);
    });

    it('should preserve FSRS state correctly', () => {
      if (!fs.existsSync(CARDS_JSON_PATH)) {
        console.log('Skipping: test data not available');
        return;
      }

      const cardsJson = JSON.parse(fs.readFileSync(CARDS_JSON_PATH, 'utf-8'));
      
      // Find a card with review history
      const reviewedCard = cardsJson.find(
        (c: { fsrsCard?: { reps?: number } }) => c.fsrsCard?.reps && c.fsrsCard.reps > 0
      );
      
      if (!reviewedCard) {
        console.log('No reviewed cards found to test');
        return;
      }

      // Query from database
      const result = db.exec(
        'SELECT fsrs_state FROM cards WHERE id = ?',
        [reviewedCard.cardId]
      );

      expect(result.length).toBe(1);
      
      const storedState = JSON.parse(result[0].values[0][0] as string);
      expect(storedState.reps).toBe(reviewedCard.fsrsCard.reps);
      expect(storedState.stability).toBe(reviewedCard.fsrsCard.stability);
      expect(storedState.difficulty).toBe(reviewedCard.fsrsCard.difficulty);
    });

    it('should handle cards with missing optional fields', () => {
      // Test that cards without lastReviewDate work
      const testCard = {
        cardId: 'test-missing-fields',
        fsrsCard: {
          due: new Date().toISOString(),
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          reps: 0,
          lapses: 0,
          state: 0,
        },
        // No lastReviewDate, no deleted
      };

      db.run(
        `INSERT INTO cards (id, file_path, fsrs_state, last_review_date, deleted, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          testCard.cardId,
          null,
          JSON.stringify(testCard.fsrsCard),
          null,
          0,
          Date.now(),
        ]
      );

      const result = db.exec(
        'SELECT * FROM cards WHERE id = ?',
        [testCard.cardId]
      );

      expect(result.length).toBe(1);
      expect(result[0].values[0][3]).toBeNull(); // last_review_date
      expect(result[0].values[0][4]).toBe(0); // deleted
    });
  });

  describe('Tags Migration (Mock)', () => {
    it('should migrate mock tag data correctly', () => {
      // Create mock tag data (since user hasn't used tags yet)
      const mockTagsJson: MigrationSource['tagsJson'] = {
        version: 1,
        files: {
          'file1': {
            id: 'file1',
            path: 'notes/test.md',
            filename: 'test.md',
            fileSize: 1024,
            lastModified: Date.now(),
            tags: ['ml', 'research'],
            status: 'ok',
          },
          'file2': {
            id: 'file2',
            path: 'papers/transformer.pdf',
            filename: 'transformer.pdf',
            fileSize: 2048,
            tags: ['ml', 'paper'],
            status: 'ok',
          },
        },
        tags: {
          'ml': { name: 'ml', displayName: 'Machine Learning', color: '#ff0000', fileCount: 2 },
          'research': { name: 'research', displayName: 'Research', fileCount: 1 },
          'paper': { name: 'paper', displayName: 'Paper', fileCount: 1 },
        },
        tagDisplayNames: {
          'ml': 'Machine Learning',
          'research': 'Research',
          'paper': 'Paper',
        },
      };

      const now = Date.now();

      // Migrate tags
      for (const [name, tag] of Object.entries(mockTagsJson.tags)) {
        db.run(
          `INSERT INTO tags (name, display_name, color, visibility, created_at)
           VALUES (?, ?, ?, 'normal', ?)`,
          [name, tag.displayName, tag.color ?? null, now]
        );
      }

      // Migrate files
      for (const file of Object.values(mockTagsJson.files)) {
        db.run(
          `INSERT INTO files (id, path, filename, file_size, last_modified, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [file.id, file.path, file.filename, file.fileSize ?? null, file.lastModified ?? null, file.status, now]
        );

        // Add tag instances
        for (const tagName of file.tags) {
          db.run(
            `INSERT INTO tag_instances (id, file_id, tag_name, created_at)
             VALUES (?, ?, ?, ?)`,
            [`${file.id}-${tagName}`, file.id, tagName, now]
          );
        }
      }

      // Verify migration
      const tagsResult = db.exec('SELECT COUNT(*) FROM tags');
      expect(tagsResult[0].values[0][0]).toBe(3);

      const filesResult = db.exec('SELECT COUNT(*) FROM files');
      expect(filesResult[0].values[0][0]).toBe(2);

      const instancesResult = db.exec('SELECT COUNT(*) FROM tag_instances');
      expect(instancesResult[0].values[0][0]).toBe(4); // 2 + 2 tags

      // Check file-tag relationships
      const mlFiles = db.exec(
        `SELECT f.path FROM files f
         JOIN tag_instances ti ON f.id = ti.file_id
         WHERE ti.tag_name = 'ml'`
      );
      expect(mlFiles[0].values.length).toBe(2);
    });
  });

  describe('Database Export', () => {
    it('should export all data to JSON', () => {
      const exportData: Record<string, unknown[]> = {};
      const tables = ['files', 'tags', 'tag_instances', 'cards'];

      for (const table of tables) {
        const result = db.exec(`SELECT * FROM ${table}`);
        if (result.length > 0) {
          const columns = result[0].columns;
          exportData[table] = result[0].values.map((row) => {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => {
              obj[col] = row[i];
            });
            return obj;
          });
        } else {
          exportData[table] = [];
        }
      }

      const jsonExport = JSON.stringify(exportData, null, 2);
      expect(jsonExport).toBeTruthy();
      
      // Parse it back
      const parsed = JSON.parse(jsonExport);
      expect(parsed.cards).toBeDefined();
      expect(parsed.tags).toBeDefined();
    });
  });

  describe('Query Performance', () => {
    it('should handle tag queries efficiently', () => {
      // Time a query for files with specific tag
      const start = Date.now();
      
      const result = db.exec(`
        SELECT f.* FROM files f
        JOIN tag_instances ti ON f.id = ti.file_id
        WHERE ti.tag_name = 'ml'
      `);
      
      const duration = Date.now() - start;
      
      // Should be very fast
      expect(duration).toBeLessThan(100);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle combined tag queries', () => {
      // Files with 'ml' AND NOT 'paper'
      const result = db.exec(`
        SELECT f.* FROM files f
        WHERE f.id IN (
          SELECT file_id FROM tag_instances WHERE tag_name = 'ml'
        )
        AND f.id NOT IN (
          SELECT file_id FROM tag_instances WHERE tag_name = 'paper'
        )
      `);

      // Should return file1 (has ml, research but not paper)
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

