import * as vscode from 'vscode';
import { MdCard } from './card';
import { CardManager } from './cardManager';
import { marked } from 'marked';
import { Eye, EyeOff, ExternalLink, Square, CheckSquare } from 'lucide-static';
import { getStyles, mathJaxConfig } from './styles';
import * as fs from 'fs';
import { getAllTags } from './card';

// Configure marked to preserve line breaks
marked.setOptions({
    breaks: true,  // This interprets single line breaks as <br>
    gfm: true      // Enable GitHub Flavored Markdown
});

export class CardListView {
    public static readonly viewType = 'lattice.cardList';
    private static instance: CardListView;
    private panel: vscode.WebviewPanel;
    private cards: MdCard[] = [];
    private showingAnswers: Set<string> = new Set();
    private selectedCards: Set<string> = new Set();
    private lastSelectedCardIndex: number | null = null;
    private filters = {
        showOnlyDue: 'all', // 'all' | 'due' | 'not-due'
        sortBy: 'next-review-asc' // 'next-review-asc' | 'next-review-desc' | 'last-review-asc' | 'last-review-desc' | 'source-asc' | 'source-desc'
    };

    private constructor(
        private readonly extensionRoot: vscode.Uri,
        private readonly cardManager: CardManager
    ) {
        this.panel = vscode.window.createWebviewPanel(
            CardListView.viewType,
            'Card List',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionRoot],
                retainContextWhenHidden: true  // Keep the webview's content when hidden
            }
        );

        this.panel.webview.html = this.getWebviewContent();

        // Subscribe to card updates
        this.cardManager.onDidUpdateCards(event => {
            this.refreshCards();
            this.displayCards();
        });

        // Handle visibility changes
        this.panel.onDidChangeViewState(e => {
            if (e.webviewPanel.visible) {
                // Restore state when becoming visible
                this.displayCards();
            }
        });

        // Handle panel disposal
        this.panel.onDidDispose(() => {
            CardListView.instance = undefined!;
        });

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'changeDueFilter':
                    this.filters.showOnlyDue = message.value;
                    this.displayCards();
                    break;
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
                case 'changeSort':
                    this.filters.sortBy = message.value;
                    this.displayCards();
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
            <script>
                ${mathJaxConfig}
            </script>
            <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
            <script src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionRoot, 'lib', 'purify.min.js'))}"></script>
            <style>
                ${getStyles(this.extensionRoot, 'cardList')}
            </style>
        </head>
        <body>
            ${this.getCardListBody()}
            <script src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionRoot, 'lib', 'cards', 'shared.js'))}"></script>
            <script src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionRoot, 'lib', 'cards', 'cardList.js'))}"></script>
        </body>
        </html>`;
    }

    private getCardListBody(): string {
        const bodyPath = vscode.Uri.joinPath(this.extensionRoot, 'lib', 'cards', 'cardList.html');
        let content = fs.readFileSync(bodyPath.fsPath, 'utf8');

        // Replace icon placeholders with actual icons
        content = content.replace(/\${Eye}/g, Eye);
        content = content.replace(/\${EyeOff}/g, EyeOff);
        content = content.replace(/\${ExternalLink}/g, ExternalLink);
        content = content.replace(/\${Square}/g, Square);
        content = content.replace(/\${CheckSquare}/g, CheckSquare);

        return content;
    }

    private refreshCards() {
        this.cards = this.cardManager.getAllCards();
    }

    private getFilteredCards(): MdCard[] {
        let filteredCards = [...this.cards];

        // Apply filters
        if (this.filters.showOnlyDue !== 'all') {
            const dueCards = this.cardManager.getDueCards();
            const dueCardIds = new Set(dueCards.map(card => card.id));
            filteredCards = filteredCards.filter(card => {
                const isDue = card.id && dueCardIds.has(card.id);
                return this.filters.showOnlyDue === 'due' ? isDue : !isDue;
            });
        }

        // Apply sorting
        filteredCards.sort((a, b) => {
            const stateA = a.id ? this.cardManager.getCardReviewState(a) : null;
            const stateB = b.id ? this.cardManager.getCardReviewState(b) : null;

            switch (this.filters.sortBy) {
                case 'next-review-asc':
                    return (stateA?.due?.getTime() ?? 0) - (stateB?.due?.getTime() ?? 0);
                case 'next-review-desc':
                    return (stateB?.due?.getTime() ?? 0) - (stateA?.due?.getTime() ?? 0);
                case 'last-review-asc':
                    return (stateA?.last_review?.getTime() ?? 0) - (stateB?.last_review?.getTime() ?? 0);
                case 'last-review-desc':
                    return (stateB?.last_review?.getTime() ?? 0) - (stateA?.last_review?.getTime() ?? 0);
                case 'source-asc':
                    return (a.sourceFile ?? '').localeCompare(b.sourceFile ?? '');
                case 'source-desc':
                    return (b.sourceFile ?? '').localeCompare(a.sourceFile ?? '');
                default:
                    return 0;
            }
        });

        return filteredCards;
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
        const filteredCards = this.getFilteredCards();
        const content = filteredCards.map((card, index) => {
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

            const allTags = getAllTags(card);
            const tagsDisplay = allTags.length ? ` • ${allTags.join(', ')}` : '';

            return `
            <div class="card${isSelected ? ' selected' : ''}" data-index="${index}">
                <button class="icon-button checkbox-button" onclick="toggleSelect('${card.id}', ${index}, event)" title="Select card">
                    ${isSelected ? CheckSquare : Square}
                </button>
                ${card.sourceFile ? `<button class="icon-button source-button" onclick="jumpToSource('${card.id}')" title="Jump to source">${ExternalLink}</button>` : ''}
                <div class="card-meta">
                    ${card.type}${tagsDisplay}
                </div>
                <div class="content">
                    <div class="front-content">${marked.parse(card.front)}</div>
                    ${showingAnswer ? `
                        <div class="answer">
                            <div class="back-content">${marked.parse(card.back)}</div>
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
            content: content || 'No cards found',
            filters: this.filters
        });
    }

    private handleToggleSelect(cardId: string, index: number, shift: boolean) {
        const filteredCards = this.getFilteredCards();

        if (shift && this.lastSelectedCardIndex !== null && cardId) {
            // Get the range of indices to select from the filtered cards
            const start = Math.min(this.lastSelectedCardIndex, index);
            const end = Math.max(this.lastSelectedCardIndex, index);

            // Select all cards in the range from the filtered list
            for (let i = start; i <= end; i++) {
                const card = filteredCards[i];
                if (card?.id) {
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
        const filteredCards = this.getFilteredCards();
        const filteredCardIds = filteredCards.filter(card => card.id).map(card => card.id!);
        const allSelected = filteredCardIds.every(id => this.selectedCards.has(id));

        if (allSelected) {
            // If all filtered cards are selected, unselect them
            filteredCardIds.forEach(id => this.selectedCards.delete(id));
        } else {
            // Otherwise, select all filtered cards
            filteredCardIds.forEach(id => this.selectedCards.add(id));
        }
        this.displayCards();
    }

    public static show(extensionRoot: vscode.Uri, cardManager: CardManager) {
        if (CardListView.instance) {
            // If we have an existing instance, just reveal it
            CardListView.instance.panel.reveal();
        } else {
            // Otherwise create a new instance
            CardListView.instance = new CardListView(extensionRoot, cardManager);
        }
    }
} 