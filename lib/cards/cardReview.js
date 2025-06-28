// Get DOM elements
const frontContent = document.getElementById('front-content');
const backContent = document.getElementById('back-content');
const separator = document.getElementById('separator');
const sourceButton = document.getElementById('source-button');
const showAnswerButton = document.getElementById('show-answer-button');
const buttons = document.getElementById('buttons');

let currentIntervals = {};

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            // Update front content
            frontContent.innerHTML = sanitizeHtml(message.frontContent);

            // Update back content
            backContent.innerHTML = sanitizeHtml(message.backContent);

            // Store intervals for later use
            currentIntervals = message.intervals;

            // Update tag color
            const card = document.querySelector('.card');
            if (message.tagColor) {
                card.style.setProperty('--tag-color', message.tagColor);
            } else {
                card.style.setProperty('--tag-color', 'rgba(255, 255, 255, 0.1)');
            }

            // Show/hide answer section
            backContent.style.display = message.showAnswer ? 'block' : 'none';
            separator.style.display = message.showAnswer ? 'block' : 'none';
            showAnswerButton.style.display = message.showAnswer ? 'none' : 'block';

            // Update source button
            sourceButton.disabled = !message.hasSource;

            // Update rating buttons
            const ratingButtons = ['button-1', 'button-2', 'button-3', 'button-4'];
            ratingButtons.forEach(id => {
                const button = document.getElementById(id);
                button.disabled = !message.enableButtons;

                const interval = document.getElementById(`interval-${id.slice(-1)}`);
                interval.textContent = message.intervals[id.slice(-1)] || '';
            });

            // Typeset math if needed
            typesetMath();
            break;

        case 'focus':
            // Focus the show answer button when requested
            showAnswerButton.focus();
            break;
    }
});

// Handle keyboard shortcuts
document.addEventListener('keydown', event => {
    if (event.target.tagName === 'INPUT') return;

    switch (event.key) {
        case ' ':
            if (!showAnswerButton.disabled && showAnswerButton.style.display !== 'none') {
                showAnswer();
                event.preventDefault();
            }
            break;
        case '1':
        case '2':
        case '3':
        case '4':
            const button = document.getElementById(`button-${event.key}`);
            if (!button.disabled) {
                rate(parseInt(event.key));
                event.preventDefault();
            }
            break;
    }
});

function showAnswer() {
    // Show the answer section
    backContent.style.display = 'block';
    separator.style.display = 'block';
    showAnswerButton.style.display = 'none';

    // Enable rating buttons and show intervals
    const ratingButtons = ['button-1', 'button-2', 'button-3', 'button-4'];
    ratingButtons.forEach(id => {
        const button = document.getElementById(id);
        button.disabled = false;

        const interval = document.getElementById(`interval-${id.slice(-1)}`);
        interval.textContent = currentIntervals[id.slice(-1)] || '';
    });

    // Typeset math in the answer if needed
    typesetMath();
}

function rate(rating) {
    vscode.postMessage({ type: 'rate', rating });
}

function jumpToSource() {
    vscode.postMessage({ type: 'jumpToSource' });
} 