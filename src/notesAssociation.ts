import * as vscode from 'vscode';
import * as path from 'path';

type PdfToNotesMap = { [pdfPath: string]: string };

/**
 * Manages association between a PDF and a notes Markdown file.
 * Data is stored in workspace settings under `lattice.associatedNotes`.
 */
export class NotesAssociationManager {
    private static instance: NotesAssociationManager | undefined;

    private readonly statusBarItem: vscode.StatusBarItem;
    private _activePdfUri: vscode.Uri | undefined;

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
        // Default command opens beside. A separate command can open in the current group.
        this.statusBarItem.command = 'lattice.openAssociatedNotes';
        this.statusBarItem.tooltip = 'Open associated notes';
        this.statusBarItem.hide();

        // Refresh when settings change (e.g., association added/removed manually)
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('lattice.associatedNotes')) {
                this.updateStatusBar();
            }
        });
    }

    public static getInstance(): NotesAssociationManager {
        if (!NotesAssociationManager.instance) {
            NotesAssociationManager.instance = new NotesAssociationManager();
        }
        return NotesAssociationManager.instance;
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }

    /**
     * Update the active PDF URI and refresh the status bar button visibility/text.
     */
    public updateActivePdf(pdfUri: vscode.Uri | undefined): void {
        this._activePdfUri = pdfUri;
        this.updateStatusBar();
    }

    /**
     * Recompute the status bar item based on current active PDF and config mapping.
     */
    public updateStatusBar(): void {
        const alwaysShow = vscode.workspace.getConfiguration().get<boolean>('lattice.associatedNotes.alwaysShowButton', true);
        const associated = this._activePdfUri ? this.getAssociatedNotesUri(this._activePdfUri) : undefined;
        if (!alwaysShow && (!this._activePdfUri || !associated)) {
            this.statusBarItem.hide();
            return;
        }

        const fileName = associated ? path.parse(associated.fsPath).base : 'Notes';
        // Show a concise label with an icon and the file's basename
        this.statusBarItem.text = `$(book) ${fileName}`;
        this.statusBarItem.tooltip = associated ? `Open associated notes: ${associated.fsPath}` : 'Open associated notes';
        this.statusBarItem.show();
    }

    /**
     * Prompt the user to pick an open Markdown document and associate it with the active PDF.
     */
    public async associateWithActivePdf(pdfOverride?: vscode.Uri): Promise<void> {
        const pdfUri = pdfOverride ?? this._activePdfUri;
        if (!pdfUri) {
            vscode.window.showErrorMessage('No active PDF');
            return;
        }

        // Prefer open tabs (even if not visible) for Markdown
        const tabMdUris: vscode.Uri[] = [];
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputText) {
                    const uri = tab.input.uri;
                    if (uri.fsPath.toLowerCase().endsWith('.md')) {
                        tabMdUris.push(uri);
                    }
                }
            }
        }

        // Fallbacks: visible editors, then open text documents
        const visibleMdUris = vscode.window.visibleTextEditors
            .filter(e => e.document.languageId === 'markdown' || e.document.fileName.toLowerCase().endsWith('.md'))
            .map(e => e.document.uri);

        const docMdUris = vscode.workspace.textDocuments
            .filter(d => (d.languageId === 'markdown' || d.fileName.toLowerCase().endsWith('.md')) && !d.isClosed)
            .map(d => d.uri);

        const allUris = Array.from(new Map([
            ...tabMdUris.map(u => [u.toString(), u] as const),
            ...visibleMdUris.map(u => [u.toString(), u] as const),
            ...docMdUris.map(u => [u.toString(), u] as const),
        ]).values()).filter(u => u.scheme !== 'untitled');

        if (allUris.length === 0) {
            vscode.window.showInformationMessage('No open Markdown files to associate.');
            return;
        }

        const items = allUris.map(uri => ({
            label: path.parse(uri.fsPath).base,
            description: vscode.workspace.asRelativePath(uri, false),
            uri
        }));

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an open Markdown file to associate with this PDF',
            matchOnDescription: true
        });

        if (!pick) {
            return;
        }

        await this.setAssociation(pdfUri, pick.uri);
        vscode.window.showInformationMessage(`Associated notes '${pick.label}' with '${path.parse(pdfUri.fsPath).base}'.`);
        this.updateStatusBar();
    }

    /**
     * Open the associated notes for the active PDF.
     * @param target 'beside' to open in a split, 'current' to open in the current group.
     */
    public async openAssociated(target: 'beside' | 'current' = 'beside'): Promise<void> {
        if (!this._activePdfUri) {
            vscode.window.showErrorMessage('No active PDF');
            return;
        }

        const notesUri = this.getAssociatedNotesUri(this._activePdfUri);
        if (!notesUri) {
            vscode.window.showInformationMessage('No associated notes for this PDF.');
            return;
        }

        try {
            const viewColumn = target === 'beside' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
            await vscode.window.showTextDocument(notesUri, { viewColumn, preview: false, preserveFocus: false });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open associated notes: ${err.message}`);
        }
    }

    /**
     * Retrieve the associated notes file for a PDF URI, if any.
     */
    public getAssociatedNotesUri(pdfUri: vscode.Uri): vscode.Uri | undefined {
        const configMap = this.getConfigMap();
        const key = this.toKey(pdfUri);
        const notesPath = configMap[key];
        if (!notesPath) {
            return undefined;
        }

        // Interpret stored path relative to workspace, if necessary
        const candidate = this.fromStoredPath(notesPath);
        return candidate;
    }

    /**
     * Persist the association in workspace settings.
     */
    private async setAssociation(pdfUri: vscode.Uri, notesUri: vscode.Uri): Promise<void> {
        const existing = this.getConfigMap();
        const key = this.toKey(pdfUri);
        const storedPath = this.toStoredPath(notesUri);
        const updated: PdfToNotesMap = { ...existing, [key]: storedPath };
        await vscode.workspace.getConfiguration().update('lattice.associatedNotes', updated, vscode.ConfigurationTarget.Workspace);
    }

    private getConfigMap(): PdfToNotesMap {
        const obj = vscode.workspace.getConfiguration().get<PdfToNotesMap>('lattice.associatedNotes');
        return obj ?? {};
    }

    /**
     * Convert a URI to a key. Prefer workspace-relative path for readability and portability.
     */
    private toKey(uri: vscode.Uri): string {
        return uri.fsPath;
    }

    /**
     * Convert a URI to a stored path string. Use workspace-relative if possible.
     */
    private toStoredPath(uri: vscode.Uri): string {
        // Store absolute path for reliability across multi-root workspaces
        return uri.fsPath;
    }

    /**
     * Convert a stored path back into a URI. If relative, resolve against the first workspace folder.
     */
    private fromStoredPath(stored: string): vscode.Uri {
        return path.isAbsolute(stored) ? vscode.Uri.file(stored) : vscode.Uri.file(stored);
    }
}

