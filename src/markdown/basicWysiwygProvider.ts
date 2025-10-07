import * as vscode from "vscode";

export class BasicWysiwygProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = "lattice.basicWysiwyg";

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
        this.updateWebview(document, webviewPanel);

        // Listen for document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
            (e) => {
                if (e.document.uri.toString() === document.uri.toString()) {
                    this.updateWebview(document, webviewPanel);
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

    private updateWebview(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel
    ): void {
        webviewPanel.webview.postMessage({
            type: "update",
            text: document.getText(),
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Basic WYSIWYG</title>
        <style>
          body {
            margin: 0;
            padding: 20px;
            font-family: var(--vscode-editor-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
            font-size: var(--vscode-editor-font-size, 14px);
            line-height: 1.5;
            color: var(--vscode-editor-foreground, #333);
            background-color: var(--vscode-editor-background, #fff);
          }
          
          #content {
            outline: none;
            min-height: calc(100vh - 40px);
            white-space: pre-wrap;
            cursor: text;
          }
          
          #content:focus {
            outline: none;
          }
          
          .cursor {
            position: absolute;
            width: 2px;
            height: 20px;
            background-color: var(--vscode-editorCursor-foreground, #007ACC);
            animation: blink 1s infinite;
            pointer-events: none;
            z-index: 1000;
          }
          
          @keyframes blink {
            0%, 49% { opacity: 1; }
            50%, 100% { opacity: 0; }
          }
        </style>
      </head>
      <body>
        <div id="content" tabindex="0"></div>
        <div id="cursor" class="cursor"></div>
        
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const content = document.getElementById('content');
          const cursor = document.getElementById('cursor');
          
          let currentText = '';
          let cursorPosition = { line: 0, character: 0 };
          
          // Handle messages from extension
          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
              case 'update':
                currentText = message.text;
                content.textContent = message.text;
                updateCursorPosition();
                break;
            }
          });
          
          // Update cursor position
          function updateCursorPosition() {
            const lines = currentText.split('\\n');
            let y = 0;
            
            // Calculate Y position based on line
            for (let i = 0; i < cursorPosition.line && i < lines.length; i++) {
              y += getLineHeight();
            }
            
            // Calculate X position based on character
            const currentLine = lines[cursorPosition.line] || '';
            const x = cursorPosition.character * getCharWidth();
            
            cursor.style.left = x + 'px';
            cursor.style.top = y + 'px';
          }
          
          function getLineHeight() {
            return 21; // Approximate line height
          }
          
          function getCharWidth() {
            return 8.4; // Approximate character width
          }
          
          // Handle keyboard input
          content.addEventListener('keydown', e => {
            e.preventDefault();
            
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              // Printable character
              vscode.postMessage({
                command: 'type',
                text: e.key,
                position: cursorPosition
              });
              
              // Update local state
              const lines = currentText.split('\\n');
              const currentLine = lines[cursorPosition.line] || '';
              lines[cursorPosition.line] = currentLine.slice(0, cursorPosition.character) + e.key + currentLine.slice(cursorPosition.character);
              currentText = lines.join('\\n');
              content.textContent = currentText;
              
              // Move cursor
              cursorPosition.character++;
              updateCursorPosition();
            } else if (e.key === 'Enter') {
              // New line
              vscode.postMessage({
                command: 'type',
                text: '\\n',
                position: cursorPosition
              });
              
              // Update local state
              const lines = currentText.split('\\n');
              const currentLine = lines[cursorPosition.line] || '';
              lines[cursorPosition.line] = currentLine.slice(0, cursorPosition.character) + '\\n' + currentLine.slice(cursorPosition.character);
              currentText = lines.join('\\n');
              content.textContent = currentText;
              
              // Move cursor
              cursorPosition.line++;
              cursorPosition.character = 0;
              updateCursorPosition();
            } else if (e.key === 'Backspace') {
              if (cursorPosition.character > 0) {
                // Delete character before cursor
                const lines = currentText.split('\\n');
                const currentLine = lines[cursorPosition.line] || '';
                lines[cursorPosition.line] = currentLine.slice(0, cursorPosition.character - 1) + currentLine.slice(cursorPosition.character);
                currentText = lines.join('\\n');
                content.textContent = currentText;
                
                cursorPosition.character--;
                updateCursorPosition();
              } else if (cursorPosition.line > 0) {
                // Move to end of previous line
                const lines = currentText.split('\\n');
                const prevLine = lines[cursorPosition.line - 1] || '';
                const currentLine = lines[cursorPosition.line] || '';
                
                lines[cursorPosition.line - 1] = prevLine + currentLine;
                lines.splice(cursorPosition.line, 1);
                currentText = lines.join('\\n');
                content.textContent = currentText;
                
                cursorPosition.line--;
                cursorPosition.character = prevLine.length;
                updateCursorPosition();
              }
            } else if (e.key === 'ArrowLeft') {
              if (cursorPosition.character > 0) {
                cursorPosition.character--;
              } else if (cursorPosition.line > 0) {
                cursorPosition.line--;
                const lines = currentText.split('\\n');
                cursorPosition.character = (lines[cursorPosition.line] || '').length;
              }
              updateCursorPosition();
            } else if (e.key === 'ArrowRight') {
              const lines = currentText.split('\\n');
              const currentLine = lines[cursorPosition.line] || '';
              if (cursorPosition.character < currentLine.length) {
                cursorPosition.character++;
              } else if (cursorPosition.line < lines.length - 1) {
                cursorPosition.line++;
                cursorPosition.character = 0;
              }
              updateCursorPosition();
            } else if (e.key === 'ArrowUp') {
              if (cursorPosition.line > 0) {
                cursorPosition.line--;
                const lines = currentText.split('\\n');
                const currentLine = lines[cursorPosition.line] || '';
                cursorPosition.character = Math.min(cursorPosition.character, currentLine.length);
              }
              updateCursorPosition();
            } else if (e.key === 'ArrowDown') {
              const lines = currentText.split('\\n');
              if (cursorPosition.line < lines.length - 1) {
                cursorPosition.line++;
                const currentLine = lines[cursorPosition.line] || '';
                cursorPosition.character = Math.min(cursorPosition.character, currentLine.length);
              }
              updateCursorPosition();
            }
          });
          
          // Handle clicks to position cursor
          content.addEventListener('click', e => {
            const rect = content.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // Convert pixel coordinates to line/character
            const line = Math.floor(y / getLineHeight());
            const character = Math.floor(x / getCharWidth());
            
            cursorPosition = { line, character };
            updateCursorPosition();
            
            vscode.postMessage({
              command: 'click',
              position: cursorPosition
            });
          });
          
          // Focus content on load
          content.focus();
        </script>
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
