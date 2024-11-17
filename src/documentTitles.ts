import * as vscode from 'vscode';
import * as path from 'path';

export class DocumentTitleManager {
    private static instance: DocumentTitleManager;
    private titleCache: Map<string, string | null> = new Map();
    private _onDidChangeTitle = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChangeTitle = this._onDidChangeTitle.event;
    private statusBarItem: vscode.StatusBarItem;

    private constructor(private storage: vscode.Memento) {
        // Load saved titles
        const saved = this.storage.get<{ [key: string]: string }>('documentTitles', {});
        Object.entries(saved).forEach(([uri, title]) => {
            this.titleCache.set(uri, title);
        });

        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.statusBarItem.command = 'lattice.editTitle';
        this.statusBarItem.tooltip = 'Click to edit document title';
    }

    public static init(storage: vscode.Memento): void {
        if (!DocumentTitleManager.instance) {
            DocumentTitleManager.instance = new DocumentTitleManager(storage);
        }
    }

    public static getInstance(): DocumentTitleManager {
        if (!DocumentTitleManager.instance) {
            throw new Error('DocumentTitleManager not initialized');
        }
        return DocumentTitleManager.instance;
    }

    private saveTitles(): void {
        const titles: { [key: string]: string } = {};
        this.titleCache.forEach((title, uri) => {
            if (title) { // Only save non-null titles
                titles[uri] = title;
            }
        });
        this.storage.update('documentTitles', titles);
    }

    /**
     * Get the title for a document. Returns null if no title is found.
     */
    public getTitle(uri: vscode.Uri): string | null {
        return this.titleCache.get(uri.toString()) ?? null;
    }

    /**
     * Set the title for a document
     */
    public setTitle(uri: vscode.Uri, title: string | null): void {
        if (!title) {
            this.titleCache.delete(uri.toString());
        } else {
            this.titleCache.set(uri.toString(), title);
        }
        this.saveTitles();
        this._onDidChangeTitle.fire(uri);
        this.updateStatusBar(uri);
    }

    /**
     * Edit the title of a document via user input
     */
    public async editTitle(uri: vscode.Uri): Promise<void> {
        const currentTitle = this.getTitle(uri) ?? path.parse(uri.fsPath).name;
        const newTitle = await vscode.window.showInputBox({
            prompt: 'Enter a new title for the document',
            value: currentTitle,
            placeHolder: 'Document title',
            validateInput: (value) => {
                if (value.trim().length === 0) {
                    return 'Title cannot be empty';
                }
                if (value.length > 100) {
                    return 'Title is too long (maximum 100 characters)';
                }
                return null;
            }
        });

        if (newTitle !== undefined) { // Only update if user didn't cancel
            this.setTitle(uri, newTitle.trim() || null); // Convert empty string to null
        }
    }

    /**
     * Get a display name for a document. Falls back to filename if no title is found.
     */
    public getDisplayName(uri: vscode.Uri): string {
        const title = this.getTitle(uri);
        if (title) {
            return title;
        }
        return path.parse(uri.fsPath).name;
    }

    /**
     * Update the status bar with the current document's title
     */
    public updateStatusBar(uri: vscode.Uri): void {
        const title = this.getTitle(uri);
        if (title) {
            this.statusBarItem.text = `$(pencil) ${title}`;
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    /**
     * Clear all cached titles
     */
    public clear(): void {
        this.titleCache.clear();
        this.saveTitles();
    }

    /**
     * Remove a specific URI from the cache
     */
    public remove(uri: vscode.Uri): void {
        this.titleCache.delete(uri.toString());
        this.saveTitles();
    }

    /**
     * Dispose of the title manager and its resources
     */
    public dispose(): void {
        this.statusBarItem.dispose();
        this._onDidChangeTitle.dispose();
    }
} 