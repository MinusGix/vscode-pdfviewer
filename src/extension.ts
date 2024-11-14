import * as vscode from 'vscode';
import { PdfCustomProvider } from './pdfProvider';

export function activate(context: vscode.ExtensionContext): void {
  const extensionRoot = vscode.Uri.file(context.extensionPath);
  // Register our custom editor provider
  const provider = new PdfCustomProvider(extensionRoot);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      PdfCustomProvider.viewType,
      provider,
      {
        webviewOptions: {
          enableFindWidget: false, // default
          retainContextWhenHidden: true,
        },
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lattice.preview.noteTransfer", () => {
      provider.transferNoteToEditorSplit();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lattice.preview.insertCitation", () => {
      provider.insertCitation();
    })
  );

  // context.subscriptions.push(
  //   vscode.commands.registerCommand("lattice.preview.highlight", () => {
  //     provider.highlight();
  //   })
  // );
}

export function deactivate(): void { }
