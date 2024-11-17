import * as vscode from 'vscode';
import { PdfCustomProvider } from './pdfProvider';
import { WebPreviewProvider } from './webProvider';
import { TextEncoder } from 'util';
import { DocumentTitleManager } from './documentTitles';

let activeCustomEditorTab: vscode.Tab | undefined;

export async function openUrlInWebview(url: string) {
  try {
    const urlObj = new URL(url);
    const sanitizedHostname = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '-');
    const suggestedName = `${sanitizedHostname}-${Date.now()}.url`;

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(suggestedName),
      filters: {
        'URL Files': ['url']
      }
    });

    if (!saveUri) {
      return;
    }

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(saveUri, encoder.encode(url));
    await vscode.commands.executeCommand('vscode.openWith', saveUri, WebPreviewProvider.viewType);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open URL: ${error.message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  console.log('Activating Lattice extension');

  const extensionRoot = vscode.Uri.file(context.extensionPath);

  // Initialize document title manager
  DocumentTitleManager.init(context.workspaceState);
  context.subscriptions.push(DocumentTitleManager.getInstance());

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

  console.log('Lattice extension activated');
}

export function deactivate(): void { }
