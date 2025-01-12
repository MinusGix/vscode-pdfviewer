import * as vscode from 'vscode';
import * as fs from 'fs';

export function getStyles(extensionRoot: vscode.Uri, view: 'cardList' | 'cardReview'): string {
    const sharedStylesPath = vscode.Uri.joinPath(extensionRoot, 'lib', 'cards', 'styles.css');
    const viewStylesPath = vscode.Uri.joinPath(extensionRoot, 'lib', 'cards', `${view}.css`);

    const sharedStyles = fs.readFileSync(sharedStylesPath.fsPath, 'utf8');
    const viewStyles = fs.readFileSync(viewStylesPath.fsPath, 'utf8');

    return sharedStyles + '\n' + viewStyles;
}

export const mathJaxConfig = `
    MathJax = {
        tex: {
            inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
            displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
            processEscapes: true,
        },
        svg: {
            fontCache: 'global'
        },
        options: {
            skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre']
        }
    };
`; 