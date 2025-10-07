// Dynamic imports for ESM modules in CommonJS environment
let unified: any;
let remarkParse: any;
let remarkGfm: any;
let remarkMath: any;
let remarkRehype: any;
let rehypeKatex: any;
let rehypeStringify: any;
let visit: any;

// Helper to create dynamic import that Parcel won't bundle
const dynamicImport = new Function('specifier', 'return import(specifier)');

// Initialize dynamic imports
async function initializeImports() {
    if (!unified) {
        try {
            const unifiedModule = await dynamicImport("unified");
            console.log("Unified module:", typeof unifiedModule, Object.keys(unifiedModule));
            unified = unifiedModule.unified;
            console.log("Unified function:", typeof unified);

            const remarkParseModule = await dynamicImport("remark-parse");
            remarkParse = remarkParseModule.default;

            const remarkGfmModule = await dynamicImport("remark-gfm");
            remarkGfm = remarkGfmModule.default;

            const remarkMathModule = await dynamicImport("remark-math");
            remarkMath = remarkMathModule.default;

            const remarkRehypeModule = await dynamicImport("remark-rehype");
            remarkRehype = remarkRehypeModule.default;

            const rehypeKatexModule = await dynamicImport("rehype-katex");
            rehypeKatex = rehypeKatexModule.default;

            const rehypeStringifyModule = await dynamicImport("rehype-stringify");
            rehypeStringify = rehypeStringifyModule.default;

            const visitModule = await dynamicImport("unist-util-visit");
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

export interface PositionMapping {
    sourceStart: number;
    sourceEnd: number;
    element: any; // DOM Element
}

export class MarkdownRenderer {
    private processor: any = null;

    /**
     * Render markdown to HTML with source position mapping
     */
    async render(markdown: string): Promise<string> {
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
            return String(file);
        } catch (error) {
            console.error('Markdown rendering error:', error);
            // Fallback to plain text if rendering fails
            return markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
