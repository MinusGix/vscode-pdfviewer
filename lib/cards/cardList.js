function changeDueFilter(value) {
    vscode.postMessage({
        type: 'changeDueFilter',
        value: value
    });
}

function toggleAnswer(cardId) {
    vscode.postMessage({
        type: 'toggleAnswer',
        cardId: cardId
    });
}

function toggleSelect(cardId, index, event) {
    vscode.postMessage({
        type: 'toggleSelect',
        cardId: cardId,
        index: index,
        shift: event.shiftKey
    });
}

function toggleSelectAll() {
    vscode.postMessage({
        type: 'toggleSelectAll'
    });
}

function jumpToSource(cardId) {
    vscode.postMessage({
        type: 'jumpToSource',
        cardId: cardId
    });
}

function changeSort(value) {
    vscode.postMessage({
        type: 'changeSort',
        value: value
    });
}

// Handle keyboard shortcuts
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        vscode.postMessage({
            type: 'toggleSelectAll'
        });
    }
});

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            // First sanitize all the content
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = message.content;
            tempDiv.querySelectorAll('.front-content, .back-content').forEach(element => {
                element.innerHTML = sanitizeHtml(element.innerHTML);
            });

            // Then insert the sanitized content
            document.getElementById('cards').innerHTML = tempDiv.innerHTML;

            document.getElementById('due-filter').value = message.filters.showOnlyDue;
            document.querySelector('input[name="sort"][value="' + message.filters.sortBy + '"]').checked = true;

            // Typeset the math after updating content
            typesetMath();
            break;
    }
}); 