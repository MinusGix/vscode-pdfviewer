import * as vscode from 'vscode';
import { MdCard } from './card';
import { MdParser } from './mdParser';

export interface CardUpdateEvent {
    type: 'add' | 'update' | 'delete';
    uri: vscode.Uri;
    cards?: MdCard[];
}

export class CardManager {
    private static instance: CardManager;
    private cardsByFile: Map<string, MdCard[]>;
    private disposables: vscode.Disposable[];
    private initialized: boolean;
    private readonly _onDidUpdateCards = new vscode.EventEmitter<CardUpdateEvent>();
    public readonly onDidUpdateCards = this._onDidUpdateCards.event;

    private constructor() {
        this.cardsByFile = new Map();
        this.disposables = [];
        this.initialized = false;

        // Watch for file changes
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');

        this.disposables.push(
            watcher,
            this._onDidUpdateCards,
            watcher.onDidChange(this.handleFileChange.bind(this)),
            watcher.onDidCreate(this.handleFileChange.bind(this)),
            watcher.onDidDelete(this.handleFileDelete.bind(this))
        );
    }

    public static getInstance(): CardManager {
        if (!CardManager.instance) {
            CardManager.instance = new CardManager();
        }
        return CardManager.instance;
    }

    /**
     * Initialize the card manager by loading all cards from the workspace
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const results = await MdParser.parseWorkspace();
        for (const [uri, cards] of results) {
            this.cardsByFile.set(uri.toString(), cards);
            this._onDidUpdateCards.fire({
                type: 'add',
                uri,
                cards
            });
        }

        this.initialized = true;
    }

    /**
     * Get all cards from a specific file
     * @param uri The URI of the file
     * @returns Array of MdCards from the file, or undefined if file not found
     */
    public getCardsFromFile(uri: vscode.Uri): MdCard[] | undefined {
        return this.cardsByFile.get(uri.toString());
    }

    /**
     * Get all cards across all files
     * @returns Array of all MdCards
     */
    public getAllCards(): MdCard[] {
        const allCards: MdCard[] = [];
        for (const cards of this.cardsByFile.values()) {
            allCards.push(...cards);
        }
        return allCards;
    }

    /**
     * Get all files that contain cards
     * @returns Array of file URIs
     */
    public getFilesWithCards(): vscode.Uri[] {
        return Array.from(this.cardsByFile.keys()).map(uri => vscode.Uri.parse(uri));
    }

    /**
     * Handle file changes by re-parsing the file
     */
    private async handleFileChange(uri: vscode.Uri): Promise<void> {
        try {
            const existingCards = this.cardsByFile.get(uri.toString());
            const cards = await MdParser.parseFile(uri);

            if (cards.length > 0) {
                this.cardsByFile.set(uri.toString(), cards);
                this._onDidUpdateCards.fire({
                    type: existingCards ? 'update' : 'add',
                    uri,
                    cards
                });
            } else if (existingCards) {
                // If there were cards before but now there aren't any,
                // treat it as a deletion
                this.cardsByFile.delete(uri.toString());
                this._onDidUpdateCards.fire({
                    type: 'delete',
                    uri
                });
            }
        } catch (error) {
            console.error(`Failed to handle file change: ${uri.fsPath}`, error);
            // If we fail to parse the file but it had cards before,
            // we should remove the cards and notify listeners
            if (this.cardsByFile.has(uri.toString())) {
                this.cardsByFile.delete(uri.toString());
                this._onDidUpdateCards.fire({
                    type: 'delete',
                    uri
                });
            }
        }
    }

    /**
     * Handle file deletions by removing the file's cards
     */
    private handleFileDelete(uri: vscode.Uri): void {
        if (this.cardsByFile.has(uri.toString())) {
            this.cardsByFile.delete(uri.toString());
            this._onDidUpdateCards.fire({
                type: 'delete',
                uri
            });
        }
    }

    /**
     * Dispose of the card manager and its resources
     */
    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.cardsByFile.clear();
        this.initialized = false;
        CardManager.instance = undefined!;
    }
} 