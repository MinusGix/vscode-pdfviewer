/**
 * Tag System Initialization
 * 
 * Handles database initialization, migration, and tag manager setup.
 */

import * as vscode from 'vscode';
import { ITagManager, setTagManager, getTagManager } from './tagManagerInterface';
import { TagManager } from './tagManager';
import { TagManagerSqlite } from './tagManagerSqlite';
import { LatticeDatabase, performFullMigration, checkLegacyStorage } from '../database';

/**
 * Configuration for tag system initialization
 */
export interface TagInitConfig {
  /** Whether to prefer SQLite backend (default: true) */
  useSqlite?: boolean;
  /** Extension context for migration (needed for document titles) */
  extensionContext?: vscode.ExtensionContext;
  /** Whether to show migration notifications (default: true) */
  showMigrationNotifications?: boolean;
}

/**
 * Result of tag system initialization
 */
export interface TagInitResult {
  /** The initialized tag manager */
  tagManager: ITagManager;
  /** Whether SQLite backend is being used */
  usingSqlite: boolean;
  /** Whether migration was performed */
  migrationPerformed: boolean;
  /** Migration statistics (if migration was performed) */
  migrationStats?: {
    filesImported: number;
    tagsImported: number;
    cardsImported: number;
    titlesImported: number;
    associationsImported: number;
  };
  /** Error message if initialization had issues */
  error?: string;
}

/**
 * Initialize the tag system
 * 
 * This function:
 * 1. Tries to initialize SQLite database
 * 2. Runs migration from JSON if needed
 * 3. Falls back to JSON backend if SQLite fails
 * 4. Sets up the global tag manager
 */
export async function initializeTagSystem(
  config: TagInitConfig = {}
): Promise<TagInitResult> {
  const {
    useSqlite = true,
    extensionContext,
    showMigrationNotifications = true,
  } = config;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    // No workspace - use JSON backend
    const tagManager = TagManager.getInstance();
    await tagManager.initialize();
    setTagManager(tagManager);
    return {
      tagManager,
      usingSqlite: false,
      migrationPerformed: false,
      error: 'No workspace folder found, using JSON backend',
    };
  }

  if (!useSqlite) {
    // Explicitly requested JSON backend
    const tagManager = TagManager.getInstance();
    await tagManager.initialize();
    setTagManager(tagManager);
    return {
      tagManager,
      usingSqlite: false,
      migrationPerformed: false,
    };
  }

  // Try SQLite backend
  try {
    // Initialize database
    const db = await LatticeDatabase.getInstance(workspaceRoot);

    // Check for legacy data that needs migration
    const { hasTags, hasCards } = await checkLegacyStorage(workspaceRoot);
    let migrationPerformed = false;
    let migrationStats;

    if (hasTags || hasCards) {
      // Run migration
      const result = await performFullMigration(
        db,
        workspaceRoot,
        extensionContext?.workspaceState
      );
      migrationPerformed = result.migrated;
      migrationStats = result.stats;
    }

    // Initialize SQLite-backed tag manager
    const tagManager = TagManagerSqlite.getInstance();
    await tagManager.initialize();
    setTagManager(tagManager);

    return {
      tagManager,
      usingSqlite: true,
      migrationPerformed,
      migrationStats,
    };
  } catch (error) {
    // SQLite failed - show error and re-throw (no JSON fallback)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('SQLite initialization failed:', error);

    if (showMigrationNotifications) {
      vscode.window.showErrorMessage(
        `Lattice: SQLite database initialization failed. (${errorMessage})`
      );
    }

    throw error;
  }
}

/**
 * Get tag manager, initializing if necessary
 * 
 * This is a convenience function for components that need the tag manager
 * but may be called before explicit initialization.
 */
export async function getOrInitializeTagManager(
  config?: TagInitConfig
): Promise<ITagManager> {
  try {
    return getTagManager();
  } catch {
    const result = await initializeTagSystem(config);
    return result.tagManager;
  }
}

