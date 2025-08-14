import * as vscode from 'vscode';
import { PdfCustomProvider } from './pdfProvider';
import { WebPreviewProvider } from './webProvider';
import { TextEncoder } from 'util';
import { DocumentTitleManager } from './documentTitles';
import { CardManager } from './SRS/cardManager';
import { MdParser } from './SRS/mdParser';
import { CardReviewView } from './SRS/cardReviewView';
import { CardListView } from './SRS/cardListView';
import { toggleBlockquote } from './utils/blockquote';
import { LiveMdEditorProvider } from './markdown/liveMdEditorProvider';
import { NotesAssociationManager } from './notesAssociation';

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

  // Initialize document title manager
  DocumentTitleManager.init(context.workspaceState);
  context.subscriptions.push(DocumentTitleManager.getInstance());

  // Initialize card manager
  const cardManager = CardManager.getInstance();
  await cardManager.initialize();
  context.subscriptions.push(cardManager);

  // Track active custom editor tab more robustly: listen to both tab changes and active editor changes
  const updateActiveUiFromWindow = () => {
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    const pdfUri = getActivePdfUriNow();

    if (activeTab?.input instanceof vscode.TabInputCustom) {
      if (activeTab.input.viewType === PdfCustomProvider.viewType ||
        activeTab.input.viewType === WebPreviewProvider.viewType) {
        activeCustomEditorTab = activeTab;
        DocumentTitleManager.getInstance().updateStatusBar(activeTab.input.uri);
        vscode.commands.executeCommand('setContext', 'lattice.isPdfPreviewActive', activeTab.input.viewType === PdfCustomProvider.viewType);
        vscode.commands.executeCommand('setContext', 'lattice.isWebPreviewActive', activeTab.input.viewType === WebPreviewProvider.viewType);
      }
    } else {
      activeCustomEditorTab = undefined;
      vscode.commands.executeCommand('setContext', 'lattice.isPdfPreviewActive', false);
      vscode.commands.executeCommand('setContext', 'lattice.isWebPreviewActive', false);
      DocumentTitleManager.getInstance().updateStatusBar(vscode.Uri.file(''));
    }

    // Update notes association button for any active PDF (custom or text editor)
    NotesAssociationManager.getInstance().updateActivePdf(pdfUri);
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

  // Initialize notes association manager and ensure it is disposed
  const notesAssoc = NotesAssociationManager.getInstance();
  context.subscriptions.push({ dispose: () => notesAssoc.dispose() });

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
      notesAssoc.updateActivePdf(activePdfUri);
      await NotesAssociationManager.getInstance().associateWithActivePdf(activePdfUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.openAssociatedNotes', async () => {
      const activePdfUri = getActivePdfUriNow() ?? pdfProvider.activePreview?.resource;
      if (!activePdfUri) {
        vscode.window.showErrorMessage('No active PDF');
        return;
      }
      NotesAssociationManager.getInstance().updateActivePdf(activePdfUri);
      await NotesAssociationManager.getInstance().openAssociated('beside');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.openAssociatedNotesHere', async () => {
      const activePdfUri = getActivePdfUriNow() ?? pdfProvider.activePreview?.resource;
      if (!activePdfUri) {
        vscode.window.showErrorMessage('No active PDF');
        return;
      }
      NotesAssociationManager.getInstance().updateActivePdf(activePdfUri);
      await NotesAssociationManager.getInstance().openAssociated('current');
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
      await DocumentTitleManager.getInstance().editTitle(targetUri);
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
