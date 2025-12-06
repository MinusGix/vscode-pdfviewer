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

// Remark plugin to build character mapping from AST
function remarkCharacterMap() {
    return (tree: any, file: any) => {
        const markdown = file.value || String(file);
        const characterMap: CharacterMapping[] = [];

        // Initialize all characters as syntax by default
        for (let i = 0; i < markdown.length; i++) {
            characterMap.push({
                sourceOffset: i,
                renderOffset: -1,
                inSyntax: true
            });
        }

        let renderOffset = 0;

        // Walk the AST and mark content characters
        visit(tree, (node: any) => {
            if (!node.position) {
                return;
            }

            const start = node.position.start.offset;
            const end = node.position.end.offset;

            // Text nodes are always rendered content
            if (node.type === 'text' && node.value) {
                for (let i = 0; i < node.value.length; i++) {
                    const offset = start + i;
                    if (offset < characterMap.length) {
                        characterMap[offset] = {
                            sourceOffset: offset,
                            renderOffset: renderOffset,
                            inSyntax: false
                        };
                        renderOffset++;
                    }
                }
            }
            // Inline code: the value is rendered, backticks are not
            else if (node.type === 'inlineCode' && node.value) {
                // Find where the actual code starts (after opening backticks)
                let codeStart = start;
                while (codeStart < end && markdown[codeStart] === '`') {
                    codeStart++;
                }

                // Mark the code content as rendered
                for (let i = 0; i < node.value.length; i++) {
                    const offset = codeStart + i;
                    if (offset < characterMap.length) {
                        characterMap[offset] = {
                            sourceOffset: offset,
                            renderOffset: renderOffset,
                            inSyntax: false
                        };
                        renderOffset++;
                    }
                }
            }
            // Break nodes (hard line breaks) are rendered as newlines
            else if (node.type === 'break') {
                // Line breaks from \\ or two spaces + newline are rendered
                if (start < characterMap.length) {
                    characterMap[start] = {
                        sourceOffset: start,
                        renderOffset: renderOffset,
                        inSyntax: false
                    };
                    renderOffset++;
                }
            }
        });

        // For syntax characters, set renderOffset to the next content position
        for (let i = 0; i < characterMap.length; i++) {
            if (characterMap[i].inSyntax && characterMap[i].renderOffset === -1) {
                // Find the next non-syntax character's renderOffset
                let nextRenderOffset = renderOffset;
                for (let j = i + 1; j < characterMap.length; j++) {
                    if (!characterMap[j].inSyntax) {
                        nextRenderOffset = characterMap[j].renderOffset;
                        break;
                    }
                }
                characterMap[i].renderOffset = nextRenderOffset;
            }
        }

        // Store in file data for retrieval after processing
        file.data = file.data || {};
        file.data.characterMap = characterMap;

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
                    .use(remarkCharacterMap)                // build character mapping from AST
                    .use(remarkRehype, { allowDangerousHtml: true, passThrough: [] })
                    .use(rehypeKatex)                       // swap for rehype-mathjax if you prefer
                    .use(rehypeSourcepos)                   // attach data-sourcepos
                    .use(rehypeStringify, { allowDangerousHtml: true });
            }

            const file = await this.processor.process(markdown);
            const html = String(file);

            // Retrieve character mapping from file data (set by remarkCharacterMap plugin)
            const characterMap = file.data?.characterMap || [];

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
}
