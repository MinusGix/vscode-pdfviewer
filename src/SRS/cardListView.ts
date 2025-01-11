import * as vscode from 'vscode';
import { MdCard } from './card';
import { CardManager } from './cardManager';
import { marked } from 'marked';
import { Eye, EyeOff, ExternalLink, Square, CheckSquare } from 'lucide-static';
import { sharedStyles, mathJaxConfig } from './styles';

// Configure marked to preserve line breaks
marked.setOptions({
    breaks: true,  // This interprets single line breaks as <br>
    gfm: true      // Enable GitHub Flavored Markdown
});

export class CardListView {
    public static readonly viewType = 'lattice.cardList';
    private panel: vscode.WebviewPanel;
    private cards: MdCard[] = [];
    private showingAnswers: Set<string> = new Set();
    private selectedCards: Set<string> = new Set();
    private lastSelectedCardIndex: number | null = null;

    constructor(
        private readonly extensionRoot: vscode.Uri,
        private readonly cardManager: CardManager
    ) {
        this.panel = vscode.window.createWebviewPanel(
            CardListView.viewType,
            'Card List',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionRoot]
            }
        );

        this.panel.webview.html = this.getWebviewContent();

        // Subscribe to card updates
        this.cardManager.onDidUpdateCards(event => {
            this.refreshCards();
            this.displayCards();
        });

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'toggleAnswer':
                    const cardId = message.cardId;
                    if (this.showingAnswers.has(cardId)) {
                        this.showingAnswers.delete(cardId);
                    } else {
                        this.showingAnswers.add(cardId);
                    }
                    this.displayCards();
                    break;
                case 'toggleSelect':
                    this.handleToggleSelect(message.cardId, message.index, message.shift);
                    break;
                case 'toggleSelectAll':
                    this.handleToggleSelectAll();
                    break;
                case 'jumpToSource':
                    const card = this.cards.find(c => c.id === message.cardId);
                    if (card?.sourceFile && card?.sourceLine) {
                        const uri = vscode.Uri.file(card.sourceFile);
                        const position = new vscode.Position(card.sourceLine - 1, 0);
                        const selection = new vscode.Selection(position, position);

                        // Open the file and reveal the line
                        await vscode.window.showTextDocument(uri, {
                            selection,
                        });
                    }
                    break;
            }
        });

        // Initial load
        this.refreshCards();
        this.displayCards();
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Card List</title>
            <!-- Add MathJax -->
            <script>
                ${mathJaxConfig}
            </script>
            <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
            <style>
                ${sharedStyles}

                /* Card List specific styles */
                body {
                    width: 100%;
                    max-width: 100vw;
                    gap: 2rem;
                }

                #cards {
                    width: 100%;
                    max-width: calc(100vw - 4rem);
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }

                .card {
                    width: 100%;
                    max-width: 100%;
                    padding: 1rem !important;
                    padding-left: 2.5rem !important;
                    box-sizing: border-box;
                }

                .card.selected {
                    border-color: var(--vscode-focusBorder);
                    background: var(--vscode-editor-selectionBackground);
                }

                .toggle-answer {
                    position: absolute;
                    bottom: 10px;
                    left: 10px;
                }

                .content {
                    padding-bottom: 2.5rem;
                }

                .answer {
                    margin-top: 1rem;
                    padding-top: 1rem;
                    border-top: 1px solid var(--vscode-widget-border);
                }

                .card-meta {
                    font-size: 0.9rem;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 0.5rem;
                    padding-right: 2rem;
                }

                .checkbox-button {
                    position: absolute;
                    top: 10px;
                    left: 10px;
                }

                .review-info {
                    position: absolute;
                    bottom: 10px;
                    right: 10px;
                    font-size: 0.8rem;
                    color: var(--vscode-descriptionForeground);
                    opacity: 0.8;
                    display: flex;
                    gap: 1rem;
                }

                .review-info span {
                    white-space: nowrap;
                }
            </style>
        </head>
        <body>
            <div id="cards">
                Loading cards...
            </div>
            <script>
                const vscode = acquireVsCodeApi();

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

                function jumpToSource(cardId) {
                    vscode.postMessage({
                        type: 'jumpToSource',
                        cardId: cardId
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
                            document.getElementById('cards').innerHTML = message.content;
                            // Typeset the math after updating content
                            if (window.MathJax) {
                                MathJax.typesetPromise().catch((err) => console.error('MathJax error:', err));
                            }
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }

    private refreshCards() {
        this.cards = this.cardManager.getAllCards();
    }

    private formatTimeInterval(date: Date, isPast: boolean = false): string {
        const now = new Date();
        const diffMs = isPast ? now.getTime() - date.getTime() : date.getTime() - now.getTime();

        // If it's a future date (next review) and it's already passed, return "now"
        if (!isPast && diffMs <= 0) {
            return "now";
        }

        const diffMins = Math.round(Math.abs(diffMs) / (1000 * 60));
        const diffHours = Math.round(Math.abs(diffMs) / (1000 * 60 * 60));
        const diffDays = Math.round(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
        const diffMonths = Math.round(Math.abs(diffMs) / (1000 * 60 * 60 * 24 * 30));
        const diffYears = Math.round(Math.abs(diffMs) / (1000 * 60 * 60 * 24 * 365));

        if (diffMins < 60) return `${diffMins}m`;
        if (diffHours < 24) return `${diffHours}h`;
        if (diffDays < 30) return `${diffDays}d`;
        if (diffMonths < 12) return `${diffMonths}mo`;
        return `${diffYears}y`;
    }

    private displayCards() {
        const content = this.cards.map((card, index) => {
            const showingAnswer = card.id && this.showingAnswers.has(card.id);
            const isSelected = card.id && this.selectedCards.has(card.id);
            let lastReviewText = '';
            let nextReviewText = '';

            if (card.id) {
                const state = this.cardManager.getCardReviewState(card);
                if (state.last_review) {
                    lastReviewText = this.formatTimeInterval(state.last_review, true);
                }
                nextReviewText = this.formatTimeInterval(state.due);
            }

            return `
            <div class="card${isSelected ? ' selected' : ''}" data-index="${index}">
                <button class="icon-button checkbox-button" onclick="toggleSelect('${card.id}', ${index}, event)" title="Select card">
                    ${isSelected ? CheckSquare : Square}
                </button>
                ${card.sourceFile ? `<button class="icon-button source-button" onclick="jumpToSource('${card.id}')" title="Jump to source">${ExternalLink}</button>` : ''}
                <div class="card-meta">
                    ${card.type}${card.tags.length ? ` • ${card.tags.join(', ')}` : ''}
                </div>
                <div class="content">
                    ${marked.parse(card.front)}
                    ${showingAnswer ? `
                        <div class="answer">
                            ${marked.parse(card.back)}
                        </div>
                    ` : ''}
                </div>
                ${card.id ? `<button class="icon-button toggle-answer" onclick="toggleAnswer('${card.id}')" title="${showingAnswer ? 'Hide Answer' : 'Show Answer'}">
                    ${showingAnswer ? EyeOff : Eye}
                </button>` : ''}
                ${card.id ? `<div class="review-info">
                    ${lastReviewText ? `<span title="Time since last review">↑${lastReviewText}</span>` : ''}
                    ${nextReviewText ? `<span title="Time until next review">↓${nextReviewText}</span>` : ''}
                </div>` : ''}
            </div>`;
        }).join('\n');

        this.panel.webview.postMessage({
            type: 'update',
            content: content || 'No cards found'
        });
    }

    private handleToggleSelect(cardId: string, index: number, shift: boolean) {
        if (shift && this.lastSelectedCardIndex !== null && cardId) {
            // Get the range of indices to select
            const start = Math.min(this.lastSelectedCardIndex, index);
            const end = Math.max(this.lastSelectedCardIndex, index);

            // Select all cards in the range
            for (let i = start; i <= end; i++) {
                const card = this.cards[i];
                if (card.id) {
                    this.selectedCards.add(card.id);
                }
            }
        } else {
            // Normal toggle behavior
            if (this.selectedCards.has(cardId)) {
                this.selectedCards.delete(cardId);
            } else {
                this.selectedCards.add(cardId);
            }
            this.lastSelectedCardIndex = index;
        }
        this.displayCards();
    }

    private handleToggleSelectAll() {
        const allCardIds = this.cards.filter(card => card.id).map(card => card.id!);
        const allSelected = allCardIds.every(id => this.selectedCards.has(id));

        if (allSelected) {
            // If all are selected, unselect all
            this.selectedCards.clear();
        } else {
            // Otherwise, select all
            allCardIds.forEach(id => this.selectedCards.add(id));
        }
        this.displayCards();
    }

    public static show(extensionRoot: vscode.Uri, cardManager: CardManager) {
        new CardListView(extensionRoot, cardManager);
    }
} 