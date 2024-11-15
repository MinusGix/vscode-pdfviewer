const vscode = acquireVsCodeApi();

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
        // For text nodes:
        // 1. Normalize whitespace (convert newlines and multiple spaces to single space)
        // 2. Trim only if we're not in a paragraph (to avoid removing spaces between words)
        let text = node.textContent.replace(/[\n\r\t ]+/g, ' ');
        if (!options.inParagraph) {
            text = text.trim();
        }
        return result + text;
    }

    for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            const element = child;

            switch (element.tagName.toLowerCase()) {
                case 'a':
                    const href = element.getAttribute('href');
                    // Resolve relative URLs against the page base URL
                    const resolvedHref = resolveUrl(href);
                    result += `[${element.textContent.trim()}](${resolvedHref})`;
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
                    const paragraphContent = convertToMarkdown(element, '', { inParagraph: true }).trim();
                    result += paragraphContent + '\n\n';
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