// @ts-ignore
const vscode = acquireVsCodeApi();
const content = document.getElementById('content');
const cursor = document.getElementById('cursor');

let currentText = '';
let cursorPosition = { line: 0, character: 0 };

// Handle messages from extension
window.addEventListener('message', event => {
  const message = event.data;
  switch (message.type) {
    case 'update':
      currentText = message.text;
      content.textContent = message.text;
      updateCursorPosition();
      break;
  }
});

// Update cursor position
function updateCursorPosition() {
  const lines = currentText.split('\n');
  let y = 0;
  
  // Calculate Y position based on line
  for (let i = 0; i < cursorPosition.line && i < lines.length; i++) {
    y += getLineHeight();
  }
  
  // Calculate X position based on character
  const currentLine = lines[cursorPosition.line] || '';
  const x = cursorPosition.character * getCharWidth();
  
  cursor.style.left = x + 'px';
  cursor.style.top = y + 'px';
}

function getLineHeight() {
  return 21; // Approximate line height
}

function getCharWidth() {
  return 8.4; // Approximate character width
}

// Handle keyboard input
content.addEventListener('keydown', e => {
  e.preventDefault();
  
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Printable character
    vscode.postMessage({
      command: 'type',
      text: e.key,
      position: cursorPosition
    });
    
    // Update local state
    const lines = currentText.split('\n');
    const currentLine = lines[cursorPosition.line] || '';
    lines[cursorPosition.line] = currentLine.slice(0, cursorPosition.character) + e.key + currentLine.slice(cursorPosition.character);
    currentText = lines.join('\n');
    content.textContent = currentText;
    
    // Move cursor
    cursorPosition.character++;
    updateCursorPosition();
  } else if (e.key === 'Enter') {
    // New line
    vscode.postMessage({
      command: 'type',
      text: '\n',
      position: cursorPosition
    });
    
    // Update local state
    const lines = currentText.split('\n');
    const currentLine = lines[cursorPosition.line] || '';
    lines[cursorPosition.line] = currentLine.slice(0, cursorPosition.character) + '\n' + currentLine.slice(cursorPosition.character);
    currentText = lines.join('\n');
    content.textContent = currentText;
    
    // Move cursor
    cursorPosition.line++;
    cursorPosition.character = 0;
    updateCursorPosition();
  } else if (e.key === 'Backspace') {
    if (cursorPosition.character > 0) {
      // Delete character before cursor
      const lines = currentText.split('\n');
      const currentLine = lines[cursorPosition.line] || '';
      lines[cursorPosition.line] = currentLine.slice(0, cursorPosition.character - 1) + currentLine.slice(cursorPosition.character);
      currentText = lines.join('\n');
      content.textContent = currentText;
      
      cursorPosition.character--;
      updateCursorPosition();
    } else if (cursorPosition.line > 0) {
      // Move to end of previous line
      const lines = currentText.split('\n');
      const prevLine = lines[cursorPosition.line - 1] || '';
      const currentLine = lines[cursorPosition.line] || '';
      
      lines[cursorPosition.line - 1] = prevLine + currentLine;
      lines.splice(cursorPosition.line, 1);
      currentText = lines.join('\n');
      content.textContent = currentText;
      
      cursorPosition.line--;
      cursorPosition.character = prevLine.length;
      updateCursorPosition();
    }
  } else if (e.key === 'ArrowLeft') {
    if (cursorPosition.character > 0) {
      cursorPosition.character--;
    } else if (cursorPosition.line > 0) {
      cursorPosition.line--;
      const lines = currentText.split('\n');
      cursorPosition.character = (lines[cursorPosition.line] || '').length;
    }
    updateCursorPosition();
  } else if (e.key === 'ArrowRight') {
    const lines = currentText.split('\n');
    const currentLine = lines[cursorPosition.line] || '';
    if (cursorPosition.character < currentLine.length) {
      cursorPosition.character++;
    } else if (cursorPosition.line < lines.length - 1) {
      cursorPosition.line++;
      cursorPosition.character = 0;
    }
    updateCursorPosition();
  } else if (e.key === 'ArrowUp') {
    if (cursorPosition.line > 0) {
      cursorPosition.line--;
      const lines = currentText.split('\n');
      const currentLine = lines[cursorPosition.line] || '';
      cursorPosition.character = Math.min(cursorPosition.character, currentLine.length);
    }
    updateCursorPosition();
  } else if (e.key === 'ArrowDown') {
    const lines = currentText.split('\n');
    if (cursorPosition.line < lines.length - 1) {
      cursorPosition.line++;
      const currentLine = lines[cursorPosition.line] || '';
      cursorPosition.character = Math.min(cursorPosition.character, currentLine.length);
    }
    updateCursorPosition();
  }
});

// Handle clicks to position cursor
content.addEventListener('click', e => {
  const rect = content.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  // Convert pixel coordinates to line/character
  const line = Math.floor(y / getLineHeight());
  const character = Math.floor(x / getCharWidth());
  
  cursorPosition = { line, character };
  updateCursorPosition();
  
  vscode.postMessage({
    command: 'click',
    position: cursorPosition
  });
});

// Focus content on load
content.focus();
