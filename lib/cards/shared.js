const vscode = acquireVsCodeApi();

// Configure DOMPurify to allow MathJax and other safe elements
const purifyConfig = {
    ADD_TAGS: ['mjx-container', 'svg', 'path', 'br', 'hr', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'p', 'blockquote', 'code', 'pre'],
    ADD_ATTR: ['xmlns', 'viewbox', 'd', 'style', 'class', 'display', 'data-shortcut'],
    USE_PROFILES: { mathMl: true }
};

function sanitizeHtml(html) {
    return DOMPurify.sanitize(html, purifyConfig);
}

function typesetMath() {
    if (window.MathJax) {
        MathJax.typesetPromise().catch((err) => console.error('MathJax error:', err));
    }
} 