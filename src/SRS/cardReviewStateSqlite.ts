/**
 * CardReviewStateSqlite - SQLite-backed FSRS card state management
 *
 * Replaces the JSON-based CardReviewState with SQLite storage.
 */

import {
  Card as FSRSCard,
  createEmptyCard,
  FSRS,
  generatorParameters,
  default_request_retention,
} from 'ts-fsrs';
import { workspace, window } from 'vscode';
import { MdCard } from './card';
import { LatticeDatabase } from '../database';

/**
 * CardReviewStateSqlite manages FSRS review state using the unified SQLite database
 */
export class CardReviewStateSqlite {
  private fsrs: FSRS;
  private db: LatticeDatabase | null = null;
  private cache: Map<string, FSRSCard> = new Map();

  constructor() {
    const params = generatorParameters({
      request_retention: Math.min(
        Math.max(
          workspace
            .getConfiguration('lattice.cards')
            .get('fsrsRequestRetention', default_request_retention),
          0.0
        ),
        1.0
      ),
    });
    this.fsrs = new FSRS(params);
  }

  /**
   * Initialize the database connection
   */
  public async initialize(): Promise<void> {
    if (!this.db) {
      this.db = await LatticeDatabase.getInstance();
      this.loadCache();
    }
  }

  /**
   * Load all cards into cache for fast access
   */
  private loadCache(): void {
    if (!this.db) return;

    const cards = this.db.query<{
      id: string;
      fsrs_state: string;
      deleted: number;
    }>('SELECT id, fsrs_state, deleted FROM cards WHERE deleted = 0');

    for (const card of cards) {
      if (card.fsrs_state) {
        try {
          const fsrsCard = JSON.parse(card.fsrs_state) as FSRSCard;
          // Reconstruct Date objects
          fsrsCard.due = new Date(fsrsCard.due);
          if (fsrsCard.last_review) {
            fsrsCard.last_review = new Date(fsrsCard.last_review);
          }
          this.cache.set(card.id, fsrsCard);
        } catch (e) {
          console.error(`Failed to parse FSRS state for card ${card.id}:`, e);
        }
      }
    }
  }

  /**
   * Get or create FSRS state for a card
   */
  public getOrCreateState(card: MdCard): FSRSCard {
    if (!card.id) {
      throw new Error('Card must have an ID');
    }

    // Check cache first
    const cached = this.cache.get(card.id);
    if (cached) {
      return cached;
    }

    // Check database
    if (this.db) {
      const dbCard = this.db.getCard(card.id);
      if (dbCard && dbCard.fsrs_state && !dbCard.deleted) {
        try {
          const fsrsCard = JSON.parse(dbCard.fsrs_state) as FSRSCard;
          fsrsCard.due = new Date(fsrsCard.due);
          if (fsrsCard.last_review) {
            fsrsCard.last_review = new Date(fsrsCard.last_review);
          }
          this.cache.set(card.id, fsrsCard);
          return fsrsCard;
        } catch (e) {
          console.error(`Failed to parse FSRS state for card ${card.id}:`, e);
        }
      }
    }

    // Create new state
    const now = new Date();
    const newFsrsCard = createEmptyCard(now);
    this.cache.set(card.id, newFsrsCard);

    // Persist to database
    if (this.db) {
      try {
        this.db.upsertCard({
          id: card.id,
          file_path: card.sourceFile ?? null,
          fsrs_state: JSON.stringify(newFsrsCard),
          last_review_date: null,
          deleted: 0,
        });
      } catch (error) {
        console.error(`Failed to save new card state for ${card.id}:`, error);
      }
    }

    return newFsrsCard;
  }

  /**
   * Update FSRS state for a card
   */
  public updateState(cardId: string, newState: FSRSCard): void {
    this.cache.set(cardId, newState);

    if (this.db) {
      try {
        this.db.upsertCard({
          id: cardId,
          file_path: null, // Don't update file_path on state update
          fsrs_state: JSON.stringify(newState),
          last_review_date: new Date().toISOString(),
          deleted: 0,
        });
      } catch (error) {
        console.error(`Failed to update card state for ${cardId}:`, error);
        window.showWarningMessage(
          `Failed to save card state: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }

  /**
   * Get the FSRS scheduler instance
   */
  public getFSRS(): FSRS {
    return this.fsrs;
  }

  /**
   * Get all cards that are due for review
   */
  public getDueCards(now: Date = new Date()): string[] {
    const dueCardIds: string[] = [];

    for (const [cardId, fsrsCard] of this.cache.entries()) {
      if (fsrsCard.due <= now) {
        dueCardIds.push(cardId);
      }
    }

    return dueCardIds;
  }

  /**
   * Mark a card as deleted
   */
  public markCardAsDeleted(cardId: string): void {
    this.cache.delete(cardId);

    if (this.db) {
      try {
        this.db.markCardDeleted(cardId);
      } catch (error) {
        console.error(`Failed to mark card as deleted: ${cardId}`, error);
        window.showWarningMessage(
          `Failed to delete card: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }

  /**
   * Check if a card is deleted
   */
  public isCardDeleted(cardId: string): boolean {
    // If in cache, it's not deleted (we remove from cache when deleted)
    if (this.cache.has(cardId)) {
      return false;
    }

    // Check database
    if (this.db) {
      const dbCard = this.db.getCard(cardId);
      return dbCard?.deleted === 1;
    }

    return false;
  }
}

