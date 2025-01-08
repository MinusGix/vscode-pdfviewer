import * as vscode from 'vscode';
import { MdCard, CardPosition } from './card';
import { MdParser, ParseResult } from './mdParser';
import { ensureCardHasId } from './cardIdentity';

export interface CardUpdateEvent {
    type: 'add' | 'update' | 'delete';
    uri: vscode.Uri;
    cards?: MdCard[];
}

export class CardManager implements vscode.Disposable {
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

        // Watch for workspace folder changes
        const workspaceFoldersChanged = vscode.workspace.onDidChangeWorkspaceFolders(async e => {
            // Reload cards from added folders
            for (const folder of e.added) {
                const results = await MdParser.parseWorkspaceFolder(folder);
                for (const [uri, parseResult] of results) {
                    const cardsWithIds = parseResult.cards.map(card => ensureCardHasId(card));
                    this.cardsByFile.set(uri.toString(), cardsWithIds);
                    this._onDidUpdateCards.fire({
                        type: 'add',
                        uri,
                        cards: cardsWithIds
                    });
                }
            }

            // Remove cards from removed folders
            for (const folder of e.removed) {
                const pattern = new vscode.RelativePattern(folder, '**/*.md');
                const files = await vscode.workspace.findFiles(pattern);
                for (const uri of files) {
                    if (this.cardsByFile.has(uri.toString())) {
                        this.cardsByFile.delete(uri.toString());
                        this._onDidUpdateCards.fire({
                            type: 'delete',
                            uri
                        });
                    }
                }
            }
        });

        this.disposables.push(
            watcher,
            this._onDidUpdateCards,
            workspaceFoldersChanged,
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

        try {
            const results = await MdParser.parseWorkspace();
            for (const [uri, parseResult] of results) {
                const cardsWithIds = parseResult.cards.map(card => ensureCardHasId(card));
                this.cardsByFile.set(uri.toString(), cardsWithIds);
                this._onDidUpdateCards.fire({
                    type: 'add',
                    uri,
                    cards: cardsWithIds
                });
            }
        } catch (error) {
            console.error('Failed to initialize CardManager:', error);
        } finally {
            this.initialized = true;
        }
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
     * Handle file changes by re-parsing the file and adding IDs to cards that don't have them
     */
    private async handleFileChange(uri: vscode.Uri): Promise<void> {
        try {
            const existingCards = this.cardsByFile.get(uri.toString());
            const parseResult = await MdParser.parseFile(uri);
            const { cards, positions } = parseResult;

            if (cards.length > 0) {
                // Process cards in reverse order to avoid position invalidation
                const cardsWithIds = [...cards].reverse().map((card, i) => {
                    const cardWithId = ensureCardHasId(card);
                    if (cardWithId.id !== card.id) {
                        // Card didn't have an ID, so we need to add it to the file
                        const position = positions[positions.length - 1 - i];
                        this.insertCardId(uri, cardWithId.id, position);
                    }
                    return cardWithId;
                }).reverse(); // Restore original order

                this.cardsByFile.set(uri.toString(), cardsWithIds);
                this._onDidUpdateCards.fire({
                    type: existingCards ? 'update' : 'add',
                    uri,
                    cards: cardsWithIds
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
     * Insert an ID field at the start of a card definition
     */
    private async insertCardId(uri: vscode.Uri, id: string | undefined, position: CardPosition): Promise<void> {
        if (!id) return;

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const edit = new vscode.WorkspaceEdit();
            const { line, character } = position.insertPosition;
            const idField = `id: ${id}\n`;

            // Create an edit to insert the ID field at the correct position
            edit.insert(uri, new vscode.Position(line - 1, character), idField);

            // Apply the edit
            await vscode.workspace.applyEdit(edit);
        } catch (error) {
            console.error(`Failed to insert card ID: ${uri.fsPath}`, error);
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