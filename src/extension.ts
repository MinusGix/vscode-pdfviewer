import * as vscode from 'vscode';
import { PdfCustomProvider } from './pdfProvider';
import { WebPreviewProvider } from './webProvider';

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

  console.log('Lattice extension activated');
}

export function deactivate(): void { }
