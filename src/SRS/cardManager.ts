import * as vscode from 'vscode';
import { MdCard, CardPosition } from './card';
import { MdParser, ParseResult } from './mdParser';
import { ensureCardHasId, generateCardId } from './cardIdentity';
import { CardReviewState } from './cardReviewState';
import { Card as FSRSCard, FSRS } from 'ts-fsrs';

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
    private reviewState: CardReviewState;

    private constructor() {
        this.cardsByFile = new Map();
        this.disposables = [];
        this.initialized = false;

        // Initialize review state with workspace root
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            throw new Error('No workspace folder found');
        }
        this.reviewState = new CardReviewState(workspaceRoot);

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
                    if (!card.id) {
                        // Card doesn't have an ID, so we need to add it
                        const cardWithId = ensureCardHasId(card);
                        const position = positions[positions.length - 1 - i];
                        this.insertCardId(uri, cardWithId.id, position);
                        return cardWithId;
                    }
                    return card;
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
            // Get the cards that are being deleted
            const deletedCards = this.cardsByFile.get(uri.toString());

            // Mark their review states as deleted
            if (deletedCards) {
                for (const card of deletedCards) {
                    if (card.id) {
                        this.reviewState.markCardAsDeleted(card.id);
                    }
                }
            }

            this.cardsByFile.delete(uri.toString());
            this._onDidUpdateCards.fire({
                type: 'delete',
                uri
            });
        }
    }

    /**
     * Insert a card template at the current cursor position
     * @param withId Whether to include an ID field in the template
     */
    public async insertCardTemplateTesting(withId: boolean = true): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active text editor');
            return;
        }

        const cardId = withId ? generateCardId({ front: 'New Card', back: '', tags: [], type: 'basic' }) : undefined;
        const template = `:::card
${cardId ? `id: ${cardId}\n` : ''}type: basic
front: |
    Enter the front content here
back: |
    Enter the back content here
tags: tag1, tag2
difficulty: medium
:::

`;

        const position = editor.selection.active;
        const line = editor.document.lineAt(position.line);

        await editor.edit(editBuilder => {
            if (line.text.trim().length > 0) {
                // If the current line has content, insert on the next line
                editBuilder.insert(position, '\n' + template);
            } else {
                // If the current line is empty, insert at current position
                editBuilder.insert(position, template);
            }
        });

        // Move cursor to the front content line
        const newPosition = new vscode.Position(
            position.line + (line.text.trim().length > 0 ? 4 : 3) + (withId ? 1 : 0),
            4
        );
        editor.selection = new vscode.Selection(newPosition, newPosition);
    }

    /**
     * Get the review state for a card
     * @param card The card to get the review state for
     * @returns The FSRS card state
     */
    public getCardReviewState(card: MdCard): FSRSCard {
        return this.reviewState.getOrCreateState(card);
    }

    /**
     * Update the review state for a card
     * @param cardId The ID of the card
     * @param newState The new FSRS card state
     */
    public updateCardReviewState(cardId: string, newState: FSRSCard): void {
        this.reviewState.updateState(cardId, newState);
    }

    /**
     * Get all cards that are due for review
     * @param now Optional date to check against (defaults to current time)
     * @returns Array of card IDs that are due for review
     */
    public getDueCards(now?: Date): MdCard[] {
        const dueCardIds = this.reviewState.getDueCards(now);
        return this.getAllCards().filter(card => card.id && dueCardIds.includes(card.id));
    }

    /**
     * Get the FSRS scheduler instance
     */
    public getFSRS(): FSRS {
        return this.reviewState.getFSRS();
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