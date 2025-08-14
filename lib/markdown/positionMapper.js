// Position mapping between markdown source and rendered HTML

class PositionMapper {
    constructor() {
        this.sourceToRenderMap = [];
        this.renderToSourceMap = new Map();
    }

    /**
     * Build a mapping between source markdown positions and rendered DOM positions
     * @param {string} markdown - The source markdown text
     * @param {HTMLElement} renderedElement - The rendered HTML element
     */
    buildMapping(markdown, renderedElement) {
        this.sourceToRenderMap = [];
        this.renderToSourceMap.clear();
        
        // Split markdown into lines for easier processing
        const lines = markdown.split('\n');
        
        // Walk through the rendered DOM and build mappings
        const walker = document.createTreeWalker(
            renderedElement,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let currentSourceLine = 0;
        let currentSourceChar = 0;
        let renderedTextOffset = 0;

        // Simple heuristic mapping - this is a basic implementation
        // In production, you'd want to track the actual markdown parsing
        while (walker.nextNode()) {
            const textNode = walker.currentNode;
            const text = textNode.textContent;
            
            // Store mapping for this text node
            const rect = this.getTextNodeRect(textNode);
            if (rect) {
                this.sourceToRenderMap.push({
                    sourceLine: currentSourceLine,
                    sourceChar: currentSourceChar,
                    element: textNode.parentElement,
                    textNode: textNode,
                    rect: rect,
                    offset: renderedTextOffset
                });
            }
            
            renderedTextOffset += text.length;
        }
    }

    /**
     * Get bounding rect for a text node
     */
    getTextNodeRect(textNode) {
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const rects = range.getClientRects();
        if (rects.length > 0) {
            return rects[0];
        }
        return null;
    }

    /**
     * Convert a source position (line, character) to pixel coordinates
     * @param {number} line - Zero-based line number
     * @param {number} character - Zero-based character position
     * @returns {{x: number, y: number, height: number}} Pixel coordinates
     */
    sourceToPixels(line, character) {
        // Get computed styles from the content element
        const contentElement = document.getElementById('content');
        if (!contentElement) {
            return { x: 0, y: 0, height: 20 };
        }
        
        const computedStyle = window.getComputedStyle(contentElement);
        const lineHeight = parseFloat(computedStyle.lineHeight) || 24;
        const fontSize = parseFloat(computedStyle.fontSize) || 14;
        const charWidth = fontSize * 0.6; // Approximate character width
        
        return {
            x: character * charWidth,
            y: line * lineHeight,
            height: lineHeight
        };
    }

    /**
     * Convert pixel coordinates to source position
     * @param {number} x - X coordinate in pixels
     * @param {number} y - Y coordinate in pixels
     * @returns {{line: number, character: number}} Source position
     */
    pixelsToSource(x, y) {
        // Get computed styles from the content element
        const contentElement = document.getElementById('content');
        if (!contentElement) {
            return { line: 0, character: 0 };
        }
        
        const computedStyle = window.getComputedStyle(contentElement);
        const lineHeight = parseFloat(computedStyle.lineHeight) || 24;
        const fontSize = parseFloat(computedStyle.fontSize) || 14;
        const charWidth = fontSize * 0.6; // Approximate character width
        
        return {
            line: Math.max(0, Math.floor(y / lineHeight)),
            character: Math.max(0, Math.floor(x / charWidth))
        };
    }

    /**
     * Get the actual position in the markdown source for a given rendered position
     * This is a more sophisticated version that tries to account for markdown syntax
     */
    getSourcePositionFromRendered(element, offset) {
        // This would need to track how markdown is transformed to HTML
        // For example: "**bold**" in markdown becomes "bold" in rendered text
        // So position 0 in rendered "bold" maps to position 2 in markdown "**bold**"
        
        // For now, return a simple mapping
        return { line: 0, character: offset };
    }
}

// Export for use in live.js
window.PositionMapper = PositionMapper;