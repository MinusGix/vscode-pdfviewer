import * as vscode from 'vscode';
import * as path from 'path';

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
    disabled?: boolean;
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

/**
 * Preserve relative indentation while removing base indentation
 * @param lines Array of lines to process
 * @returns Processed content with relative indentation preserved
 */
function preserveRelativeIndentation(lines: string[]): string {
    if (lines.length === 0) return '';

    // Filter out empty lines for indentation calculation
    const nonEmptyLines = lines.filter(line => line.trim() !== '');
    if (nonEmptyLines.length === 0) return '';

    // Find the minimum indentation (number of leading spaces) among non-empty lines
    let minIndent = Math.min(...nonEmptyLines.map(line => {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }));

    // Remove the base indentation while preserving relative indentation
    const processedLines = lines.map(line => {
        if (line.trim() === '') return ''; // Keep empty lines as empty
        return line.slice(minIndent); // Remove base indentation
    });

    return processedLines.join('\n').trim();
}

/**
 * Look ahead from the current position to see if there's more content that should be part of the current field
 * @param lines All lines
 * @param currentIndex Current line index
 * @returns true if there's more content after empty lines that should be part of this field
 */
function hasMoreFieldContent(lines: string[], currentIndex: number): boolean {
    // Look at lines after the current one
    for (let i = currentIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();

        // If we find a non-empty line
        if (line) {
            // If it's a new field definition, then there's no more content for current field
            if (line.match(/^(\w+):\s*(.*)$/)) {
                return false;
            }
            // Otherwise, there's more content for the current field
            return true;
        }
        // If it's an empty line, continue looking ahead
    }

    // No more content found
    return false;
}

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
        case 'disabled':
            card.disabled = value.toLowerCase() === 'true';
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
        // Skip empty lines only if we're not currently collecting multiline content
        if (!trimmedLine && !currentField) continue;

        // If we have an empty line and we're collecting multiline content, add it
        if (!trimmedLine && currentField) {
            currentValue.push(line);
            continue;
        }

        // Check if this is a new field
        const fieldMatch = trimmedLine.match(/^(\w+):\s*(.*)$/);
        if (fieldMatch) {
            // Save previous field if exists
            if (currentField && currentFieldStart) {
                const fieldValue = preserveRelativeIndentation(currentValue);
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
            } else if (hasMoreFieldContent(lines, i)) {
                // There's more content (possibly after empty lines) that should be part of this field
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
        const fieldValue = preserveRelativeIndentation(currentValue);
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

/**
 * Convert a glob pattern to a regular expression
 * @param pattern The glob pattern to convert
 * @returns A RegExp that matches the pattern
 */
function globToRegExp(pattern: string): RegExp {
    const regExpStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
        .replace(/\*/g, '.*')                  // * matches any characters
        .replace(/\?/g, '.');                  // ? matches single character
    return new RegExp(`^${regExpStr}$`);
}

/**
 * Check if a path matches a glob pattern
 * @param path The path to check
 * @param pattern The glob pattern
 * @returns True if the path matches the pattern
 */
function isMatch(testPath: string, pattern: string): boolean {
    const regex = globToRegExp(pattern);
    return regex.test(testPath);
}

/**
 * Gets all tags for a card, including both explicit and phantom tags
 * @param card The card to get tags for
 * @returns Array of all tags
 */
export function getAllTags(card: MdCard): string[] {
    const allTags = new Set(card.tags);

    // If the card has no source file, just return explicit tags
    if (!card.sourceFile) {
        return Array.from(allTags);
    }

    // Get phantom tag configuration
    const config = vscode.workspace.getConfiguration('lattice.cards');
    const phantomTags = config.get<Record<string, string[]>>('phantomTags', {});

    // Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return Array.from(allTags);
    }

    // Get relative path from workspace root
    const relativePath = path.relative(workspaceRoot, card.sourceFile);

    // Check each pattern and add matching tags
    for (const [pattern, tags] of Object.entries(phantomTags)) {
        if (isMatch(relativePath, pattern)) {
            tags.forEach(tag => allTags.add(tag));
        }
    }

    return Array.from(allTags);
}
