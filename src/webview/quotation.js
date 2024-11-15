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

function convertToMarkdown(node, result = '') {
    if (node.nodeType === Node.TEXT_NODE) {
        return result + node.textContent;
    }

    for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            const element = child;

            switch (element.tagName.toLowerCase()) {
                case 'a':
                    const href = element.getAttribute('href');
                    result += `[${element.textContent}](${href})`;
                    break;
                case 'strong':
                case 'b':
                    result += `**${convertToMarkdown(element)}**`;
                    break;
                case 'em':
                case 'i':
                    result += `*${convertToMarkdown(element)}*`;
                    break;
                case 'p':
                    result += `${convertToMarkdown(element)}\n\n`;
                    break;
                default:
                    result += convertToMarkdown(element);
            }
        } else {
            result += convertToMarkdown(child);
        }
    }
    return result;
} 