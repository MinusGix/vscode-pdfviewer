import * as vscode from 'vscode';
import { PdfCustomProvider } from './pdfProvider';
import { WebPreviewProvider } from './webProvider';

export async function openUrlInWebview(url: string) {
  // Create a temporary URI with a random name
  const tempUri = vscode.Uri.parse(`untitled:Untitled-${Date.now()}.url`);

  // Create and show the document
  const doc = await vscode.workspace.openTextDocument(tempUri);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(tempUri, new vscode.Position(0, 0), url);
  await vscode.workspace.applyEdit(edit);

  // Open it with our custom editor
  await vscode.commands.executeCommand('vscode.openWith', tempUri, WebPreviewProvider.viewType);
}

export function activate(context: vscode.ExtensionContext): void {
  console.log('Activating Lattice extension');

  const extensionRoot = vscode.Uri.file(context.extensionPath);

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

  console.log('Lattice extension activated');
}

export function deactivate(): void { }
