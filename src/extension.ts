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

  const extensionRoot = vscode.Uri.file(context.extensionPath);

  // Initialize document title manager
  DocumentTitleManager.init(context.workspaceState);
  context.subscriptions.push(DocumentTitleManager.getInstance());

  // Initialize card manager
  const cardManager = CardManager.getInstance();
  await cardManager.initialize();
  context.subscriptions.push(cardManager);

  // Track active custom editor tab
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(e => {
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (activeTab?.input instanceof vscode.TabInputCustom) {
        if (activeTab.input.viewType === PdfCustomProvider.viewType ||
          activeTab.input.viewType === WebPreviewProvider.viewType) {
          activeCustomEditorTab = activeTab;
          DocumentTitleManager.getInstance().updateStatusBar(activeTab.input.uri);
          return;
        }
      }
      activeCustomEditorTab = undefined;
      // Hide status bar when no custom editor is active
      DocumentTitleManager.getInstance().updateStatusBar(vscode.Uri.file(''));
    })
  );

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
      if (!activeCustomEditorTab) {
        vscode.window.showErrorMessage('No active document to edit title');
        return;
      }

      const input = activeCustomEditorTab.input;
      if (input instanceof vscode.TabInputCustom) {
        await DocumentTitleManager.getInstance().editTitle(input.uri);
      }
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

  console.log('Lattice extension activated');
}

export function deactivate(): void { }
