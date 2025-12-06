/**
 * DocumentTitleManagerSqlite - SQLite-backed document title management
 *
 * Replaces the Memento-based DocumentTitleManager with SQLite storage.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { LatticeDatabase } from './database';

export class DocumentTitleManagerSqlite {
  private static instance: DocumentTitleManagerSqlite;
  private db: LatticeDatabase | null = null;
  private titleCache: Map<string, string | null> = new Map();
  private _onDidChangeTitle = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChangeTitle = this._onDidChangeTitle.event;
  private statusBarItem: vscode.StatusBarItem;

  private constructor() {
    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right
    );
    this.statusBarItem.command = 'lattice.editTitle';
    this.statusBarItem.tooltip = 'Click to edit document title';
  }

  /**
   * Initialize with database
   */
  public static async init(): Promise<void> {
    if (!DocumentTitleManagerSqlite.instance) {
      DocumentTitleManagerSqlite.instance = new DocumentTitleManagerSqlite();
    }
    await DocumentTitleManagerSqlite.instance.initializeDb();
  }

  public static getInstance(): DocumentTitleManagerSqlite {
    if (!DocumentTitleManagerSqlite.instance) {
      throw new Error('DocumentTitleManagerSqlite not initialized');
    }
    return DocumentTitleManagerSqlite.instance;
  }

  private async initializeDb(): Promise<void> {
    if (!this.db) {
      this.db = await LatticeDatabase.getInstance();
      this.loadCache();
    }
  }

  /**
   * Load all titles into cache
   */
  private loadCache(): void {
    if (!this.db) return;

    const titles = this.db.getAllDocumentTitles();
    for (const [uri, title] of Object.entries(titles)) {
      this.titleCache.set(uri, title);
    }
  }

  /**
   * Get the title for a document. Returns null if no title is found.
   */
  public getTitle(uri: vscode.Uri): string | null {
    return this.titleCache.get(uri.toString()) ?? null;
  }

  /**
   * Set the title for a document
   */
  public setTitle(uri: vscode.Uri, title: string | null): void {
    const uriString = uri.toString();

    if (!title) {
      this.titleCache.delete(uriString);
    } else {
      this.titleCache.set(uriString, title);
    }

    // Persist to database
    if (this.db) {
      try {
        this.db.setDocumentTitle(uriString, title);
      } catch (error) {
        console.error('Failed to save document title:', error);
      }
    }

    this._onDidChangeTitle.fire(uri);
    this.updateStatusBar(uri);
  }

  /**
   * Edit the title of a document via user input
   */
  public async editTitle(uri: vscode.Uri): Promise<void> {
    const currentTitle = this.getTitle(uri) ?? path.parse(uri.fsPath).name;
    const newTitle = await vscode.window.showInputBox({
      prompt: 'Enter a new title for the document',
      value: currentTitle,
      placeHolder: 'Document title',
      validateInput: (value) => {
        if (value.trim().length === 0) {
          return 'Title cannot be empty';
        }
        if (value.length > 100) {
          return 'Title is too long (maximum 100 characters)';
        }
        return null;
      },
    });

    if (newTitle !== undefined) {
      // Only update if user didn't cancel
      this.setTitle(uri, newTitle.trim() || null); // Convert empty string to null
    }
  }

  /**
   * Get a display name for a document. Falls back to filename if no title is found.
   */
  public getDisplayName(uri: vscode.Uri): string {
    const title = this.getTitle(uri);
    if (title) {
      return title;
    }
    return path.parse(uri.fsPath).name;
  }

  /**
   * Update the status bar with the current document's title
   */
  public updateStatusBar(uri: vscode.Uri): void {
    const title = this.getTitle(uri);
    if (title) {
      this.statusBarItem.text = `$(pencil) ${title}`;
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  /**
   * Clear all cached titles
   */
  public clear(): void {
    this.titleCache.clear();
    // Clear from database - this would require a bulk delete method
    // For now, we don't implement this as it's rarely used
  }

  /**
   * Remove a specific URI from the cache
   */
  public remove(uri: vscode.Uri): void {
    this.titleCache.delete(uri.toString());
    if (this.db) {
      this.db.setDocumentTitle(uri.toString(), null);
    }
  }

  /**
   * Dispose of the title manager and its resources
   */
  public dispose(): void {
    this.statusBarItem.dispose();
    this._onDidChangeTitle.dispose();
  }
}

