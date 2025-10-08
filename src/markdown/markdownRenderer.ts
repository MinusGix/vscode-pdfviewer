// Dynamic imports for ESM modules in CommonJS environment
let unified: any;
let remarkParse: any;
let remarkGfm: any;
let remarkMath: any;
let remarkRehype: any;
let rehypeKatex: any;
let rehypeStringify: any;
let visit: any;

// Initialize dynamic imports
async function initializeImports() {
    if (!unified) {
        try {
            const unifiedModule = await import("unified");
            console.log("Unified module:", typeof unifiedModule, Object.keys(unifiedModule));
            unified = unifiedModule.unified;
            console.log("Unified function:", typeof unified);

            const remarkParseModule = await import("remark-parse");
            remarkParse = remarkParseModule.default;

            const remarkGfmModule = await import("remark-gfm");
            remarkGfm = remarkGfmModule.default;

            const remarkMathModule = await import("remark-math");
            remarkMath = remarkMathModule.default;

            const remarkRehypeModule = await import("remark-rehype");
            remarkRehype = remarkRehypeModule.default;

            const rehypeKatexModule = await import("rehype-katex");
            rehypeKatex = rehypeKatexModule.default;

            const rehypeStringifyModule = await import("rehype-stringify");
            rehypeStringify = rehypeStringifyModule.default;

            const visitModule = await import("unist-util-visit");
            visit = visitModule.visit;

            console.log("All imports initialized successfully");
        } catch (error) {
            console.error("Error initializing imports:", error);
            throw error;
        }
    }
}

// Type definitions for compatibility
interface HastRoot {
    type: string;
    children: any[];
}

interface HastElement {
    type: string;
    tagName: string;
    properties?: Record<string, any>;
    children: any[];
    position?: any;
}

type Pos = { start: { offset?: number }, end: { offset?: number } };

// Propagate md source positions into HTML as data-sourcepos="start:end"
function rehypeSourcepos() {
    return (tree: HastRoot) => {
        visit(tree, (node: any) => {
            if (node.type === "element") {
                const p: Pos | undefined = node.position as any;
                const start = p?.start?.offset ?? null;
                const end = p?.end?.offset ?? null;
                if (start !== null && end !== null) {
                    (node as HastElement).properties ||= {};
                    (node as HastElement).properties!["data-sourcepos"] = `${start}:${end}`;
                }
            }
        });
    };
}

// Remark plugin to build detailed character mapping from AST
function remarkCharacterMap() {
    return (tree: any, file: any) => {
        const characterMap: CharacterMapping[] = [];
        let renderOffset = 0;

        // Store the map in the file data for later retrieval
        file.data = file.data || {};
        file.data.characterMap = characterMap;

        // Walk the AST and build character-by-character mapping
        visit(tree, (node: any) => {
            if (!node.position) {
                return;
            }

            const start = node.position.start.offset;
            const end = node.position.end.offset;

            // For text nodes, map each character
            if (node.type === 'text' && node.value) {
                for (let i = 0; i < node.value.length; i++) {
                    characterMap.push({
                        sourceOffset: start + i,
                        renderOffset: renderOffset,
                        inSyntax: false
                    });
                    renderOffset++;
                }
            }

            // For inline code, the backticks are syntax
            if (node.type === 'inlineCode' && node.value) {
                // First backtick (or triple backtick)
                characterMap.push({
                    sourceOffset: start,
                    renderOffset: renderOffset,
                    inSyntax: true
                });

                // The actual code content
                for (let i = 0; i < node.value.length; i++) {
                    characterMap.push({
                        sourceOffset: start + 1 + i,
                        renderOffset: renderOffset,
                        inSyntax: false
                    });
                    renderOffset++;
                }

                // Closing backtick
                characterMap.push({
                    sourceOffset: end - 1,
                    renderOffset: renderOffset,
                    inSyntax: true
                });
            }
        });

        return tree;
    };
}

export interface PositionMapping {
    sourceStart: number;
    sourceEnd: number;
    element: any; // DOM Element
}

export interface CharacterMapping {
    sourceOffset: number;      // Position in source markdown
    renderOffset: number;      // Position in rendered visible text
    inSyntax: boolean;         // True if this is markdown syntax (not visible in render)
}

export interface RenderResult {
    html: string;
    characterMap: CharacterMapping[];
}

export class MarkdownRenderer {
    private processor: any = null;

    /**
     * Render markdown to HTML with source position mapping and character-level mapping
     */
    async render(markdown: string): Promise<RenderResult> {
        try {
            await initializeImports();

            if (!this.processor) {
                this.processor = unified()
                    .use(remarkParse, { position: true })   // mdast nodes carry byte offsets
                    .use(remarkGfm)
                    .use(remarkMath)
                    .use(remarkRehype, { allowDangerousHtml: true, passThrough: [] })
                    .use(rehypeKatex)                       // swap for rehype-mathjax if you prefer
                    .use(rehypeSourcepos)                   // attach data-sourcepos
                    .use(rehypeStringify, { allowDangerousHtml: true });
            }

            const file = await this.processor.process(markdown);
            const html = String(file);

            // Build character-level mapping
            const characterMap = this.buildCharacterMapping(markdown, html);

            return { html, characterMap };
        } catch (error) {
            console.error('Markdown rendering error:', error);
            // Fallback to plain text if rendering fails
            const html = markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // Build trivial 1:1 mapping for fallback
            const characterMap = markdown.split('').map((_, i) => ({
                sourceOffset: i,
                renderOffset: i,
                inSyntax: false
            }));
            return { html, characterMap };
        }
    }

    /**
     * Build an index of elements with their source positions for efficient lookup
     */
    buildPositionIndex(root: any): PositionMapping[] {
        const elements = [...root.querySelectorAll("[data-sourcepos]")];

        return elements.map(el => {
            const [start, end] = el.getAttribute("data-sourcepos")!.split(":").map(Number);
            return {
                sourceStart: start,
                sourceEnd: end,
                element: el
            };
        }).sort((a, b) => a.sourceStart - b.sourceStart);
    }

    /**
     * Find the element at a specific source offset using binary search
     */
    findElementAtOffset(offset: number, index: PositionMapping[]): any | null {
        let lo = 0;
        let hi = index.length - 1;

        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const item = index[mid];

            if (offset < item.sourceStart) {
                hi = mid - 1;
            } else if (offset >= item.sourceEnd) {
                lo = mid + 1;
            } else {
                return item.element;
            }
        }

        return null;
    }

    /**
     * Convert source position (line, character) to byte offset
     */
    positionToOffset(line: number, character: number, text: string): number {
        const lines = text.split('\n');
        let offset = 0;

        for (let i = 0; i < line && i < lines.length; i++) {
            offset += lines[i].length + 1; // +1 for newline character
        }

        const currentLine = lines[line] || '';
        offset += Math.min(character, currentLine.length);

        return offset;
    }

    /**
     * Convert byte offset to source position (line, character)
     */
    offsetToPosition(offset: number, text: string): { line: number; character: number } {
        const lines = text.split('\n');
        let currentOffset = 0;

        for (let line = 0; line < lines.length; line++) {
            const lineLength = lines[line].length;
            if (currentOffset + lineLength >= offset) {
                return {
                    line: line,
                    character: offset - currentOffset
                };
            }
            currentOffset += lineLength + 1; // +1 for newline
        }

        // If offset is beyond the text, return the last position
        return {
            line: lines.length - 1,
            character: lines[lines.length - 1].length
        };
    }

    /**
     * Build detailed character-level mapping between source markdown and rendered text.
     * This creates a more accurate mapping by analyzing markdown patterns.
     */
    private buildCharacterMapping(markdown: string, html: string): CharacterMapping[] {
        const mapping: CharacterMapping[] = [];
        let renderOffset = 0;

        // State tracking for markdown syntax detection
        let i = 0;
        while (i < markdown.length) {
            const char = markdown[i];
            let isSyntax = false;
            let advance = 1; // How many characters to advance

            // Detect various markdown syntax patterns

            // Heading markers: # at start of line
            if (char === '#' && this.isStartOfLine(markdown, i)) {
                // Count consecutive #
                let hashCount = 0;
                let j = i;
                while (j < markdown.length && markdown[j] === '#') {
                    hashCount++;
                    j++;
                }
                // Skip the # characters and any following space
                while (j < markdown.length && markdown[j] === ' ') {
                    j++;
                }
                // Mark all these characters as syntax
                for (let k = i; k < j; k++) {
                    mapping.push({
                        sourceOffset: k,
                        renderOffset: renderOffset,
                        inSyntax: true
                    });
                }
                i = j;
                continue;
            }

            // Bold: ** or __
            if ((char === '*' && markdown[i + 1] === '*') ||
                (char === '_' && markdown[i + 1] === '_')) {
                mapping.push({
                    sourceOffset: i,
                    renderOffset: renderOffset,
                    inSyntax: true
                });
                mapping.push({
                    sourceOffset: i + 1,
                    renderOffset: renderOffset,
                    inSyntax: true
                });
                i += 2;
                continue;
            }

            // Italic: * or _
            if (char === '*' || char === '_') {
                mapping.push({
                    sourceOffset: i,
                    renderOffset: renderOffset,
                    inSyntax: true
                });
                i++;
                continue;
            }

            // Inline code: `
            if (char === '`') {
                // Count consecutive backticks
                let backtickCount = 0;
                let j = i;
                while (j < markdown.length && markdown[j] === '`') {
                    backtickCount++;
                    j++;
                }
                // Mark opening backticks as syntax
                for (let k = i; k < j; k++) {
                    mapping.push({
                        sourceOffset: k,
                        renderOffset: renderOffset,
                        inSyntax: true
                    });
                }
                i = j;
                continue;
            }

            // Links: [text](url) - need to handle the complete pattern
            if (char === '[') {
                // Mark opening bracket as syntax
                mapping.push({
                    sourceOffset: i,
                    renderOffset: renderOffset,
                    inSyntax: true
                });

                // Find the closing bracket
                let j = i + 1;
                let linkTextStart = j;
                while (j < markdown.length && markdown[j] !== ']') {
                    // Link text is actual content
                    mapping.push({
                        sourceOffset: j,
                        renderOffset: renderOffset,
                        inSyntax: false
                    });
                    renderOffset++;
                    j++;
                }

                if (j < markdown.length && markdown[j] === ']') {
                    // Mark closing bracket as syntax
                    mapping.push({
                        sourceOffset: j,
                        renderOffset: renderOffset,
                        inSyntax: true
                    });
                    j++;

                    // Check if followed by ( for URL
                    if (j < markdown.length && markdown[j] === '(') {
                        // Mark ( and everything until ) as syntax
                        while (j < markdown.length && markdown[j] !== ')') {
                            mapping.push({
                                sourceOffset: j,
                                renderOffset: renderOffset,
                                inSyntax: true
                            });
                            j++;
                        }
                        if (j < markdown.length && markdown[j] === ')') {
                            mapping.push({
                                sourceOffset: j,
                                renderOffset: renderOffset,
                                inSyntax: true
                            });
                            j++;
                        }
                    }

                    i = j;
                    continue;
                }
            }

            // List markers: - or + or * at start of line followed by space
            if ((char === '-' || char === '+' || char === '*') &&
                this.isStartOfLine(markdown, i) &&
                i + 1 < markdown.length && markdown[i + 1] === ' ') {
                mapping.push({
                    sourceOffset: i,
                    renderOffset: renderOffset,
                    inSyntax: true
                });
                mapping.push({
                    sourceOffset: i + 1,
                    renderOffset: renderOffset,
                    inSyntax: true
                });
                i += 2;
                continue;
            }

            // Blockquote: > at start of line
            if (char === '>' && this.isStartOfLine(markdown, i)) {
                mapping.push({
                    sourceOffset: i,
                    renderOffset: renderOffset,
                    inSyntax: true
                });
                // Skip following space if any
                if (i + 1 < markdown.length && markdown[i + 1] === ' ') {
                    mapping.push({
                        sourceOffset: i + 1,
                        renderOffset: renderOffset,
                        inSyntax: true
                    });
                    i += 2;
                } else {
                    i++;
                }
                continue;
            }

            // Regular content character
            mapping.push({
                sourceOffset: i,
                renderOffset: renderOffset,
                inSyntax: false
            });
            renderOffset++;
            i++;
        }

        return mapping;
    }

    /**
     * Check if a position is at the start of a line (after newline or at beginning)
     */
    private isStartOfLine(text: string, offset: number): boolean {
        if (offset === 0) {
            return true;
        }
        // Look backward to see if we're at the start of a line
        let i = offset - 1;
        while (i >= 0 && text[i] !== '\n') {
            if (text[i] !== ' ' && text[i] !== '\t') {
                return false; // Non-whitespace before this position
            }
            i--;
        }
        return true; // Only whitespace or newline before this position
    }
}
