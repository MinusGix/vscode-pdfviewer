/**
 * Database migrations - handles importing from legacy JSON storage
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { LatticeDatabase } from './latticeDatabase';
import { MigrationSource } from './types';

/**
 * Legacy storage file paths
 */
const LEGACY_TAGS_FILE = 'lattice.tags.json';
const LEGACY_CARDS_FILE = 'lattice.cards.json';

/**
 * Check if legacy storage files exist and need migration
 */
export async function checkLegacyStorage(
  workspaceRoot: string
): Promise<{ hasTags: boolean; hasCards: boolean }> {
  const vscodeDir = path.join(workspaceRoot, '.vscode');

  let hasTags = false;
  let hasCards = false;

  try {
    await vscode.workspace.fs.stat(
      vscode.Uri.file(path.join(vscodeDir, LEGACY_TAGS_FILE))
    );
    hasTags = true;
  } catch {
    // File doesn't exist
  }

  try {
    await vscode.workspace.fs.stat(
      vscode.Uri.file(path.join(vscodeDir, LEGACY_CARDS_FILE))
    );
    hasCards = true;
  } catch {
    // File doesn't exist
  }

  return { hasTags, hasCards };
}

/**
 * Read legacy JSON storage files
 */
export async function readLegacyStorage(
  workspaceRoot: string
): Promise<MigrationSource> {
  const vscodeDir = path.join(workspaceRoot, '.vscode');
  const result: MigrationSource = {};

  // Read tags JSON
  try {
    const tagsPath = path.join(vscodeDir, LEGACY_TAGS_FILE);
    const tagsData = await vscode.workspace.fs.readFile(
      vscode.Uri.file(tagsPath)
    );
    const tagsJson = JSON.parse(Buffer.from(tagsData).toString('utf8'));
    result.tagsJson = tagsJson;
  } catch (error) {
    console.log('No legacy tags file found or error reading:', error);
  }

  // Read cards JSON
  try {
    const cardsPath = path.join(vscodeDir, LEGACY_CARDS_FILE);
    const cardsData = await vscode.workspace.fs.readFile(
      vscode.Uri.file(cardsPath)
    );
    const cardsJson = JSON.parse(Buffer.from(cardsData).toString('utf8'));
    result.cardsJson = cardsJson;
  } catch (error) {
    console.log('No legacy cards file found or error reading:', error);
  }

  return result;
}

/**
 * Read document titles from VS Code Memento storage
 * Note: This requires access to the extension context
 */
export function readDocumentTitles(
  storage: vscode.Memento
): Record<string, string> {
  return storage.get<Record<string, string>>('documentTitles', {});
}

/**
 * Read notes associations from workspace settings
 */
export function readNotesAssociations(): Record<string, string> {
  return (
    vscode.workspace
      .getConfiguration()
      .get<Record<string, string>>('lattice.associatedNotes') ?? {}
  );
}

/**
 * Migrate legacy data to SQLite database
 */
export async function migrateToSqlite(
  db: LatticeDatabase,
  source: MigrationSource,
  options: {
    documentTitles?: Record<string, string>;
    notesAssociations?: Record<string, string>;
  } = {}
): Promise<{
  filesImported: number;
  tagsImported: number;
  cardsImported: number;
  titlesImported: number;
  associationsImported: number;
}> {
  const stats = {
    filesImported: 0,
    tagsImported: 0,
    cardsImported: 0,
    titlesImported: 0,
    associationsImported: 0,
  };

  // Create backup before migration
  await db.backup();

  db.transaction(() => {
    // Migrate tags
    if (source.tagsJson?.tags) {
      for (const [name, tag] of Object.entries(source.tagsJson.tags)) {
        db.upsertTag(
          name,
          tag.displayName,
          tag.color ?? null,
          null, // parentTag - not in legacy format
          'normal' // visibility
        );
        stats.tagsImported++;
      }
    }

    // Migrate files and their tag associations
    if (source.tagsJson?.files) {
      for (const file of Object.values(source.tagsJson.files)) {
        // Insert file
        db.upsertFile({
          id: file.id,
          path: file.path,
          filename: file.filename,
          file_size: file.fileSize ?? null,
          last_modified: file.lastModified ?? null,
          content_signature: file.contentSignature ?? null,
          last_seen: file.lastSeen ?? null,
          status: file.status,
          created_at: Date.now(),
        });
        stats.filesImported++;

        // Add tag instances
        for (const tagName of file.tags) {
          db.addTagToFile(file.id, tagName);
        }
      }
    }

    // Migrate cards
    if (source.cardsJson) {
      for (const card of source.cardsJson) {
        if (!card.cardId) continue;
        db.upsertCard({
          id: card.cardId,
          file_path: null, // Not tracked in legacy format
          fsrs_state: JSON.stringify(card.fsrsCard),
          last_review_date: card.lastReviewDate ?? null,
          deleted: card.deleted ? 1 : 0,
          created_at: Date.now(),
        });
        stats.cardsImported++;
      }
    }

    // Migrate document titles
    if (options.documentTitles) {
      for (const [uri, title] of Object.entries(options.documentTitles)) {
        if (title) {
          db.setDocumentTitle(uri, title);
          stats.titlesImported++;
        }
      }
    }

    // Migrate notes associations
    if (options.notesAssociations) {
      for (const [pdfPath, notesPath] of Object.entries(
        options.notesAssociations
      )) {
        if (notesPath) {
          db.setNotesAssociation(pdfPath, notesPath);
          stats.associationsImported++;
        }
      }
    }
  });

  // Save the database
  await db.forceSave();

  return stats;
}

/**
 * Rename legacy files after successful migration
 */
export async function renameLegacyFiles(
  workspaceRoot: string
): Promise<void> {
  const vscodeDir = path.join(workspaceRoot, '.vscode');

  // Rename tags file
  try {
    const tagsPath = path.join(vscodeDir, LEGACY_TAGS_FILE);
    const tagsBackupPath = path.join(vscodeDir, `${LEGACY_TAGS_FILE}.migrated`);
    await vscode.workspace.fs.rename(
      vscode.Uri.file(tagsPath),
      vscode.Uri.file(tagsBackupPath)
    );
  } catch {
    // File might not exist
  }

  // Rename cards file
  try {
    const cardsPath = path.join(vscodeDir, LEGACY_CARDS_FILE);
    const cardsBackupPath = path.join(
      vscodeDir,
      `${LEGACY_CARDS_FILE}.migrated`
    );
    await vscode.workspace.fs.rename(
      vscode.Uri.file(cardsPath),
      vscode.Uri.file(cardsBackupPath)
    );
  } catch {
    // File might not exist
  }
}

/**
 * Full migration flow: check, read, migrate, rename
 */
export async function performFullMigration(
  db: LatticeDatabase,
  workspaceRoot: string,
  extensionStorage?: vscode.Memento
): Promise<{
  migrated: boolean;
  stats?: {
    filesImported: number;
    tagsImported: number;
    cardsImported: number;
    titlesImported: number;
    associationsImported: number;
  };
}> {
  // Check if migration is needed
  const { hasTags, hasCards } = await checkLegacyStorage(workspaceRoot);

  if (!hasTags && !hasCards) {
    return { migrated: false };
  }

  // Read legacy data
  const source = await readLegacyStorage(workspaceRoot);

  // Read additional data sources
  const documentTitles = extensionStorage
    ? readDocumentTitles(extensionStorage)
    : undefined;
  const notesAssociations = readNotesAssociations();

  // Show progress notification
  const stats = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Migrating Lattice data to SQLite...',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Reading legacy data...' });

      const migrationStats = await migrateToSqlite(db, source, {
        documentTitles,
        notesAssociations:
          Object.keys(notesAssociations).length > 0
            ? notesAssociations
            : undefined,
      });

      progress.report({ message: 'Cleaning up legacy files...' });
      await renameLegacyFiles(workspaceRoot);

      return migrationStats;
    }
  );

  // Show completion message
  vscode.window.showInformationMessage(
    `Lattice migration complete: ${stats.filesImported} files, ${stats.tagsImported} tags, ${stats.cardsImported} cards imported.`
  );

  return { migrated: true, stats };
}

