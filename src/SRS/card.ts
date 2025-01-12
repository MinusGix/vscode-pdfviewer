/**
 * Definition of a card defined in a markdown file. Used for the parsing results, and potentially outputting back to markdown.
 */
export interface MdCard {
    id?: string;      // Unique identifier for the card
    front: string;
    back: string;
    tags: string[];
    type: 'basic' | 'problem' | 'derivation' | string;
    title?: string;
    steps?: boolean;
    difficulty?: 'easy' | 'medium' | 'hard';
    extraFields?: Record<string, string>;
    // Source information
    sourceFile?: string;    // Path to the source file
    sourceLine?: number;    // Line number in the source file where the card starts
}

/**
 * Represents the position of a field in the markdown file
 */
export interface FieldPosition {
    // The line number where the field starts (1-indexed)
    startLine: number;
    // The character offset where the field starts (0-indexed)
    startCharacter: number;
    // The line number where the field ends (1-indexed)
    endLine: number;
    // The character offset where the field ends (0-indexed)
    endCharacter: number;
    // The value of the field
    value: string;
}

/**
 * Represents the positions of all fields in a card definition
 */
export interface CardPosition {
    // The position of the entire card block including ::: markers
    cardBlock: FieldPosition;
    // Position right after the opening ::: where new fields can be inserted
    insertPosition: { line: number, character: number };
    // Position right before the closing ::: where new fields can be inserted
    appendPosition: { line: number, character: number };
    // Map of field names to their positions
    fields: Map<string, FieldPosition>;
}

type MdCardKey = keyof MdCard;

function setCardField(card: Partial<MdCard>, field: MdCardKey | string, value: string): void {
    switch (field) {
        case 'front':
        case 'back':
        case 'title':
            (card as any)[field] = value;
            break;
        case 'id':
            card.id = value;
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
 * Parses a markdown card block into a MdCard object and tracks field positions
 * @param content The content between :::card markers
 * @param startLine The line number where the card block starts (1-indexed)
 * @returns MdCard object and position information
 * @throws Error if required fields are missing
 */
export function parseMdCardWithPosition(content: string, startLine: number): { card: MdCard, position: CardPosition } {
    const lines = content.trim().split('\n');
    const card: Partial<MdCard> = {
        type: 'basic',  // Set default type
        tags: []        // Initialize empty tags array
    };

    const position: CardPosition = {
        cardBlock: {
            startLine,
            startCharacter: 0,
            endLine: startLine + lines.length + 1,
            endCharacter: 3, // Length of ":::"
            value: content
        },
        insertPosition: {
            line: startLine + 1,
            character: 0
        },
        appendPosition: {
            line: startLine + lines.length,
            character: 0
        },
        fields: new Map()
    };

    let currentField: MdCardKey | null = null;
    let currentValue: string[] = [];
    let currentFieldStart: { line: number, character: number } | null = null;
    let isMultiline = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        // Skip empty lines
        if (!trimmedLine) continue;

        // Check if this is a new field
        const fieldMatch = trimmedLine.match(/^(\w+):\s*(.*)$/);
        if (fieldMatch) {
            // Save previous field if exists
            if (currentField && currentFieldStart) {
                const fieldValue = currentValue.map(line => line.trim()).join('\n').trim();
                setCardField(card, currentField, fieldValue);
                position.fields.set(currentField, {
                    startLine: startLine + currentFieldStart.line,
                    startCharacter: currentFieldStart.character,
                    endLine: startLine + i - 1,
                    endCharacter: lines[i - 1].length,
                    value: fieldValue
                });
                currentValue = [];
            }

            const field = fieldMatch[1] as MdCardKey;
            currentField = field;
            const value = fieldMatch[2];
            currentFieldStart = { line: i, character: line.indexOf(field) };

            // Start collecting multiline content if there are more lines after this
            // or if the current line is empty
            if (!value.trim()) {
                currentValue = [];
                isMultiline = true;
            } else if (i < lines.length - 1 && !lines[i + 1].match(/^\w+:/) && lines[i + 1].trim()) {
                // There's actual content (not just whitespace) on the next line and it's not a new field
                currentValue = [value];
                isMultiline = true;
            } else {
                // Single line field
                setCardField(card, field, value.trim());
                const valueStart = line.indexOf(':') + 1;
                const trimmedValue = value.trim();
                position.fields.set(field, {
                    startLine: startLine + i,
                    startCharacter: currentFieldStart.character,
                    endLine: startLine + i,
                    endCharacter: valueStart + value.length - (value.length - trimmedValue.length),
                    value: trimmedValue
                });
                currentField = null;
                currentFieldStart = null;
                isMultiline = false;
            }
        } else if (currentField && currentFieldStart) {
            // This is a continuation of a multiline value
            currentValue.push(line);
        }
    }

    // Save the last field if exists
    if (currentField && currentFieldStart) {
        const fieldValue = currentValue.map(line => line.trim()).join('\n').trim();
        setCardField(card, currentField, fieldValue);
        position.fields.set(currentField, {
            startLine: startLine + currentFieldStart.line,
            startCharacter: currentFieldStart.character,
            endLine: startLine + lines.length - 1,
            endCharacter: lines[lines.length - 1].length,
            value: fieldValue
        });
    }

    // Validate required fields
    if (!card.front || !card.back) {
        throw new Error('Card must have both front and back content');
    }

    return { card: card as MdCard, position };
}

/**
 * Extracts card blocks from markdown content with their positions
 * @param mdContent The full markdown content
 * @returns Array of MdCard objects with their positions
 */
export function extractMdCardsWithPosition(mdContent: string, sourceFile?: string): Array<{ card: MdCard, position: CardPosition }> {
    const cardRegex = /:::card\n([\s\S]*?):::/g;
    const cards: Array<{ card: MdCard, position: CardPosition }> = [];
    const lines = mdContent.split('\n');

    let match;
    while ((match = cardRegex.exec(mdContent)) !== null) {
        try {
            // Calculate the line number where this card starts
            const precedingContent = mdContent.substring(0, match.index);
            const startLine = precedingContent.split('\n').length;

            const result = parseMdCardWithPosition(match[1], startLine);

            // Add source information
            if (sourceFile) {
                result.card.sourceFile = sourceFile;
                result.card.sourceLine = startLine;
            }

            cards.push(result);
        } catch (error) {
            // Silently skip invalid cards
        }
    }

    return cards;
}

// Keep the original functions for backward compatibility
export function parseMdCard(content: string): MdCard {
    return parseMdCardWithPosition(content, 1).card;
}

export function extractMdCards(mdContent: string, sourceFile?: string): MdCard[] {
    return extractMdCardsWithPosition(mdContent, sourceFile).map(result => result.card);
}
