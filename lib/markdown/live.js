// @ts-ignore
const vscode = acquireVsCodeApi();

const content = document.getElementById('content');
const hiddenEditor = document.getElementById('hidden-editor');
const cursorOverlay = document.getElementById('cursor-overlay');

marked.setOptions({
    breaks: true,
    gfm: true
});

// Store raw markdown text and position mapper
let currentMarkdown = '';
let positionMapper = new PositionMapper();
let currentSelections = [];

window.addEventListener('message', event => {
    const message = event.data;
    console.log('Received message:', message);
    switch (message.type) {
        case 'update':
            currentMarkdown = message.text;
            updateContent(message.text);
            return;
        case 'updateSelection':
            currentSelections = message.selections;
            console.log('Updating selection:', message.selections);
            updateCursorOverlay(message.selections);
            return;
    }
});

function updateContent(text) {
    if (content) {
        // Parse markdown and render
        const html = marked.parse(text);
        content.innerHTML = DOMPurify.sanitize(html);
        
        // Build position mapping after content is rendered
        setTimeout(() => {
            positionMapper.buildMapping(text, content);
            // Update cursor position with current selections
            if (currentSelections.length > 0) {
                updateCursorOverlay(currentSelections);
            }
        }, 10);
        
        // Render MathJax
        // @ts-ignore
        MathJax.typesetPromise([content]).catch(err => console.error('MathJax error:', err));
    }
}

function updateCursorOverlay(selections) {
    if (!cursorOverlay) return;
    
    // Clear existing cursors/selections
    cursorOverlay.innerHTML = '';
    
    selections.forEach((selection, index) => {
        if (selection.start.line === selection.end.line && 
            selection.start.character === selection.end.character) {
            // It's a cursor
            const position = positionMapper.sourceToPixels(selection.start.line, selection.start.character);
            
            const cursor = document.createElement('div');
            cursor.className = 'cursor';
            cursor.style.height = `${position.height}px`;
            cursor.style.left = `${position.x + 16}px`; // Add padding offset
            cursor.style.top = `${position.y + 16}px`; // Add padding offset
            cursorOverlay.appendChild(cursor);
            
            // Debug info
            console.log(`Cursor at line ${selection.start.line}, char ${selection.start.character} -> ${position.x}, ${position.y}`);
        } else {
            // It's a selection - create selection rectangles
            const startPos = positionMapper.sourceToPixels(selection.start.line, selection.start.character);
            const endPos = positionMapper.sourceToPixels(selection.end.line, selection.end.character);
            
            // For now, create a simple rectangle
            const sel = document.createElement('div');
            sel.className = 'selection';
            sel.style.left = `${startPos.x + 16}px`;
            sel.style.top = `${startPos.y + 16}px`;
            sel.style.width = `${Math.max(endPos.x - startPos.x, 10)}px`;
            sel.style.height = `${startPos.height}px`;
            cursorOverlay.appendChild(sel);
        }
    });
}

// Handle keyboard input
content.addEventListener('keydown', e => {
    e.preventDefault(); // Prevent default behavior to maintain control
    
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Printable character - send to extension
        vscode.postMessage({
            command: 'type',
            text: e.key
        });
    } else {
        // Non-printable keys - forward to VS Code
        switch(e.key) {
            case 'Backspace':
            case 'Delete':
            case 'Enter':
            case 'Tab':
            case 'ArrowUp':
            case 'ArrowDown':
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'Home':
            case 'End':
            case 'PageUp':
            case 'PageDown':
                vscode.postMessage({
                    command: 'key',
                    key: e.key,
                    ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey,
                    altKey: e.altKey,
                    metaKey: e.metaKey
                });
                break;
            default:
                // Handle other special key combinations (Ctrl+C, Ctrl+V, etc.)
                if (e.ctrlKey || e.metaKey) {
                    vscode.postMessage({
                        command: 'key',
                        key: e.key,
                        ctrlKey: e.ctrlKey,
                        shiftKey: e.shiftKey,
                        altKey: e.altKey,
                        metaKey: e.metaKey
                    });
                }
                break;
        }
    }
});

// Handle click events to position cursor
content.addEventListener('click', e => {
    // Get click position relative to content
    const rect = content.getBoundingClientRect();
    const x = e.clientX - rect.left - 16; // Subtract padding
    const y = e.clientY - rect.top - 16;  // Subtract padding
    
    // Convert to source position
    const sourcePos = positionMapper.pixelsToSource(x, y);
    
    console.log(`Click at ${x}, ${y} -> line ${sourcePos.line}, char ${sourcePos.character}`);
    
    vscode.postMessage({
        command: 'setPosition',
        line: sourcePos.line,
        character: sourcePos.character
    });
});

// Handle double-click for word selection
content.addEventListener('dblclick', e => {
    e.preventDefault();
    
    const rect = content.getBoundingClientRect();
    const x = e.clientX - rect.left - 16;
    const y = e.clientY - rect.top - 16;
    
    const sourcePos = positionMapper.pixelsToSource(x, y);
    
    vscode.postMessage({
        command: 'selectWord',
        line: sourcePos.line,
        character: sourcePos.character
    });
});

// Handle drag selection
let isMouseDown = false;
let dragStartPos = null;

content.addEventListener('mousedown', e => {
    if (e.button === 0) { // Left mouse button
        isMouseDown = true;
        const rect = content.getBoundingClientRect();
        const x = e.clientX - rect.left - 16;
        const y = e.clientY - rect.top - 16;
        
        dragStartPos = positionMapper.pixelsToSource(x, y);
        e.preventDefault();
    }
});

content.addEventListener('mousemove', e => {
    if (isMouseDown && dragStartPos) {
        const rect = content.getBoundingClientRect();
        const x = e.clientX - rect.left - 16;
        const y = e.clientY - rect.top - 16;
        
        const dragEndPos = positionMapper.pixelsToSource(x, y);
        
        vscode.postMessage({
            command: 'setSelection',
            startLine: dragStartPos.line,
            startCharacter: dragStartPos.character,
            endLine: dragEndPos.line,
            endCharacter: dragEndPos.character
        });
        
        e.preventDefault();
    }
});

content.addEventListener('mouseup', e => {
    if (e.button === 0) { // Left mouse button
        isMouseDown = false;
        dragStartPos = null;
        e.preventDefault();
    }
});

// Handle mouse leave to stop dragging
content.addEventListener('mouseleave', e => {
    isMouseDown = false;
    dragStartPos = null;
});

// Prevent context menu from interfering
content.addEventListener('contextmenu', e => {
    e.preventDefault();
});

// Focus handling
content.addEventListener('focus', () => {
    console.log('Content focused');
});

content.addEventListener('blur', () => {
    console.log('Content blurred');
});

// Focus the content div by default and notify extension we're ready
setTimeout(() => {
    content.focus();
    // Notify extension that webview is ready
    vscode.postMessage({
        command: 'ready'
    });
}, 100);