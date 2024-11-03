import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable } from './disposable';

function escapeAttribute(value: string | vscode.Uri): string {
  return value.toString().replace(/"/g, '&quot;');
}

type PreviewState = 'Disposed' | 'Visible' | 'Active';

export class PdfPreview extends Disposable {
  private _previewState: PreviewState = 'Visible';
  private _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;
  private _onDoSave = new vscode.EventEmitter<[Uint8Array, string]>();
  public readonly onDoSave = this._onDoSave.event;
  constructor(
    private readonly extensionRoot: vscode.Uri,
    public readonly resource: vscode.Uri,
    private readonly webviewEditor: vscode.WebviewPanel
  ) {
    super();
    const resourceRoot = resource.with({
      path: resource.path.replace(/\/[^/]+?\.\w+$/, '/'),
    });

    webviewEditor.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot, extensionRoot],
    };

    this._register(
      webviewEditor.webview.onDidReceiveMessage((message) => {
        switch (message.type) {
          case 'reopen-as-text': {
            vscode.commands.executeCommand(
              'vscode.openWith',
              resource,
              'default',
              webviewEditor.viewColumn
            );
            break;
          }
          case 'documentDirty': {
            this._onDidChange.fire();
            break;
          }
          case 'save': {
            this._onDoSave.fire([message.data, message.destination]);
          }
        }
      })
    );

    this._register(
      webviewEditor.onDidChangeViewState(() => {
        this.update();
      })
    );

    this._register(
      webviewEditor.onDidDispose(() => {
        this._previewState = 'Disposed';
      })
    );

    const watcher = this._register(
      vscode.workspace.createFileSystemWatcher(resource.fsPath)
    );
    this._register(
      watcher.onDidChange((e) => {
        if (e.toString() === this.resource.toString()) {
          this.reload();
        }
      })
    );
    this._register(
      watcher.onDidDelete((e) => {
        if (e.toString() === this.resource.toString()) {
          this.webviewEditor.dispose();
        }
      })
    );

    this.webviewEditor.webview.html = this.getWebviewContents();
    this.update();
  }

  public requestSave(destination: vscode.Uri) {
    this.webviewEditor.webview.postMessage({ type: 'save', destination });
  }

  private reload(): void {
    if (this._previewState !== 'Disposed') {
      this.webviewEditor.webview.postMessage({ type: 'reload' });
    }
  }

  private update(): void {
    if (this._previewState === 'Disposed') {
      return;
    }

    if (this.webviewEditor.active) {
      this._previewState = 'Active';
      return;
    }
    this._previewState = 'Visible';
  }

  private getWebviewContents(): string {
    const webview = this.webviewEditor.webview;
    const docPath = webview.asWebviewUri(this.resource);
    const cspSource = webview.cspSource;
    const resolveAsUri = (...p: string[]): vscode.Uri => {
      const uri = vscode.Uri.file(path.join(this.extensionRoot.path, ...p));
      return webview.asWebviewUri(uri);
    };

    const config = vscode.workspace.getConfiguration('pdf-preview');
    const settings = {
      cMapUrl: resolveAsUri('lib', 'web', 'cmaps/').toString(),
      path: docPath.toString(),
      defaults: {
        cursor: config.get('default.cursor') as string,
        scale: config.get('default.scale') as string,
        sidebar: config.get('default.sidebar') as boolean,
        scrollMode: config.get('default.scrollMode') as string,
        spreadMode: config.get('default.spreadMode') as string,
      },
    };

    const head = `<!DOCTYPE html>
<html dir="ltr" mozdisallowselectionprint>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="google" content="notranslate">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${cspSource}; script-src 'unsafe-inline' ${cspSource}; style-src 'unsafe-inline' ${cspSource}; img-src blob: data: ${cspSource};">
<meta id="pdf-preview-config" data-config="${escapeAttribute(
      JSON.stringify(settings)
    )}">
<title>PDF.js viewer</title>
<link rel="resource" type="application/l10n" href="${resolveAsUri(
      'lib',
      'web',
      'locale',
      'locale.properties'
    )}">
<link rel="stylesheet" href="${resolveAsUri('lib', 'web', 'viewer.css')}">
<link rel="stylesheet" href="${resolveAsUri('lib', 'pdf.css')}">
<script src="${resolveAsUri('lib', 'build', 'pdf.mjs')}" type="module"></script>
<script src="${resolveAsUri('lib', 'build', 'pdf.worker.mjs')}" type="module"></script>
<script src="${resolveAsUri('lib', 'web', 'viewer.mjs')}" type="module"></script>
<script src="${resolveAsUri('lib', 'main.js')}" type="module"></script>
</head>`;

    const bodyPath = path.join(this.extensionRoot.path, 'lib', 'viewer-body.html');
    const body = fs.readFileSync(bodyPath, 'utf8');

    const tail = ['</html>'].join('\n');

    return head + body + tail;
  }
}
