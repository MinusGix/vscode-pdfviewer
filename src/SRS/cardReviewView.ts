import * as vscode from 'vscode';
import { MdCard } from './card';
import { CardManager } from './cardManager';
import { Card as FSRSCard, Rating } from 'ts-fsrs';
import { marked } from 'marked';

// Configure marked to preserve line breaks
marked.setOptions({
    breaks: true,  // This interprets single line breaks as <br>
    gfm: true      // Enable GitHub Flavored Markdown
});

export class CardReviewView {
    public static readonly viewType = 'lattice.cardReview';
    private panel: vscode.WebviewPanel;
    private currentCard?: MdCard;
    private showingAnswer: boolean = false;

    constructor(
        private readonly extensionRoot: vscode.Uri,
        private readonly cardManager: CardManager
    ) {
        this.panel = vscode.window.createWebviewPanel(
            CardReviewView.viewType,
            'Card Review',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionRoot]
            }
        );

        this.panel.webview.html = this.getWebviewContent();

        // Subscribe to card updates
        this.cardManager.onDidUpdateCards(event => {
            // If we have a current card and it's in the updated file
            if (this.currentCard?.sourceFile && event.uri.fsPath === this.currentCard.sourceFile) {
                // Find the updated version of our current card
                const updatedCards = this.cardManager.getCardsFromFile(event.uri);
                const updatedCard = updatedCards?.find(card => card.id === this.currentCard?.id);

                if (updatedCard) {
                    // Update our current card and refresh the display
                    this.currentCard = updatedCard;
                    this.displayCurrentCard();
                } else if (event.type === 'delete') {
                    // If the card was deleted, move to the next card
                    this.showNextCard();
                }
            }
        });

        // Focus the webview when it's shown
        this.panel.onDidChangeViewState(e => {
            if (e.webviewPanel.visible) {
                this.restoreCardState();
                e.webviewPanel.webview.postMessage({ type: 'focus' });
            }
        });

        // Focus on initial creation
        setTimeout(() => {
            this.panel.webview.postMessage({ type: 'focus' });
        }, 100);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'rate':
                    if (this.currentCard?.id) {
                        console.log(`Rating card ${this.currentCard.id} with ${message.rating}`);
                        const state = this.cardManager.getCardReviewState(this.currentCard);
                        console.log(`Current state before rating: due=${state.due}`);
                        const fsrs = this.cardManager.getFSRS();
                        const now = new Date();
                        const scheduling = fsrs.repeat(state, now);
                        const scheduleItem = Array.from(scheduling).find(item => item.log.rating === message.rating);
                        if (scheduleItem) {
                            console.log(`New state after rating: due=${scheduleItem.card.due}`);
                            this.cardManager.updateCardReviewState(this.currentCard.id, scheduleItem.card);
                        }
                        await this.showNextCard();
                    }
                    break;
                case 'showAnswer':
                    if (this.currentCard && !this.showingAnswer) {
                        await this.showAnswer();
                    }
                    break;
                case 'jumpToSource':
                    if (this.currentCard?.sourceFile && this.currentCard?.sourceLine) {
                        const uri = vscode.Uri.file(this.currentCard.sourceFile);
                        const position = new vscode.Position(this.currentCard.sourceLine - 1, 0);
                        const selection = new vscode.Selection(position, position);

                        // Open the file and reveal the line
                        await vscode.window.showTextDocument(uri, {
                            selection,
                        });
                    }
                    break;
            }
        });

        // Handle visibility changes
        this.panel.onDidChangeViewState(() => {
            if (this.panel.visible) {
                this.restoreCardState();
            }
        });

        // Show first card when view is created
        this.showNextCard();
    }

    private formatTimeInterval(date: Date): string {
        const now = new Date();
        const diffMs = date.getTime() - now.getTime();
        const diffMins = Math.round(diffMs / (1000 * 60));
        const diffHours = Math.round(diffMs / (1000 * 60 * 60));
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        const diffMonths = Math.round(diffMs / (1000 * 60 * 60 * 24 * 30));
        const diffYears = Math.round(diffMs / (1000 * 60 * 60 * 24 * 365));

        if (diffMins < 60) return `${diffMins}m`;
        if (diffHours < 24) return `${diffHours}h`;
        if (diffDays < 30) return `${diffDays}d`;
        if (diffMonths < 12) return `${diffMonths}mo`;
        return `${diffYears}y`;
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Card Review</title>
            <!-- Add MathJax -->
            <script>
                MathJax = {
                    tex: {
                        inlineMath: [['$', '$'], ['\\(', '\\)']],
                        displayMath: [['$$', '$$'], ['\\[', '\\]']],
                        processEscapes: true,
                    },
                    svg: {
                        fontCache: 'global'
                    },
                    options: {
                        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre']
                    }
                };
            </script>
            <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 2rem;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    box-sizing: border-box;
                }
                .card {
                    width: 100%;
                    max-width: 600px;
                    min-height: 300px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 8px;
                    padding: 2rem;
                    margin-bottom: 2rem;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                }
                .source-button {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    color: var(--vscode-textLink-foreground);
                    opacity: 0.7;
                    transition: opacity 0.2s;
                    font-size: 1.2rem;
                    padding: 4px 8px;
                    border-radius: 4px;
                }
                .source-button:hover {
                    opacity: 1;
                    background: var(--vscode-button-hoverBackground);
                }
                .source-button[disabled] {
                    display: none;
                }
                .content {
                    font-size: 1.2rem;
                    line-height: 1.6;
                    margin: 1rem 0;
                    width: 100%;
                }
                /* Markdown styles */
                .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
                    color: var(--vscode-editor-foreground);
                    margin-top: 1em;
                    margin-bottom: 0.5em;
                }
                .content p {
                    margin: 0.5em 0;
                }
                .content ul, .content ol {
                    padding-left: 2em;
                    margin: 0.5em 0;
                }
                .content code {
                    font-family: var(--vscode-editor-font-family);
                    background: var(--vscode-textCodeBlock-background);
                    padding: 0.2em 0.4em;
                    border-radius: 3px;
                }
                .content pre {
                    background: var(--vscode-textCodeBlock-background);
                    padding: 1em;
                    border-radius: 4px;
                    overflow-x: auto;
                }
                .content pre code {
                    background: none;
                    padding: 0;
                }
                .content blockquote {
                    border-left: 4px solid var(--vscode-textBlockQuote-border);
                    margin: 0.5em 0;
                    padding-left: 1em;
                    color: var(--vscode-textBlockQuote-foreground);
                }
                .content img {
                    max-width: 100%;
                    height: auto;
                }
                /* MathJax styles */
                .content .math {
                    overflow-x: auto;
                    max-width: 100%;
                    padding: 0.5em 0;
                }
                .content .math svg {
                    max-width: 100%;
                }
                .buttons {
                    display: flex;
                    gap: 1rem;
                    margin-top: 2rem;
                }
                button {
                    padding: 0.5rem 1rem;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 1rem;
                    min-width: 100px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    position: relative;
                }
                button::after {
                    content: attr(data-shortcut);
                    position: absolute;
                    bottom: -25px;
                    left: 50%;
                    transform: translateX(-50%);
                    font-size: 0.8rem;
                    opacity: 0;
                    transition: opacity 0.2s;
                    background: var(--vscode-editor-background);
                    padding: 2px 6px;
                    border-radius: 3px;
                    white-space: nowrap;
                }
                button:hover::after {
                    opacity: 0.8;
                }
                .interval {
                    font-size: 0.8rem;
                    opacity: 0.7;
                    margin-top: 0.2rem;
                }
                .again { background: var(--vscode-errorForeground); color: white; }
                .hard { background: var(--vscode-editorWarning-foreground); color: white; }
                .good { background: var(--vscode-testing-iconPassed); color: white; }
                .easy { background: var(--vscode-charts-green); color: white; }
                .show-answer { 
                    background: var(--vscode-button-background); 
                    color: var(--vscode-button-foreground);
                    margin-bottom: 1rem;
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                button:disabled::after {
                    display: none;
                }
            </style>
        </head>
        <body>
            <div class="card">
                <button class="source-button" onclick="jumpToSource()" id="source-button" disabled>📄</button>
                <div class="content" id="content">
                    Loading...
                </div>
            </div>
            <button class="show-answer" onclick="showAnswer()" id="show-answer-button" data-shortcut="Space">
                Show Answer
            </button>
            <div class="buttons" id="buttons">
                <button class="again" onclick="rate(1)" id="button-1" disabled data-shortcut="1">
                    <span>Again</span>
                    <span class="interval" id="interval-1"></span>
                </button>
                <button class="hard" onclick="rate(2)" id="button-2" disabled data-shortcut="2">
                    <span>Hard</span>
                    <span class="interval" id="interval-2"></span>
                </button>
                <button class="good" onclick="rate(3)" id="button-3" disabled data-shortcut="3">
                    <span>Good</span>
                    <span class="interval" id="interval-3"></span>
                </button>
                <button class="easy" onclick="rate(4)" id="button-4" disabled data-shortcut="4">
                    <span>Easy</span>
                    <span class="interval" id="interval-4"></span>
                </button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                
                function rate(rating) {
                    vscode.postMessage({
                        type: 'rate',
                        rating: rating
                    });
                }

                function showAnswer() {
                    vscode.postMessage({
                        type: 'showAnswer'
                    });
                }

                function jumpToSource() {
                    vscode.postMessage({
                        type: 'jumpToSource'
                    });
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'update':
                            document.getElementById('content').innerHTML = message.content;
                            // Update source button visibility
                            const sourceButton = document.getElementById('source-button');
                            sourceButton.disabled = !message.hasSource;
                            // Typeset the math after updating content
                            if (window.MathJax) {
                                MathJax.typesetPromise().catch((err) => console.error('MathJax error:', err));
                            }
                            // Update intervals and button states
                            for (let i = 1; i <= 4; i++) {
                                const button = document.getElementById('button-' + i);
                                const interval = document.getElementById('interval-' + i);
                                interval.textContent = message.intervals[i] || '';
                                button.disabled = !message.enableButtons;
                            }
                            // Update show answer button
                            document.getElementById('show-answer-button').style.display = 
                                message.enableButtons ? 'none' : 'block';
                            break;
                        case 'focus':
                            // Focus the webview
                            window.focus();
                            document.body.focus();
                            break;
                    }
                });

                // Handle keyboard shortcuts
                window.addEventListener('keydown', (e) => {
                    if (e.key === ' ' || e.key === 'Space') {
                        e.preventDefault();  // Prevent scrolling
                        const showAnswerButton = document.getElementById('show-answer-button');
                        if (!showAnswerButton.style.display || showAnswerButton.style.display !== 'none') {
                            showAnswer();
                        }
                    } else if (!isNaN(parseInt(e.key)) && parseInt(e.key) >= 1 && parseInt(e.key) <= 4) {
                        const rating = parseInt(e.key);
                        const button = document.getElementById('button-' + rating);
                        if (!button.disabled) {
                            rate(rating);
                        }
                    }
                });
            </script>
        </body>
        </html>`;
    }

    private async showCard(card: MdCard) {
        this.currentCard = card;
        this.showingAnswer = false;

        // Convert markdown to HTML for the front of the card
        const content = marked.parse(card.front);

        // Update the webview content
        this.panel.webview.postMessage({
            type: 'update',
            content,
            hasSource: !!(card.sourceFile && card.sourceLine),
            intervals: {},
            enableButtons: false
        });
    }

    private async showAnswer() {
        if (!this.currentCard) return;

        this.showingAnswer = true;

        // Convert markdown to HTML for both front and back of the card
        const content = marked.parse(this.currentCard.front + '\n\n---\n\n' + this.currentCard.back);

        // Get scheduling information
        const intervals: { [key: number]: string } = {};
        if (this.currentCard.id) {
            const state = this.cardManager.getCardReviewState(this.currentCard);
            const fsrs = this.cardManager.getFSRS();
            const now = new Date();
            const scheduling = fsrs.repeat(state, now);

            // Update interval information for each button
            for (const item of scheduling) {
                intervals[item.log.rating] = this.formatTimeInterval(item.card.due);
            }
        }

        // Update the webview content with all necessary information
        this.panel.webview.postMessage({
            type: 'update',
            content,
            hasSource: !!(this.currentCard.sourceFile && this.currentCard.sourceLine),
            intervals,
            enableButtons: true
        });
    }

    private async showNextCard() {
        const dueCards = this.cardManager.getDueCards();
        if (dueCards.length > 0) {
            await this.showCard(dueCards[0]);
        } else {
            this.panel.webview.postMessage({
                type: 'update',
                content: marked.parse('No more cards due for review!'),
                hasSource: false,
                intervals: {},
                enableButtons: false
            });
        }
    }

    private async restoreCardState() {
        if (this.currentCard) {
            // Check if the current card is still due
            const dueCards = this.cardManager.getDueCards();
            if (!dueCards.some(card => card.id === this.currentCard?.id)) {
                // Current card is no longer due, show next due card
                await this.showNextCard();
                return;
            }
        }
        await this.displayCurrentCard();
    }

    private async displayCurrentCard() {
        if (!this.currentCard) {
            this.panel.webview.postMessage({
                type: 'update',
                content: 'No cards due for review!',
                intervals: {},
                enableButtons: false
            });
            return;
        }

        const state = this.cardManager.getCardReviewState(this.currentCard);
        const fsrs = this.cardManager.getFSRS();
        const now = new Date();
        const scheduling = fsrs.repeat(state, now);

        // Create intervals map for each rating
        const intervals: { [key: number]: string } = {};
        Array.from(scheduling).forEach(item => {
            intervals[item.log.rating] = this.formatTimeInterval(item.card.due);
        });

        // Render markdown content
        const content = this.showingAnswer
            ? `${marked(this.currentCard.front)}\n<hr>\n${marked(this.currentCard.back)}`
            : marked(this.currentCard.front);

        this.panel.webview.postMessage({
            type: 'update',
            content: content,
            intervals,
            enableButtons: this.showingAnswer
        });
    }

    private async rateCard(rating: Rating) {
        this.panel.webview.postMessage({
            type: 'rate',
            rating
        });
    }

    public static show(extensionRoot: vscode.Uri, cardManager: CardManager) {
        new CardReviewView(extensionRoot, cardManager);
    }
} 