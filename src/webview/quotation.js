const vscode = acquireVsCodeApi();
const mathCache = new Map();

// Listen for messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'get-selection':
            handleGetSelection();
            break;
    }
});

function resolveUrl(url) {
    try {
        // Try to create a full URL - if it succeeds, it's already absolute
        new URL(url);
        return url;
    } catch {
        // If it fails, it's relative - resolve against the page base URL
        return new URL(url, window.pageBaseUrl).toString();
    }
}

/// Find the math expression in the page.  
/// Returns null or the math expression as a string. Does not have delimiters.
function MathJax3ExtractMath(element) {
    if (mathCache.size === 0) {
        buildMathCache();
    }

    const counter = element.getAttribute('ctxtmenu_counter');
    if (counter && mathCache.has(counter)) {
        return mathCache.get(counter);
    }

    // Fallback to innerHTML comparison if counter lookup fails
    const list = window.MathJax.startup.document.math.list;
    let current = list;
    const start = list;

    do {
        if (typeof current.data !== 'symbol' &&
            current.data?.typesetRoot?.innerHTML === element.innerHTML) {
            return current.data.math;
        }
        current = current.next;
    } while (current !== start);

    return null;
}

function buildMathCache() {
    if (!window.MathJax?.startup?.document?.math?.list) {
        return;
    }

    const list = window.MathJax.startup.document.math.list;
    let current = list;
    const start = list;

    do {
        if (typeof current.data !== 'symbol' && current.data?.typesetRoot) {
            const counter = current.data.typesetRoot.getAttribute('ctxtmenu_counter');
            if (counter) {
                mathCache.set(counter, current.data.math);
            }
        }
        current = current.next;
    } while (current !== start);
}

function handleGetSelection() {
    const selection = document.getSelection();
    if (!selection) {
        vscode.postMessage({
            type: 'selection',
            markdown: ''
        });
        return;
    }

    // Get the selected range
    const range = selection.getRangeAt(0);
    const fragment = range.cloneContents();

    const markdown = convertToMarkdown(fragment).trim();
    vscode.postMessage({
        type: 'selection',
        markdown
    });
}

function convertToMarkdown(node, result = '', options = { inParagraph: false }) {
    if (node.nodeType === Node.TEXT_NODE) {
        // Only normalize newlines/tabs to spaces, preserve existing spaces
        let text = node.textContent.replace(/[\n\r\t]/g, ' ');

        // Only collapse multiple spaces, don't trim
        text = text.replace(/ {2,}/g, ' ');

        return result + text;
    }

    for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            const element = child;

            // Check for MathJax container first
            if (element.tagName.toLowerCase() === 'mjx-container') {
                const math = MathJax3ExtractMath(element);
                if (math !== null) {
                    result += `$${math}$`;
                    continue;
                }
            }

            switch (element.tagName.toLowerCase()) {
                case 'a':
                    const href = element.getAttribute('href');
                    const resolvedHref = resolveUrl(href);
                    // Don't trim the link text to preserve spaces
                    result += `[${element.textContent}](${resolvedHref})`;
                    break;
                case 'strong':
                case 'b':
                    result += `**${convertToMarkdown(element, '', { inParagraph: options.inParagraph })}**`;
                    break;
                case 'em':
                case 'i':
                    result += `*${convertToMarkdown(element, '', { inParagraph: options.inParagraph })}*`;
                    break;
                case 'p':
                    const paragraphContent = convertToMarkdown(element, '', { inParagraph: true });
                    // Only trim paragraph content at the edges
                    result += paragraphContent.trim() + '\n\n';
                    break;
                default:
                    result += convertToMarkdown(element, '', { inParagraph: options.inParagraph });
            }
        } else {
            result += convertToMarkdown(child, '', { inParagraph: options.inParagraph });
        }
    }
    return result;
} 