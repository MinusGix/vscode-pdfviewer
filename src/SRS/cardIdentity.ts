import { MdCard } from './card';


let counter = 0;
/**
 * Generates a stable ID for a card based on its initial content
 * @param card The card to generate an ID for
 * @returns A unique identifier string
 */
export function generateCardId(card: MdCard): string {
    // TODO: Should we use a GUID instead?
    const timestamp = Date.now().toString(36);

    // Increment and reset counter if it gets too large
    counter = (counter + 1) % 1296; // 36^2

    const counterStr = counter.toString(36).padStart(2, '0');

    const randomChar = Math.floor(Math.random() * 36).toString(36);

    return `${timestamp}${counterStr}${randomChar}`;
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