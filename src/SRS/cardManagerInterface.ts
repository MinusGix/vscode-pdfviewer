/**
 * Card Manager Interface - Common interface for JSON and SQLite backends
 */

import * as vscode from 'vscode';
import { MdCard } from './card';
import { Card as FSRSCard, FSRS } from 'ts-fsrs';

export interface CardUpdateEvent {
  type: 'add' | 'update' | 'delete';
  uri: vscode.Uri;
  cards?: MdCard[];
}

/**
 * Interface that both CardManager implementations must satisfy
 */
export interface ICardManager extends vscode.Disposable {
  // Event for card updates
  readonly onDidUpdateCards: vscode.Event<CardUpdateEvent>;

  // Initialization
  initialize(): Promise<void>;

  // Card operations
  getCardsFromFile(uri: vscode.Uri): MdCard[] | undefined;
  getAllCards(): MdCard[];
  getFilesWithCards(): vscode.Uri[];

  // Template operations
  insertCardTemplateTesting(withId?: boolean): Promise<void>;
  disableCurrentFile(): Promise<void>;
  enableCurrentFile(): Promise<void>;

  // Review operations
  getCardReviewState(card: MdCard): FSRSCard;
  updateCardReviewState(cardId: string, newState: FSRSCard): void;
  getDueCards(now?: Date): MdCard[];
  getFSRS(): FSRS;
}

