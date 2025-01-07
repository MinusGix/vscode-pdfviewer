/**
 * Definition of a card defined in a markdown file. Used for the parsing results, and potentially outputting back to markdown.
 */
export interface MdCard {
    front: string;
    back: string;
    tags: string[];
    type: 'basic' | 'problem' | 'derivation' | string;
    title?: string;
    steps?: boolean;
    difficulty?: 'easy' | 'medium' | 'hard';
    extraFields?: Record<string, string>;
}

type MdCardKey = keyof MdCard;

function setCardField(card: Partial<MdCard>, field: MdCardKey | string, value: string): void {
    switch (field) {
        case 'front':
        case 'back':
        case 'title':
            (card as any)[field] = value;
            break;
        case 'type':
            card.type = value || 'basic';
            break;
        case 'tags':
            card.tags = value ? value.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
            break;
        case 'steps':
            card.steps = value.toLowerCase() === 'true';
            break;
        case 'difficulty':
            if (value === 'easy' || value === 'medium' || value === 'hard') {
                card.difficulty = value;
            }
            break;
        default:
            // Store unrecognized fields in extraFields
            if (!card.extraFields) {
                card.extraFields = {};
            }
            card.extraFields[field] = value;
    }
}

/**
 * Parses a markdown card block into a MdCard object
 * @param content The content between :::card markers
 * @returns MdCard object
 * @throws Error if required fields are missing
 */
export function parseMdCard(content: string): MdCard {
    const lines = content.trim().split('\n');
    const card: Partial<MdCard> = {
        type: 'basic',  // Set default type
        tags: []        // Initialize empty tags array
    };

    let currentField: MdCardKey | null = null;
    let currentValue: string[] = [];
    let isMultiline = false;

    for (const line of lines) {
        const trimmedLine = line.trim();
        // Skip empty lines
        if (!trimmedLine) continue;

        // Check if this is a new field
        const fieldMatch = trimmedLine.match(/^(\w+):\s*(.*)$/);
        if (fieldMatch) {
            // Save previous field if exists
            if (currentField) {
                const fieldValue = currentValue.map(line => line.trim()).join('\n').trim();
                setCardField(card, currentField, fieldValue);
                currentValue = [];
            }

            const field = fieldMatch[1] as MdCardKey;
            currentField = field;
            const value = fieldMatch[2];

            // If the value starts with |, it's a multiline value
            if (value.trim() === '|') {
                currentValue = [];
                isMultiline = true;
            } else {
                setCardField(card, field, value.trim());
                currentField = null;
                isMultiline = false;
            }
        } else if (currentField) {
            // This is a continuation of a multiline value
            currentValue.push(line.trim());
        }
    }

    // Save the last field if exists
    if (currentField) {
        const fieldValue = currentValue.map(line => line.trim()).join('\n').trim();
        setCardField(card, currentField, fieldValue);
    }

    // Validate required fields
    if (!card.front || !card.back) {
        throw new Error('Card must have both front and back content');
    }

    return card as MdCard;
}

/**
 * Extracts card blocks from markdown content
 * @param mdContent The full markdown content
 * @returns Array of MdCard objects
 */
export function extractMdCards(mdContent: string): MdCard[] {
    const cardRegex = /:::card\n([\s\S]*?):::/g;
    const cards: MdCard[] = [];

    let match;
    while ((match = cardRegex.exec(mdContent)) !== null) {
        try {
            const card = parseMdCard(match[1]);
            cards.push(card);
        } catch (error) {
            // Silently skip invalid cards
        }
    }

    return cards;
}
