import * as vscode from 'vscode';
import { MdCard } from './card';
import { CardManager } from './cardManager';
import { Card as FSRSCard, Rating } from 'ts-fsrs';

export class CardReviewView {
    public static readonly viewType = 'lattice.cardReview';
    private panel: vscode.WebviewPanel;
    private currentCard?: MdCard;

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
                    text-align: center;
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
                .content {
                    font-size: 1.2rem;
                    line-height: 1.6;
                    margin: 1rem 0;
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="content" id="content">
                    Loading...
                </div>
            </div>
            <div class="buttons" id="buttons">
                <button class="again" onclick="rate(1)" id="button-1" disabled>
                    <span>Again</span>
                    <span class="interval" id="interval-1"></span>
                </button>
                <button class="hard" onclick="rate(2)" id="button-2" disabled>
                    <span>Hard</span>
                    <span class="interval" id="interval-2"></span>
                </button>
                <button class="good" onclick="rate(3)" id="button-3" disabled>
                    <span>Good</span>
                    <span class="interval" id="interval-3"></span>
                </button>
                <button class="easy" onclick="rate(4)" id="button-4" disabled>
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

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'update':
                            document.getElementById('content').innerHTML = message.content;
                            // Update intervals and button states
                            for (let i = 1; i <= 4; i++) {
                                const button = document.getElementById('button-' + i);
                                const interval = document.getElementById('interval-' + i);
                                interval.textContent = message.intervals[i] || '';
                                button.disabled = !message.enableButtons;
                            }
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }

    private async showNextCard() {
        const dueCards = this.cardManager.getDueCards();

        if (dueCards.length > 0) {
            this.currentCard = dueCards[0];
            const state = this.cardManager.getCardReviewState(this.currentCard);
            const fsrs = this.cardManager.getFSRS();
            const now = new Date();
            const scheduling = fsrs.repeat(state, now);

            // Create intervals map for each rating
            const intervals: { [key: number]: string } = {};
            Array.from(scheduling).forEach(item => {
                intervals[item.log.rating] = this.formatTimeInterval(item.card.due);
            });

            this.panel.webview.postMessage({
                type: 'update',
                content: this.currentCard.front,
                intervals,
                enableButtons: true
            });
        } else {
            this.panel.webview.postMessage({
                type: 'update',
                content: 'No cards due for review!',
                intervals: {},
                enableButtons: false
            });
        }
    }

    public static show(extensionRoot: vscode.Uri, cardManager: CardManager) {
        new CardReviewView(extensionRoot, cardManager);
    }
} 