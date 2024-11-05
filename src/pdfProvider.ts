import * as vscode from 'vscode';
import * as path from 'path';
import { PdfPreview } from './pdfPreview';

// TODO: we could have deeper integration with vscode's undo/redo system via CustomDocumentEditEvent's undo/redo methods.
// however, that would require more message passing between the webview and the extension and some reimplementation. I don't think it is worthwhile.

// TODO: It'd be nice to have the PDF preview not be marked as dirty if you undo to the last saved state.
// Since we don't really integrate with vscode's undo/redo system at all, all vscode knows is that there was a change.
// Unfortunately there's no inverse event to say that it has become non-dirty.

// TODO: support backups

export class PdfCustomProvider implements vscode.CustomEditorProvider {
  public static readonly viewType = 'pdf.preview';

  private readonly _previews = new Set<PdfPreview>();
  private _activePreview: PdfPreview | undefined;

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<vscode.CustomDocument>>();
  public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  constructor(private readonly extensionRoot: vscode.Uri) { }

  public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: (): void => { } };
  }

  public async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewEditor: vscode.WebviewPanel
  ): Promise<void> {
    const preview = new PdfPreview(
      this.extensionRoot,
      document.uri,
      webviewEditor
    );
    this._previews.add(preview);
    this.setActivePreview(preview);

    webviewEditor.onDidDispose(() => {
      preview.dispose();
      this._previews.delete(preview);
    });

    webviewEditor.onDidChangeViewState(() => {
      if (webviewEditor.active) {
        this.setActivePreview(preview);
      } else if (this._activePreview === preview && !webviewEditor.active) {
        this.setActivePreview(undefined);
      }
    });

    preview.onDidChange(() => {
      this._onDidChangeCustomDocument.fire({
        document: document
      });
    });

    preview.onDoSave(([data, filename]) => {
      if (filename === undefined) {
        console.error("onDoSave: filename is undefined. Ignoring.");
        return;
      } else if (data === undefined) {
        console.error("onDoSave: data is undefined. Ignoring.");
        return;
      }

      let filename2 = vscode.Uri.from(filename as any);
      // we shouldn't actually call save custom document here, we should just save it.
      // save custom document should actually ask the webview to save it which would result in this event.
      vscode.workspace.fs.writeFile(document.uri, data);
    });

    preview.onCopyNote(([text, pageNumber]) => {
      if (!text) {
        return;
      }

      // TODO(minor): we could be smarter about this , this won't necessarily get the 'right' editor split in more complex scenarios.
      // At minimum we should prefer the editor split adjacent to the PDF preview.

      // Get the other editor split, which might not be focused
      const editor = vscode.window.visibleTextEditors.find(e =>
        e.document.uri.toString() !== this.activePreview.resource.toString()
      );
      if (!editor) {
        vscode.window.showInformationMessage("No other editor split found");
        return;
      }

      const citation = this.createPdfCitation(document.uri, editor, pageNumber);
      const finalText = text + (citation ? '\n' + citation : '');

      editor.edit(editBuilder => {
        const position = editor.selection.active;
        const line = editor.document.lineAt(position.line);

        if (line.text.trim().length > 0) {
          editBuilder.insert(position, '\n' + finalText);
        } else {
          editBuilder.insert(position, finalText);
        }
      });
    });
  }

  public get activePreview(): PdfPreview {
    return this._activePreview;
  }

  private setActivePreview(value: PdfPreview | undefined): void {
    this._activePreview = value;
  }

  public transferNoteToEditorSplit(): void {
    if (!this.activePreview) {
      return;
    }

    this.activePreview.copyNoteToEditorSplit();
  }

  public highlight(): void {
    if (!this.activePreview) {
      return;
    }

    this.activePreview.highlight();
  }

  public async saveCustomDocument(
    document: vscode.CustomDocument,
    cancellation: vscode.CancellationToken
  ): Promise<void> {
    await this.saveCustomDocumentAs(document, document.uri, cancellation);
  }

  /**
   * Alert the webview to send us the data to save (via onDoSave)
   */
  private requestSave(document: vscode.CustomDocument, destination: vscode.Uri): void {
    for (const preview of this._previews) {
      if (preview.resource.toString() === document.uri.toString()) {
        preview.requestSave(destination);
        break;
      }
    }
  }

  public async saveCustomDocumentAs(
    document: vscode.CustomDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken
  ): Promise<void> {
    // vscode.window.showInformationMessage(`saveCustomDocumentAs: ${document.uri.toString()} -> ${destination.toString()}`);
    this.requestSave(document, destination);
  }

  public async revertCustomDocument(
    document: vscode.CustomDocument,
    cancellation: vscode.CancellationToken
  ): Promise<void> {
    // vscode.window.showInformationMessage(`revertCustomDocument: ${document.uri.toString()}`);
    // TODO: Implement revert logic here (revert to last saved version)
  }

  public async backupCustomDocument(
    document: vscode.CustomDocument,
    context: vscode.CustomDocumentBackupContext,
    cancellation: vscode.CancellationToken
  ): Promise<vscode.CustomDocumentBackup> {
    // vscode.window.showInformationMessage(`backupCustomDocument: ${document.uri.toString()} -> ${context.destination.toString()}`);

    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // Ignore
        }
      }
    };
  }

  private createPdfCitation(pdfUri: vscode.Uri, editor: vscode.TextEditor, pageNumber: number): string {
    const includeFileLink = vscode.workspace.getConfiguration('pdf-preview.default').get('includeFileLink', true);

    if (!includeFileLink) {
      return '';
    }

    const filename = pdfUri.path.split('/').pop(); // Get just the filename

    // Calculate relative path from editor file to PDF file
    const editorPath = editor.document.uri.path;
    const pdfPath = pdfUri.path;

    // Get the directory of the editor file
    const editorDir = editorPath.substring(0, editorPath.lastIndexOf('/'));

    // Create relative path and encode it
    let relativePath = path.relative(editorDir, pdfPath);
    if (!relativePath.startsWith('.')) {
      relativePath = './' + relativePath;
    }
    const encodedPath = encodeURI(relativePath);

    return `> - [${filename}](${encodedPath}#page=${pageNumber})`;
  }

  public insertCitation(): void {
    if (!this.activePreview) {
      return;
    }

    const editor = vscode.window.visibleTextEditors.find(e =>
      e.document.uri.toString() !== this.activePreview.resource.toString()
    );

    if (!editor) {
      vscode.window.showInformationMessage("No other editor split found");
      return;
    }

    this.activePreview.getCurrentPage().then(pageNumber => {
      const citation = this.createPdfCitation(this.activePreview.resource, editor, pageNumber);

      editor.edit(editBuilder => {
        const position = editor.selection.active;
        const line = editor.document.lineAt(position.line);

        if (line.text.trim().length > 0) {
          editBuilder.insert(position, '\n' + citation);
        } else {
          editBuilder.insert(position, citation);
        }
      });
    });
  }
}
