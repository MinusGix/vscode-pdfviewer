import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { openUrlInWebview } from './extension';

interface UrlFileConfig {
    url: string;
    displayMode: 'frameless' | 'frame';
}

export class WebPreviewProvider implements vscode.CustomEditorProvider {
    public static readonly viewType = 'lattice.webPreview';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<vscode.CustomDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private _activeWebview?: vscode.Webview;
    private _activeDocument?: vscode.CustomDocument;

    constructor(
        private readonly extensionRoot: vscode.Uri
    ) { }

    public async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: (): void => { } };
    }

    private async fetchWebpage(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;

            client.get(url, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    // Handle redirects
                    if (res.headers.location) {
                        return resolve(this.fetchWebpage(res.headers.location));
                    }
                }

                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });
    }

    private async parseUrlFile(fileContent: string): Promise<UrlFileConfig> {
        const lines = fileContent.trim().split('\n');
        const url = lines[0].trim();
        const displayMode = lines[1]?.trim().toLowerCase() === 'frame' ? 'frame' : 'frameless';
        return { url, displayMode };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        this._activeDocument = document;
        this._activeWebview = webviewPanel.webview;

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [],
        };

        // Add message handler for link clicks
        webviewPanel.webview.onDidReceiveMessage(async message => {
            if (message.type === 'link-click') {
                await openUrlInWebview(message.url);
            }
        });

        webviewPanel.onDidDispose(() => {
            if (this._activeDocument === document) {
                this._activeDocument = undefined;
                this._activeWebview = undefined;
            }
        });

        try {
            let fileContent: string;
            if (document.uri.scheme === 'untitled') {
                const textDocument = await vscode.workspace.openTextDocument(document.uri);
                fileContent = textDocument.getText();
            } else {
                const content = await vscode.workspace.fs.readFile(document.uri);
                fileContent = new TextDecoder().decode(content);
            }

            const config = await this.parseUrlFile(fileContent);

            try {
                new URL(config.url);
                if (config.displayMode === 'frame') {
                    webviewPanel.webview.html = this.getIframeContent(config.url);
                } else {
                    const html = await this.fetchWebpage(config.url);
                    webviewPanel.webview.html = await this.getWebviewContent(html, config.url);
                }
            } catch (error) {
                webviewPanel.webview.html = this.getErrorHtml(`Invalid URL or failed to fetch webpage: ${config.url}`);
            }
        } catch (error) {
            webviewPanel.webview.html = this.getErrorHtml('Error loading URL');
        }
    }

    public async handleCopy(): Promise<void> {
        // The VSCode command system will handle getting the selection automatically
        // We don't need to do anything here!
    }

    // Implement required interface methods
    public async saveCustomDocument(
        document: vscode.CustomDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        const textDocument = await vscode.workspace.openTextDocument(document.uri);
        const content = textDocument.getText();
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(document.uri, encoder.encode(content));
    }

    public async saveCustomDocumentAs(
        document: vscode.CustomDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        // Copy the URL file to the new location
        await vscode.workspace.fs.copy(document.uri, destination, { overwrite: true });
    }

    public async revertCustomDocument(
        document: vscode.CustomDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        // No revert needed as we don't modify the file
        return;
    }

    public async backupCustomDocument(
        document: vscode.CustomDocument,
        context: vscode.CustomDocumentBackupContext,
        cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        // Copy the file to the backup location
        await vscode.workspace.fs.copy(document.uri, context.destination, { overwrite: true });

        return {
            id: context.destination.toString(),
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(context.destination);
                } catch {
                    // Ignore deletion errors
                }
            }
        };
    }

    private async getWebviewContent(html: string, baseUrl: string): Promise<string> {
        const scriptPath = path.join(this.extensionRoot.path, 'lib', 'quotation.js');
        const scriptText = fs.readFileSync(scriptPath, 'utf8');

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <base href="${baseUrl}">
                <title>Web Preview</title>
                <style>
                    body, html {
                        margin: 0;
                        padding: 0;
                        width: 100%;
                        height: 100%;
                        background-color: white;
                        color: black;
                        font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif;
                    }
                    * {
                        color-scheme: light;
                    }
                    body {
                        padding: 8px;
                        box-sizing: border-box;
                    }
                    a {
                        color: -webkit-link;
                        cursor: pointer;
                        text-decoration: underline;
                    }
                    a:visited {
                        color: #551A8B;
                    }
                </style>
                <script>
                    window.pageBaseUrl = "${baseUrl}";
                    ${scriptText}
                </script>
            </head>
            <body>
                ${html}
            </body>
            </html>
        `;
    }

    private getErrorHtml(message: string): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        font-family: sans-serif;
                    }
                    .error {
                        padding: 2em;
                        color: #d32f2f;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                <div class="error">
                    <h1>⚠️ Error</h1>
                    <p>${message}</p>
                </div>
            </body>
            </html>
        `;
    }

    private async createWebCitation(url: string, editor: vscode.TextEditor): Promise<string | null> {
        try {
            new URL(url); // Validate URL

            // Calculate relative path from editor file to URL file
            const editorPath = editor.document.uri.path;
            const urlFilePath = this._activeDocument!.uri.path;
            const editorDir = editorPath.substring(0, editorPath.lastIndexOf('/'));

            let relativePath = path.relative(editorDir, urlFilePath);
            if (!relativePath.startsWith('.')) {
                relativePath = './' + relativePath;
            }
            const encodedPath = encodeURI(relativePath);

            return `> - [${url}](${encodedPath})`;
        } catch (error) {
            vscode.window.showErrorMessage('Invalid URL in file');
            return null;
        }
    }

    private async insertIntoEditor(editor: vscode.TextEditor, text: string): Promise<void> {
        editor.edit(editBuilder => {
            const position = editor.selection.active;
            const line = editor.document.lineAt(position.line);

            if (line.text.trim().length > 0) {
                editBuilder.insert(position, '\n' + text);
            } else {
                editBuilder.insert(position, text);
            }
        });
    }

    public async insertQuotation(): Promise<void> {
        if (!this._activeWebview || !this._activeDocument) {
            return;
        }

        const editor = vscode.window.visibleTextEditors.find(e =>
            e.document.uri.toString() !== this._activeDocument!.uri.toString()
        );

        if (!editor) {
            vscode.window.showInformationMessage("No other editor split found");
            return;
        }

        // Get the selected text and links from the webview
        const selection = await new Promise<{ markdown: string }>((resolve) => {
            const listener = this._activeWebview!.onDidReceiveMessage(e => {
                if (e.type === 'selection') {
                    listener.dispose();
                    resolve(e);
                }
            });
            this._activeWebview!.postMessage({ type: 'get-selection' });
        });

        // Get current URL from the document
        const fileContent = await vscode.workspace.fs.readFile(this._activeDocument.uri);
        const url = new TextDecoder().decode(fileContent).trim();

        // Format the citation with the selected text if any
        let citation = '';
        if (selection.markdown) {
            citation = selection.markdown
                .split('\n')
                .map(line => `> ${line}`)
                .join('\n') + '\n';
        }

        const urlCitation = await this.createWebCitation(url, editor);
        if (urlCitation) {
            citation += urlCitation;
            await this.insertIntoEditor(editor, citation);
        }
    }

    public async insertCitation(): Promise<void> {
        if (!this._activeWebview || !this._activeDocument) {
            return;
        }

        const editor = vscode.window.visibleTextEditors.find(e =>
            e.document.uri.toString() !== this._activeDocument!.uri.toString()
        );

        if (!editor) {
            vscode.window.showInformationMessage("No other editor split found");
            return;
        }

        // Get current URL from the document
        const fileContent = await vscode.workspace.fs.readFile(this._activeDocument.uri);
        const url = new TextDecoder().decode(fileContent).trim();

        const citation = await this.createWebCitation(url, editor);
        if (citation) {
            await this.insertIntoEditor(editor, citation);
        }
    }

    private getIframeContent(url: string): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Web Preview</title>
                <style>
                    body, html, iframe {
                        margin: 0;
                        padding: 0;
                        width: 100%;
                        height: 100%;
                        border: none;
                        overflow: hidden;
                    }
                </style>
            </head>
            <body>
                <iframe 
                    src="${url}" 
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox"
                ></iframe>
            </body>
            </html>
        `;
    }
} 