import { MdCard } from './card';
import { nanoid } from 'nanoid';

/**
 * Generates a stable ID for a card based on its initial content
 * @param card The card to generate an ID for
 * @returns A unique identifier string
 */
export function generateCardId(card: MdCard): string {
    return nanoid();
}

/**
 * Validates if a card ID follows the expected format
 */
export function isValidCardId(id: string): boolean {
    return /^card_[0-9a-f]{8}_[0-9a-z]+$/.test(id);
}

/**
 * Determines if two cards are the same based on their IDs
 */
export function isSameCard(card1: MdCard, card2: MdCard): boolean {
    return card1.id === card2.id;
}

/**
 * Ensures a card has an ID, generating one if needed
 * @returns A new card object with an ID (same object if ID already exists)
 */
export function ensureCardHasId(card: MdCard): MdCard {
    if (!card.id) {
        return {
            ...card,
            id: generateCardId(card)
        };
    }
    return card;
}

/**
 * Updates a card's content while preserving its identity
 * @param oldCard The existing card
 * @param newContent The new card content (without ID)
 * @returns A new card with updated content but preserved ID
 */
export function updateCardContent(oldCard: MdCard, newContent: Omit<MdCard, 'id'>): MdCard {
    return {
        ...newContent,
        id: oldCard.id
    };
} 