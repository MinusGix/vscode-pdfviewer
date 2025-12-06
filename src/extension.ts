import * as vscode from 'vscode';
import { PdfCustomProvider } from './pdfProvider';
import { WebPreviewProvider } from './webProvider';
import { TextEncoder } from 'util';
import { DocumentTitleManager } from './documentTitles';
import { DocumentTitleManagerSqlite } from './documentTitlesSqlite';
import { CardManager } from './SRS/cardManager';
import { CardManagerSqlite } from './SRS/cardManagerSqlite';
import { MdParser } from './SRS/mdParser';
import { CardReviewView } from './SRS/cardReviewView';
import { CardListView } from './SRS/cardListView';
import { toggleBlockquote } from './utils/blockquote';
// LiveMdEditorProvider intentionally disabled/unregistered; keep import removed.
import { BasicWysiwygProvider } from './markdown/basicWysiwygProvider';
import { NotesAssociationManager } from './notesAssociation';
import { NotesAssociationManagerSqlite } from './notesAssociationSqlite';
import {
  initializeTagSystem,
  TagExplorerProvider,
  registerTagCommands,
} from './tags';
import { LatticeDatabase } from './database';

let activeCustomEditorTab: vscode.Tab | undefined;

export async function openUrlInWebview(url: string, mode: 'frame' | 'frameless' = 'frameless') {
  try {
    const urlObj = new URL(url);
    console.log(`Opening URL in webview (${mode}): ${url}`);

    // Create unique filename with hostname and timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const untitledUri = vscode.Uri.parse(`untitled:${urlObj.hostname}-${timestamp}.url`);

    // Write the URL to the untitled document
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(untitledUri, { ignoreIfExists: true });
    edit.insert(untitledUri, new vscode.Position(0, 0), url);
    if (mode === 'frame') {
      edit.insert(untitledUri, new vscode.Position(1, 0), '\nframe');
    }
    await vscode.workspace.applyEdit(edit);

    // Open the untitled document in the web preview
    await vscode.commands.executeCommand('vscode.openWith', untitledUri, WebPreviewProvider.viewType);
  } catch (error: any) {
    console.error('Failed to open URL:', error);
    vscode.window.showErrorMessage(`Failed to open URL: ${error.message}`);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Activating Lattice extension');

  const extensionRoot = context.extensionUri;

  // Initialize tag system (SQLite with fallback to JSON)
  // This also initializes the database if SQLite is available
  const tagInitResult = await initializeTagSystem({
    extensionContext: context,
    showMigrationNotifications: true,
  });
  console.log(
    `Lattice: Tag system initialized (SQLite: ${tagInitResult.usingSqlite}, Migration: ${tagInitResult.migrationPerformed})`
  );
  context.subscriptions.push(tagInitResult.tagManager);

  // Initialize managers based on whether SQLite is available
  let documentTitleManager: DocumentTitleManager | DocumentTitleManagerSqlite;
  let cardManager: CardManager | CardManagerSqlite;
  let notesAssocManager: NotesAssociationManager | NotesAssociationManagerSqlite;

  if (tagInitResult.usingSqlite && LatticeDatabase.isInitialized()) {
    // Use SQLite-backed managers
    console.log('Lattice: Using SQLite-backed managers');

    await DocumentTitleManagerSqlite.init();
    documentTitleManager = DocumentTitleManagerSqlite.getInstance();
    context.subscriptions.push(documentTitleManager);

    cardManager = CardManagerSqlite.getInstance();
    await cardManager.initialize();
    context.subscriptions.push(cardManager);

    await NotesAssociationManagerSqlite.init();
    notesAssocManager = NotesAssociationManagerSqlite.getInstance();
    context.subscriptions.push({ dispose: () => notesAssocManager.dispose() });
  } else {
    // Fall back to original managers
    console.log('Lattice: Using JSON-backed managers');

    DocumentTitleManager.init(context.workspaceState);
    documentTitleManager = DocumentTitleManager.getInstance();
    context.subscriptions.push(documentTitleManager);

    cardManager = CardManager.getInstance();
    await cardManager.initialize();
    context.subscriptions.push(cardManager);

    notesAssocManager = NotesAssociationManager.getInstance();
    context.subscriptions.push({ dispose: () => notesAssocManager.dispose() });
  }

  // Register tag explorer tree view
  const tagExplorerProvider = new TagExplorerProvider(tagInitResult.tagManager);
  context.subscriptions.push(tagExplorerProvider);
  context.subscriptions.push(
    vscode.window.createTreeView('lattice.tagExplorer', {
      treeDataProvider: tagExplorerProvider,
      showCollapseAll: true,
    })
  );

  // Register tag commands
  registerTagCommands(context, tagInitResult.tagManager);

  // Track active custom editor tab more robustly: listen to both tab changes and active editor changes
  const updateActiveUiFromWindow = () => {
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    const pdfUri = getActivePdfUriNow();

    if (activeTab?.input instanceof vscode.TabInputCustom) {
      if (activeTab.input.viewType === PdfCustomProvider.viewType ||
        activeTab.input.viewType === WebPreviewProvider.viewType) {
        activeCustomEditorTab = activeTab;
        documentTitleManager.updateStatusBar(activeTab.input.uri);
        vscode.commands.executeCommand('setContext', 'lattice.isPdfPreviewActive', activeTab.input.viewType === PdfCustomProvider.viewType);
        vscode.commands.executeCommand('setContext', 'lattice.isWebPreviewActive', activeTab.input.viewType === WebPreviewProvider.viewType);
      }
    } else {
      activeCustomEditorTab = undefined;
      vscode.commands.executeCommand('setContext', 'lattice.isPdfPreviewActive', false);
      vscode.commands.executeCommand('setContext', 'lattice.isWebPreviewActive', false);
      documentTitleManager.updateStatusBar(vscode.Uri.file(''));
    }

    // Update notes association button for any active PDF (custom or text editor)
    notesAssocManager.updateActivePdf(pdfUri);
  };

  const getActivePdfUriNow = (): vscode.Uri | undefined => {
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    if (!activeTab) { return undefined; }
    const asPdf = (uri: vscode.Uri | undefined): vscode.Uri | undefined => {
      if (!uri) { return undefined; }
      return uri.fsPath.toLowerCase().endsWith('.pdf') ? uri : undefined;
    };
    if (activeTab.input instanceof vscode.TabInputCustom) {
      // Prefer our custom editor type, but accept any .pdf URI as fallback
      if (activeTab.input.viewType === PdfCustomProvider.viewType) {
        return activeTab.input.uri;
      }
      return asPdf(activeTab.input.uri);
    }
    if (activeTab.input instanceof vscode.TabInputText) {
      return asPdf(activeTab.input.uri);
    }
    return undefined;
  };

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => updateActiveUiFromWindow()),
    vscode.window.onDidChangeActiveTextEditor(() => updateActiveUiFromWindow()),
    vscode.window.onDidChangeVisibleTextEditors(() => updateActiveUiFromWindow()),
  );

  // Prime initial UI context/state
  updateActiveUiFromWindow();

  // Register Web preview provider
  const webProvider = new WebPreviewProvider(extensionRoot);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      WebPreviewProvider.viewType,
      webProvider,
      {
        webviewOptions: {
          enableFindWidget: true,
          retainContextWhenHidden: true,
        },
      }
    )
  );

  // Register PDF preview provider
  const pdfProvider = new PdfCustomProvider(extensionRoot);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      PdfCustomProvider.viewType,
      pdfProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );


  // Register basic WYSIWYG editor provider
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      BasicWysiwygProvider.viewType,
      new BasicWysiwygProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  // // Register live markdown editor provider
  // context.subscriptions.push(
  //   vscode.window.registerCustomEditorProvider(
  //     LiveMdEditorProvider.viewType,
  //     new LiveMdEditorProvider(context),
  //     {
  //       webviewOptions: {
  //         retainContextWhenHidden: true,
  //       },
  //     }
  //   )
  // );

  // Add command registrations
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.webPreview.insertQuotation', () => {
      webProvider.insertQuotation();
    })
  );

  // Register card template insertion commands
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.insertCardTemplateTesting', () => {
      cardManager.insertCardTemplateTesting(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.insertCardTemplateTestingNoId', () => {
      cardManager.insertCardTemplateTesting(false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.preview.insertQuotation', () => {
      pdfProvider.insertQuotation();
    })
  );

  // Add new citation commands
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.webPreview.insertCitation', () => {
      webProvider.insertCitation();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.preview.insertCitation', () => {
      pdfProvider.insertCitation();
    })
  );

  // Notes association commands
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.associateNotesWithPdf', async () => {
      const activePdfUri = getActivePdfUriNow() ?? pdfProvider.activePreview?.resource;
      if (!activePdfUri) {
        vscode.window.showErrorMessage('No active PDF');
        return;
      }
      notesAssocManager.updateActivePdf(activePdfUri);
      await notesAssocManager.associateWithActivePdf(activePdfUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.openAssociatedNotes', async () => {
      const activePdfUri = getActivePdfUriNow() ?? pdfProvider.activePreview?.resource;
      if (!activePdfUri) {
        vscode.window.showErrorMessage('No active PDF');
        return;
      }
      notesAssocManager.updateActivePdf(activePdfUri);
      await notesAssocManager.openAssociated('beside');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.openAssociatedNotesHere', async () => {
      const activePdfUri = getActivePdfUriNow() ?? pdfProvider.activePreview?.resource;
      if (!activePdfUri) {
        vscode.window.showErrorMessage('No active PDF');
        return;
      }
      notesAssocManager.updateActivePdf(activePdfUri);
      await notesAssocManager.openAssociated('current');
    })
  );

  // Add the new command registration
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.openUrl', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter URL to open',
        placeHolder: 'https://example.com',
        validateInput: (text) => {
          try {
            new URL(text);
            return null;
          } catch {
            return 'Please enter a valid URL';
          }
        }
      });

      if (url) {
        await openUrlInWebview(url);
      }
    })
  );

  // Register edit title command
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.editTitle', async () => {
      const targetUri = getActivePdfUriNow() ?? pdfProvider.activePreview?.resource ?? (
        vscode.window.tabGroups.activeTabGroup?.activeTab?.input instanceof vscode.TabInputCustom
          ? vscode.window.tabGroups.activeTabGroup?.activeTab?.input.uri
          : undefined
      );
      if (!targetUri) {
        vscode.window.showErrorMessage('No active document to edit title');
        return;
      }
      await documentTitleManager.editTitle(targetUri);
    })
  );

  // Add the new command registration
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.openUrlFrame', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter URL to open (in frame)',
        placeHolder: 'https://example.com',
        validateInput: (text) => {
          try {
            new URL(text);
            return null;
          } catch {
            return 'Please enter a valid URL';
          }
        }
      });

      if (url) {
        await openUrlInWebview(url, 'frame');
      }
    })
  );

  // Register toggle blockquote command
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.toggleBlockquote', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const selections = editor.selections;
      editor.edit(editBuilder => {
        for (const selection of selections) {
          const text = editor.document.getText(selection);
          const newText = toggleBlockquote(text);
          editBuilder.replace(selection, newText);
        }
      });
    })
  );

  // Register card review command
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.reviewCards', () => {
      CardReviewView.show(context.extensionUri, cardManager);
    })
  );

  // Register card list command
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.listCards', () => {
      CardListView.show(context.extensionUri, cardManager);
    })
  );

  // Register file disable/enable commands
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.disableFile', () => {
      cardManager.disableCurrentFile();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.enableFile', () => {
      cardManager.enableCurrentFile();
    })
  );

  console.log('Lattice extension activated');
}

export function deactivate(): void { }
