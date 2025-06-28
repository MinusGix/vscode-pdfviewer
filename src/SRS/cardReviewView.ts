import * as vscode from 'vscode';
import { MdCard } from './card';
import { CardManager } from './cardManager';
import { Card as FSRSCard, Rating } from 'ts-fsrs';
import { marked } from 'marked';
import { Eye, EyeOff, ExternalLink } from 'lucide-static';
import { getStyles, mathJaxConfig } from './styles';
import fs from 'fs';

// Configure marked to preserve line breaks
marked.setOptions({
    breaks: true,  // This interprets single line breaks as <br>
    gfm: true      // Enable GitHub Flavored Markdown
});

export class CardReviewView {
    public static readonly viewType = 'lattice.cardReview';
    private static instance: CardReviewView;
    private panel: vscode.WebviewPanel;
    private currentCard?: MdCard;

    private constructor(
        private readonly extensionRoot: vscode.Uri,
        private readonly cardManager: CardManager
    ) {
        this.panel = vscode.window.createWebviewPanel(
            CardReviewView.viewType,
            'Card Review',
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

        // Handle panel disposal
        this.panel.onDidDispose(() => {
            CardReviewView.instance = undefined!;
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
            <script>
                ${mathJaxConfig}
            </script>
            <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
            <script src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionRoot, 'lib', 'purify.min.js'))}"></script>
            <style>
                ${getStyles(this.extensionRoot, 'cardReview')}
            </style>
        </head>
        <body>
            ${this.getCardReviewBody()}
            <script src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionRoot, 'lib', 'cards', 'shared.js'))}"></script>
            <script src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionRoot, 'lib', 'cards', 'cardReview.js'))}"></script>
        </body>
        </html>`;
    }

    private getCardReviewBody(): string {
        const bodyPath = vscode.Uri.joinPath(this.extensionRoot, 'lib', 'cards', 'cardReview.html');
        let content = fs.readFileSync(bodyPath.fsPath, 'utf8');

        // Replace icon placeholders with actual icons
        content = content.replace('${ExternalLink}', ExternalLink);
        content = content.replace('${Eye}', Eye);

        return content;
    }

    private getTagColor(tags: string[]): string | undefined {
        const tagColors = vscode.workspace.getConfiguration('lattice.cards').get<Record<string, string>>('tagColors', {});
        // Return the first matching tag's color
        for (const tag of tags) {
            if (tag in tagColors) {
                return tagColors[tag];
            }
        }
        return undefined;
    }

    private async showCard(card: MdCard) {
        this.currentCard = card;

        // Convert markdown to HTML for the front and back of the card
        const frontContent = marked.parse(card.front);
        const backContent = marked.parse(card.back);

        // Get scheduling information
        const intervals: { [key: number]: string } = {};
        if (card.id) {
            const state = this.cardManager.getCardReviewState(card);
            const fsrs = this.cardManager.getFSRS();
            const now = new Date();
            const scheduling = fsrs.repeat(state, now);

            // Update interval information for each button
            for (const item of scheduling) {
                intervals[item.log.rating] = this.formatTimeInterval(item.card.due);
            }
        }

        // Get tag color
        const tagColor = this.getTagColor(card.tags);

        // Update the webview content
        this.panel.webview.postMessage({
            type: 'update',
            frontContent,
            backContent,
            showAnswer: false,
            hasSource: !!(card.sourceFile && card.sourceLine),
            intervals,
            enableButtons: false,
            tagColor
        });
    }

    private async showNextCard() {
        const dueCards = this.cardManager.getDueCards();
        if (dueCards.length > 0) {
            await this.showCard(dueCards[0]);
        } else {
            this.panel.webview.postMessage({
                type: 'update',
                frontContent: 'No more cards due for review!',
                backContent: '',
                showAnswer: false,
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
                frontContent: 'No cards due for review!',
                backContent: '',
                showAnswer: false,
                intervals: {},
                enableButtons: false,
                tagColor: undefined
            });
            return;
        }

        // Convert markdown to HTML for the front and back of the card
        const frontContent = marked.parse(this.currentCard.front);
        const backContent = marked.parse(this.currentCard.back);

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

        // Get tag color
        const tagColor = this.getTagColor(this.currentCard.tags);

        // Update the webview content
        this.panel.webview.postMessage({
            type: 'update',
            frontContent,
            backContent,
            intervals,
            enableButtons: false,
            showAnswer: false,
            tagColor
        });
    }

    private async rateCard(rating: Rating) {
        this.panel.webview.postMessage({
            type: 'rate',
            rating
        });
    }

    public static show(extensionRoot: vscode.Uri, cardManager: CardManager) {
        if (CardReviewView.instance) {
            // If we have an existing instance, just reveal it
            CardReviewView.instance.panel.reveal();
        } else {
            // Otherwise create a new instance
            CardReviewView.instance = new CardReviewView(extensionRoot, cardManager);
        }
    }
} 