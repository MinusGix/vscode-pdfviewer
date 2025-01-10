import { Card as FSRSCard, createEmptyCard, FSRS } from 'ts-fsrs';
import { workspace, Uri, window } from 'vscode';
import { MdCard } from './card';
import * as path from 'path';
import * as fs from 'fs';

interface StoredCardState {
    cardId: string;
    fsrsCard: FSRSCard;
    lastReviewDate?: string;
    deleted?: boolean;
}

export class CardReviewState {
    private states: Map<string, StoredCardState> = new Map();
    private fsrs: FSRS;
    private readonly storageFile: string;

    constructor(workspaceRoot: string) {
        this.fsrs = new FSRS({});
        this.storageFile = path.join(workspaceRoot, '.vscode', 'lattice.cards.json');
        this.loadState();
    }

    private async loadState() {
        try {
            // Ensure .vscode directory exists
            const vscodePath = path.dirname(this.storageFile);
            if (!fs.existsSync(vscodePath)) {
                fs.mkdirSync(vscodePath, { recursive: true });
            }

            if (fs.existsSync(this.storageFile)) {
                const data = fs.readFileSync(this.storageFile, 'utf8');
                const storedStates: StoredCardState[] = JSON.parse(data);

                for (const state of storedStates) {
                    if (!state.cardId) continue; // Skip invalid states

                    // Reconstruct Date objects from stored strings
                    const fsrsCard = state.fsrsCard;
                    if (fsrsCard) {
                        fsrsCard.due = new Date(fsrsCard.due);
                        if (fsrsCard.last_review) {
                            fsrsCard.last_review = new Date(fsrsCard.last_review);
                        }
                        this.states.set(state.cardId, state);
                    }
                }
            }
        } catch (error) {
            window.showErrorMessage(`Failed to load card states: ${error instanceof Error ? error.message : 'Unknown error'}`);
            // Initialize with empty state if loading fails
            this.states = new Map();
        }
    }

    private async saveState() {
        try {
            const storedStates: StoredCardState[] = Array.from(this.states.values());
            fs.writeFileSync(this.storageFile, JSON.stringify(storedStates, null, 2));
        } catch (error) {
            const errorMessage = `Failed to save card states: ${error instanceof Error ? error.message : 'Unknown error'}`;
            window.showErrorMessage(errorMessage);
            throw new Error(errorMessage);
        }
    }

    public getOrCreateState(card: MdCard): FSRSCard {
        if (!card.id) {
            throw new Error('Card must have an ID');
        }

        const existingState = this.states.get(card.id);
        if (existingState) {
            if (existingState.deleted) {
                // If the card was previously deleted, restore it
                delete existingState.deleted;
                this.saveState().catch(error => {
                    window.showWarningMessage(`Failed to save state after restoring card: ${error instanceof Error ? error.message : 'Unknown error'}`);
                });
            }
            return existingState.fsrsCard;
        }

        const now = new Date();
        const newFsrsCard = createEmptyCard(now);
        this.states.set(card.id, { cardId: card.id, fsrsCard: newFsrsCard });
        this.saveState().catch(error => {
            window.showWarningMessage(`Failed to save state after creating new card: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
        return newFsrsCard;
    }

    public updateState(cardId: string, newState: FSRSCard) {
        const existingState = this.states.get(cardId);
        if (existingState) {
            existingState.fsrsCard = newState;
            existingState.lastReviewDate = new Date().toISOString();
            this.saveState().catch(error => {
                window.showWarningMessage(`Failed to save state after updating card: ${error instanceof Error ? error.message : 'Unknown error'}`);
            });
        }
    }

    public getFSRS(): FSRS {
        return this.fsrs;
    }

    public getDueCards(now: Date = new Date()): string[] {
        return Array.from(this.states.entries())
            .filter(([_, state]) => !state.deleted && state.fsrsCard.due <= now)
            .map(([cardId, _]) => cardId);
    }

    public markCardAsDeleted(cardId: string) {
        const state = this.states.get(cardId);
        if (state) {
            state.deleted = true;
            this.saveState().catch(error => {
                window.showWarningMessage(`Failed to save state after marking card as deleted: ${error instanceof Error ? error.message : 'Unknown error'}`);
            });
        }
    }

    public isCardDeleted(cardId: string): boolean {
        const state = this.states.get(cardId);
        return state?.deleted ?? false;
    }
} 