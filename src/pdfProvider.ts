import * as vscode from 'vscode';
import * as path from 'path';
import { PdfPreview } from './pdfPreview';
import { DocumentTitleManager } from './documentTitles';
import { NotesAssociationManager } from './notesAssociation';

// TODO: we could have deeper integration with vscode's undo/redo system via CustomDocumentEditEvent's undo/redo methods.
// however, that would require more message passing between the webview and the extension and some reimplementation. I don't think it is worthwhile.

// TODO: It'd be nice to have the PDF preview not be marked as dirty if you undo to the last saved state.
// Since we don't really integrate with vscode's undo/redo system at all, all vscode knows is that there was a change.
// Unfortunately there's no inverse event to say that it has become non-dirty.

// TODO: support backups

export class PdfCustomProvider implements vscode.CustomEditorProvider {
  public static readonly viewType = 'lattice.preview';

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
    try {
      DocumentTitleManager.getInstance().updateStatusBar(document.uri);
    } catch { /* ignore if not initialized yet */ }
    try {
      NotesAssociationManager.getInstance().updateActivePdf(document.uri);
    } catch { /* ignore if not available */ }

    webviewEditor.onDidDispose(() => {
      preview.dispose();
      this._previews.delete(preview);
      try { NotesAssociationManager.getInstance().updateActivePdf(undefined); } catch { }
    });

    webviewEditor.onDidChangeViewState(() => {
      if (webviewEditor.active) {
        this.setActivePreview(preview);
        try { DocumentTitleManager.getInstance().updateStatusBar(document.uri); } catch { }
        try { NotesAssociationManager.getInstance().updateActivePdf(document.uri); } catch { }
      } else if (this._activePreview === preview && !webviewEditor.active) {
        this.setActivePreview(undefined);
        try { NotesAssociationManager.getInstance().updateActivePdf(undefined); } catch { }
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

    preview.onCopyNote(([text, pageNumber]: [string | undefined, number]) => {
      // Check for undefined first
      if (!text) {
        return;
      }

      // Then trim and check if empty
      const trimmedText = text.trim();
      if (!trimmedText) {
        return;
      }

      const editor = vscode.window.visibleTextEditors.find(e =>
        e.document.uri.toString() !== this.activePreview?.resource.toString()
      );
      if (!editor) {
        vscode.window.showInformationMessage("No other editor split found");
        return;
      }

      this.createPdfCitation(document.uri, editor, pageNumber).then(citation => {
        const finalText = trimmedText + (citation ? '\n' + citation : '');
        this.insertIntoEditor(editor, finalText);
      });
    });
  }

  public get activePreview(): PdfPreview | undefined {
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

  private async createPdfCitation(pdfUri: vscode.Uri, editor: vscode.TextEditor, pageNumber: number): Promise<string> {
    const includeFileLink = vscode.workspace.getConfiguration('pdf-preview.default').get('includeFileLink', true);

    if (!includeFileLink) {
      return '';
    }

    // Get the preview instance for this PDF
    const preview = Array.from(this._previews).find(p => p.resource.toString() === pdfUri.toString());

    // Get title or fallback to filename
    const title = preview ? await preview.getPdfTitle() : null;
    const displayName = title || path.parse(pdfUri.fsPath).name;

    // Calculate relative path from editor file to PDF file
    const editorPath = editor.document.uri.path;
    const pdfPath = pdfUri.path;
    const editorDir = editorPath.substring(0, editorPath.lastIndexOf('/'));

    let relativePath = path.relative(editorDir, pdfPath);
    if (!relativePath.startsWith('.')) {
      relativePath = './' + relativePath;
    }
    const encodedPath = encodeURI(relativePath);

    return `> - [${displayName}](${encodedPath}#page=${pageNumber})`;
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

  public async insertCitation(): Promise<void> {
    if (!this.activePreview) {
      return;
    }

    const editor = vscode.window.visibleTextEditors.find(e =>
      e.document.uri.toString() !== this.activePreview?.resource.toString()
    );

    if (!editor) {
      vscode.window.showInformationMessage("No other editor split found");
      return;
    }

    const pageNumber = await this.activePreview.getCurrentPage();
    const citation = await this.createPdfCitation(this.activePreview.resource, editor, pageNumber);
    await this.insertIntoEditor(editor, citation);
  }

  public async insertQuotation(): Promise<void> {
    if (!this.activePreview) {
      return;
    }

    this.transferNoteToEditorSplit();
  }
}
