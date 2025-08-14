import * as vscode from "vscode";
import { marked } from "marked";
import { getStyles, mathJaxConfig } from "../SRS/styles";
import fs from "fs";

export class LiveMdEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "lattice.liveMarkdown";
  private currentSelection: vscode.Selection = new vscode.Selection(0, 0, 0, 0);

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // Initialize with cursor at start
    this.currentSelection = new vscode.Selection(0, 0, 0, 0);

    this.updateWebview(document, webviewPanel);

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          this.updateWebview(document, webviewPanel);
        }
      }
    );

    // Remove selection change listener as we manage our own cursor

    // Track webview focus state
    let webviewFocused = false;
    webviewPanel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        webviewFocused = true;
        // Update selection when webview becomes active
        this.updateSelection([this.currentSelection], webviewPanel);
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "type":
          // Insert text at current cursor position
          const edit = new vscode.WorkspaceEdit();
          const position = this.currentSelection.active;
          
          // If there's a selection, replace it
          if (!this.currentSelection.isEmpty) {
            edit.replace(document.uri, new vscode.Range(this.currentSelection.start, this.currentSelection.end), message.text);
          } else {
            edit.insert(document.uri, position, message.text);
          }
          
          await vscode.workspace.applyEdit(edit);
          
          // Update cursor position
          const newPosition = position.translate(0, message.text.length);
          this.currentSelection = new vscode.Selection(newPosition, newPosition);
          this.updateSelection([this.currentSelection], webviewPanel);
          break;
        case "key":
          // Handle special keys
          await this.handleSpecialKey(message, document, webviewPanel);
          break;
        case "setPosition":
          // Set cursor position based on click
          await this.setCursorPosition(document, message.line, message.character, webviewPanel);
          break;
        case "selectWord":
          // Select word at position
          await this.selectWordAt(document, message.line, message.character, webviewPanel);
          break;
        case "setSelection":
          // Set selection range
          await this.setSelection(document, message.startLine, message.startCharacter, message.endLine, message.endCharacter, webviewPanel);
          break;
        case "ready":
          // Webview is ready, send initial selection
          console.log("Webview ready, sending initial state");
          this.updateSelection([this.currentSelection], webviewPanel);
          break;
      }
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    const webviewUri = (p: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, p));

    return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Live Markdown</title>
                <script nonce="${nonce}">
                    ${mathJaxConfig}
                </script>
                <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
                <script src="${webviewUri("lib/purify.min.js")}"></script>
                <script src="${webviewUri(
                  "node_modules/marked/marked.min.js"
                )}"></script>
                <script src="${webviewUri("lib/markdown/positionMapper.js")}"></script>
                <link rel="stylesheet" href="${webviewUri(
                  "lib/markdown/live.css"
                )}">
            </head>
            <body>
                <div id="content" tabindex="0"></div>
                <textarea id="hidden-editor" aria-hidden="true"></textarea>
                <div id="cursor-overlay"></div>
                <script src="${webviewUri("lib/markdown/live.js")}"></script>
            </body>
            </html>
        `;
  }

  private updateWebview(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ) {
    webviewPanel.webview.postMessage({
      type: "update",
      text: document.getText(),
    });
  }

  private updateSelection(
    selections: readonly vscode.Selection[],
    webviewPanel: vscode.WebviewPanel
  ) {
    webviewPanel.webview.postMessage({
      type: "updateSelection",
      selections: selections.map((sel) => ({
        start: {
          line: sel.start.line,
          character: sel.start.character,
        },
        end: {
          line: sel.end.line,
          character: sel.end.character,
        },
      })),
    });
  }

  private async handleSpecialKey(message: any, document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel) {
    // Map special keys to VS Code commands
    const key = message.key;
    const modifiers = {
      ctrlKey: message.ctrlKey || false,
      shiftKey: message.shiftKey || false,
      altKey: message.altKey || false,
      metaKey: message.metaKey || false,
    };

    // Handle basic navigation and editing keys
    switch (key) {
      case "Backspace":
        if (!this.currentSelection.isEmpty) {
          // Delete selection
          const edit = new vscode.WorkspaceEdit();
          edit.delete(document.uri, new vscode.Range(this.currentSelection.start, this.currentSelection.end));
          await vscode.workspace.applyEdit(edit);
          this.currentSelection = new vscode.Selection(this.currentSelection.start, this.currentSelection.start);
        } else if (this.currentSelection.active.character > 0 || this.currentSelection.active.line > 0) {
          // Delete one character before cursor
          const edit = new vscode.WorkspaceEdit();
          const deleteStart = this.currentSelection.active.character > 0 
            ? this.currentSelection.active.translate(0, -1)
            : new vscode.Position(this.currentSelection.active.line - 1, document.lineAt(this.currentSelection.active.line - 1).text.length);
          edit.delete(document.uri, new vscode.Range(deleteStart, this.currentSelection.active));
          await vscode.workspace.applyEdit(edit);
          this.currentSelection = new vscode.Selection(deleteStart, deleteStart);
        }
        this.updateSelection([this.currentSelection], webviewPanel);
        break;
      case "Delete":
        if (!this.currentSelection.isEmpty) {
          // Delete selection
          const edit = new vscode.WorkspaceEdit();
          edit.delete(document.uri, new vscode.Range(this.currentSelection.start, this.currentSelection.end));
          await vscode.workspace.applyEdit(edit);
          this.currentSelection = new vscode.Selection(this.currentSelection.start, this.currentSelection.start);
        } else {
          // Delete one character after cursor
          const edit = new vscode.WorkspaceEdit();
          const line = document.lineAt(this.currentSelection.active.line);
          const deleteEnd = this.currentSelection.active.character < line.text.length
            ? this.currentSelection.active.translate(0, 1)
            : this.currentSelection.active.line < document.lineCount - 1
              ? new vscode.Position(this.currentSelection.active.line + 1, 0)
              : this.currentSelection.active;
          if (!deleteEnd.isEqual(this.currentSelection.active)) {
            edit.delete(document.uri, new vscode.Range(this.currentSelection.active, deleteEnd));
            await vscode.workspace.applyEdit(edit);
          }
        }
        this.updateSelection([this.currentSelection], webviewPanel);
        break;
      case "Enter":
        // Insert newline
        const enterEdit = new vscode.WorkspaceEdit();
        enterEdit.insert(document.uri, this.currentSelection.active, "\n");
        await vscode.workspace.applyEdit(enterEdit);
        const newLine = this.currentSelection.active.line + 1;
        this.currentSelection = new vscode.Selection(newLine, 0, newLine, 0);
        this.updateSelection([this.currentSelection], webviewPanel);
        break;
      case "Tab":
        await vscode.commands.executeCommand("tab");
        break;
      case "ArrowLeft":
        // Move cursor left
        const currentLine = document.lineAt(this.currentSelection.active.line);
        let newPos: vscode.Position;
        if (this.currentSelection.active.character > 0) {
          newPos = this.currentSelection.active.translate(0, -1);
        } else if (this.currentSelection.active.line > 0) {
          const prevLine = document.lineAt(this.currentSelection.active.line - 1);
          newPos = new vscode.Position(this.currentSelection.active.line - 1, prevLine.text.length);
        } else {
          newPos = this.currentSelection.active;
        }
        
        if (modifiers.shiftKey) {
          this.currentSelection = new vscode.Selection(this.currentSelection.anchor, newPos);
        } else {
          this.currentSelection = new vscode.Selection(newPos, newPos);
        }
        this.updateSelection([this.currentSelection], webviewPanel);
        break;
      case "ArrowRight":
        // Move cursor right
        const line = document.lineAt(this.currentSelection.active.line);
        let newPosRight: vscode.Position;
        if (this.currentSelection.active.character < line.text.length) {
          newPosRight = this.currentSelection.active.translate(0, 1);
        } else if (this.currentSelection.active.line < document.lineCount - 1) {
          newPosRight = new vscode.Position(this.currentSelection.active.line + 1, 0);
        } else {
          newPosRight = this.currentSelection.active;
        }
        
        if (modifiers.shiftKey) {
          this.currentSelection = new vscode.Selection(this.currentSelection.anchor, newPosRight);
        } else {
          this.currentSelection = new vscode.Selection(newPosRight, newPosRight);
        }
        this.updateSelection([this.currentSelection], webviewPanel);
        break;
      case "ArrowUp":
        if (modifiers.shiftKey) {
          await vscode.commands.executeCommand("cursorUpSelect");
        } else {
          await vscode.commands.executeCommand("cursorUp");
        }
        break;
      case "ArrowDown":
        if (modifiers.shiftKey) {
          await vscode.commands.executeCommand("cursorDownSelect");
        } else {
          await vscode.commands.executeCommand("cursorDown");
        }
        break;
      case "Home":
        if (modifiers.shiftKey) {
          await vscode.commands.executeCommand("cursorHomeSelect");
        } else {
          await vscode.commands.executeCommand("cursorHome");
        }
        break;
      case "End":
        if (modifiers.shiftKey) {
          await vscode.commands.executeCommand("cursorEndSelect");
        } else {
          await vscode.commands.executeCommand("cursorEnd");
        }
        break;
      case "PageUp":
        await vscode.commands.executeCommand("cursorPageUp");
        break;
      case "PageDown":
        await vscode.commands.executeCommand("cursorPageDown");
        break;
      case "a":
        if (modifiers.ctrlKey || modifiers.metaKey) {
          await vscode.commands.executeCommand("editor.action.selectAll");
        }
        break;
      case "c":
        if (modifiers.ctrlKey || modifiers.metaKey) {
          await vscode.commands.executeCommand("editor.action.clipboardCopyAction");
        }
        break;
      case "v":
        if (modifiers.ctrlKey || modifiers.metaKey) {
          await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
        }
        break;
      case "x":
        if (modifiers.ctrlKey || modifiers.metaKey) {
          await vscode.commands.executeCommand("editor.action.clipboardCutAction");
        }
        break;
      case "z":
        if (modifiers.ctrlKey || modifiers.metaKey) {
          if (modifiers.shiftKey) {
            await vscode.commands.executeCommand("redo");
          } else {
            await vscode.commands.executeCommand("undo");
          }
        }
        break;
    }
  }

  private async setCursorPosition(document: vscode.TextDocument, line: number, character: number, webviewPanel: vscode.WebviewPanel) {
    // Ensure the position is within bounds
    const maxLine = document.lineCount - 1;
    const clampedLine = Math.max(0, Math.min(line, maxLine));
    const lineText = document.lineAt(clampedLine).text;
    const clampedChar = Math.max(0, Math.min(character, lineText.length));
    
    const newPosition = new vscode.Position(clampedLine, clampedChar);
    this.currentSelection = new vscode.Selection(newPosition, newPosition);
    this.updateSelection([this.currentSelection], webviewPanel);
  }

  private async selectWordAt(document: vscode.TextDocument, line: number, character: number, webviewPanel: vscode.WebviewPanel) {
    // Ensure the position is within bounds
    const maxLine = document.lineCount - 1;
    const clampedLine = Math.max(0, Math.min(line, maxLine));
    const lineText = document.lineAt(clampedLine).text;
    const clampedChar = Math.max(0, Math.min(character, lineText.length));
    
    const position = new vscode.Position(clampedLine, clampedChar);
    
    // Get word range at position
    const wordRange = document.getWordRangeAtPosition(position);
    if (wordRange) {
      this.currentSelection = new vscode.Selection(wordRange.start, wordRange.end);
      this.updateSelection([this.currentSelection], webviewPanel);
    }
  }

  private async setSelection(document: vscode.TextDocument, startLine: number, startCharacter: number, endLine: number, endCharacter: number, webviewPanel: vscode.WebviewPanel) {
    // Ensure positions are within bounds
    const maxLine = document.lineCount - 1;
    const clampedStartLine = Math.max(0, Math.min(startLine, maxLine));
    const clampedEndLine = Math.max(0, Math.min(endLine, maxLine));
    
    const startLineText = document.lineAt(clampedStartLine).text;
    const endLineText = document.lineAt(clampedEndLine).text;
    
    const clampedStartChar = Math.max(0, Math.min(startCharacter, startLineText.length));
    const clampedEndChar = Math.max(0, Math.min(endCharacter, endLineText.length));
    
    const startPosition = new vscode.Position(clampedStartLine, clampedStartChar);
    const endPosition = new vscode.Position(clampedEndLine, clampedEndChar);
    
    this.currentSelection = new vscode.Selection(startPosition, endPosition);
    this.updateSelection([this.currentSelection], webviewPanel);
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
