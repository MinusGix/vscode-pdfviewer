import * as vscode from "vscode";
import { MarkdownRenderer } from "./markdownRenderer";

export class BasicWysiwygProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "lattice.basicWysiwyg";
  private readonly markdownRenderer = new MarkdownRenderer();

  constructor(private readonly context: vscode.ExtensionContext) { }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    // Set initial HTML
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // Send initial document content
    await this.updateWebview(document, webviewPanel);

    // Listen for document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      async (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          await this.updateWebview(document, webviewPanel);
        }
      }
    );

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "type":
          await this.handleType(document, message.text, message.position);
          break;
        case "click":
          // For now, just acknowledge the click
          console.log(`Click at position: ${message.position}`);
          break;
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });
  }

  private async handleType(
    document: vscode.TextDocument,
    text: string,
    position: { line: number; character: number }
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const vscodePosition = new vscode.Position(position.line, position.character);
    edit.insert(document.uri, vscodePosition, text);
    await vscode.workspace.applyEdit(edit);
  }

  private async updateWebview(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const markdownText = document.getText();
    const renderResult = await this.markdownRenderer.render(markdownText);

    webviewPanel.webview.postMessage({
      type: "update",
      text: markdownText,
      html: renderResult.html,
      characterMap: renderResult.characterMap,
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const webviewUri = (p: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, p));

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Basic WYSIWYG</title>
        <link rel="stylesheet" href="${webviewUri("lib/markdown/basic-wysiwyg.css")}">
      </head>
      <body>
        <div id="content" tabindex="0"></div>
        <div id="cursor" class="cursor"></div>
        
        <script src="${webviewUri("lib/markdown/basic-wysiwyg.js")}"></script>
      </body>
      </html>
    `;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
