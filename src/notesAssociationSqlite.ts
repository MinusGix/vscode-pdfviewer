/**
 * NotesAssociationManagerSqlite - SQLite-backed PDF-to-notes association management
 *
 * Replaces the workspace settings-based NotesAssociationManager with SQLite storage.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { LatticeDatabase } from './database';

/**
 * Manages association between a PDF and a notes Markdown file.
 * Data is stored in the SQLite database.
 */
export class NotesAssociationManagerSqlite {
  private static instance: NotesAssociationManagerSqlite | undefined;
  private db: LatticeDatabase | null = null;

  private readonly statusBarItem: vscode.StatusBarItem;
  private _activePdfUri: vscode.Uri | undefined;
  private cache: Map<string, string> = new Map();

  private constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1000
    );
    // Default command opens beside. A separate command can open in the current group.
    this.statusBarItem.command = 'lattice.openAssociatedNotes';
    this.statusBarItem.tooltip = 'Open associated notes';
    this.statusBarItem.hide();
  }

  /**
   * Initialize with database
   */
  public static async init(): Promise<void> {
    if (!NotesAssociationManagerSqlite.instance) {
      NotesAssociationManagerSqlite.instance =
        new NotesAssociationManagerSqlite();
    }
    await NotesAssociationManagerSqlite.instance.initializeDb();
  }

  public static getInstance(): NotesAssociationManagerSqlite {
    if (!NotesAssociationManagerSqlite.instance) {
      NotesAssociationManagerSqlite.instance =
        new NotesAssociationManagerSqlite();
    }
    return NotesAssociationManagerSqlite.instance;
  }

  private async initializeDb(): Promise<void> {
    if (!this.db) {
      this.db = await LatticeDatabase.getInstance();
      this.loadCache();
    }
  }

  /**
   * Load all associations into cache
   */
  private loadCache(): void {
    if (!this.db) return;

    const associations = this.db.getAllNotesAssociations();
    for (const [pdfPath, notesPath] of Object.entries(associations)) {
      this.cache.set(pdfPath, notesPath);
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }

  /**
   * Update the active PDF URI and refresh the status bar button visibility/text.
   */
  public updateActivePdf(pdfUri: vscode.Uri | undefined): void {
    this._activePdfUri = pdfUri;
    this.updateStatusBar();
  }

  /**
   * Recompute the status bar item based on current active PDF and associations.
   */
  public updateStatusBar(): void {
    const alwaysShow = vscode.workspace
      .getConfiguration()
      .get<boolean>('lattice.associatedNotes.alwaysShowButton', true);
    const associated = this._activePdfUri
      ? this.getAssociatedNotesUri(this._activePdfUri)
      : undefined;
    if (!alwaysShow && (!this._activePdfUri || !associated)) {
      this.statusBarItem.hide();
      return;
    }

    const fileName = associated
      ? path.parse(associated.fsPath).base
      : 'Notes';
    // Show a concise label with an icon and the file's basename
    this.statusBarItem.text = `$(book) ${fileName}`;
    this.statusBarItem.tooltip = associated
      ? `Open associated notes: ${associated.fsPath}`
      : 'Open associated notes';
    this.statusBarItem.show();
  }

  /**
   * Prompt the user to pick an open Markdown document and associate it with the active PDF.
   */
  public async associateWithActivePdf(
    pdfOverride?: vscode.Uri
  ): Promise<void> {
    const pdfUri = pdfOverride ?? this._activePdfUri;
    if (!pdfUri) {
      vscode.window.showErrorMessage('No active PDF');
      return;
    }

    // Prefer open tabs (even if not visible) for Markdown
    const tabMdUris: vscode.Uri[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          if (uri.fsPath.toLowerCase().endsWith('.md')) {
            tabMdUris.push(uri);
          }
        }
      }
    }

    // Fallbacks: visible editors, then open text documents
    const visibleMdUris = vscode.window.visibleTextEditors
      .filter(
        (e) =>
          e.document.languageId === 'markdown' ||
          e.document.fileName.toLowerCase().endsWith('.md')
      )
      .map((e) => e.document.uri);

    const docMdUris = vscode.workspace.textDocuments
      .filter(
        (d) =>
          (d.languageId === 'markdown' ||
            d.fileName.toLowerCase().endsWith('.md')) &&
          !d.isClosed
      )
      .map((d) => d.uri);

    const allUris = Array.from(
      new Map([
        ...tabMdUris.map((u) => [u.toString(), u] as const),
        ...visibleMdUris.map((u) => [u.toString(), u] as const),
        ...docMdUris.map((u) => [u.toString(), u] as const),
      ]).values()
    ).filter((u) => u.scheme !== 'untitled');

    if (allUris.length === 0) {
      vscode.window.showInformationMessage(
        'No open Markdown files to associate.'
      );
      return;
    }

    const items = allUris.map((uri) => ({
      label: path.parse(uri.fsPath).base,
      description: vscode.workspace.asRelativePath(uri, false),
      uri,
    }));

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an open Markdown file to associate with this PDF',
      matchOnDescription: true,
    });

    if (!pick) {
      return;
    }

    await this.setAssociation(pdfUri, pick.uri);
    vscode.window.showInformationMessage(
      `Associated notes '${pick.label}' with '${path.parse(pdfUri.fsPath).base}'.`
    );
    this.updateStatusBar();
  }

  /**
   * Open the associated notes for the active PDF.
   * @param target 'beside' to open in a split, 'current' to open in the current group.
   */
  public async openAssociated(
    target: 'beside' | 'current' = 'beside'
  ): Promise<void> {
    if (!this._activePdfUri) {
      vscode.window.showErrorMessage('No active PDF');
      return;
    }

    const notesUri = this.getAssociatedNotesUri(this._activePdfUri);
    if (!notesUri) {
      vscode.window.showInformationMessage(
        'No associated notes for this PDF.'
      );
      return;
    }

    try {
      const viewColumn =
        target === 'beside'
          ? vscode.ViewColumn.Beside
          : vscode.ViewColumn.Active;
      await vscode.window.showTextDocument(notesUri, {
        viewColumn,
        preview: false,
        preserveFocus: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      vscode.window.showErrorMessage(
        `Failed to open associated notes: ${message}`
      );
    }
  }

  /**
   * Retrieve the associated notes file for a PDF URI, if any.
   */
  public getAssociatedNotesUri(pdfUri: vscode.Uri): vscode.Uri | undefined {
    const key = pdfUri.fsPath;
    const notesPath = this.cache.get(key);
    if (!notesPath) {
      return undefined;
    }

    return vscode.Uri.file(notesPath);
  }

  /**
   * Persist the association in the database.
   */
  private async setAssociation(
    pdfUri: vscode.Uri,
    notesUri: vscode.Uri
  ): Promise<void> {
    const key = pdfUri.fsPath;
    const notesPath = notesUri.fsPath;

    this.cache.set(key, notesPath);

    if (this.db) {
      try {
        this.db.setNotesAssociation(key, notesPath);
      } catch (error) {
        console.error('Failed to save notes association:', error);
      }
    }
  }
}

