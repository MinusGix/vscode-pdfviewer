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

// Update cursor position using DOM Range API for accuracy
function updateCursorPosition() {
  try {
    const textOffset = getTextOffsetFromPosition(cursorPosition.line, cursorPosition.character);
    const range = document.createRange();

    // Find the text node and offset for the cursor position
    const textNode = content.firstChild; // Since we're using textContent, there's only one text node
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      const maxOffset = Math.min(textOffset, textNode.textContent.length);
      range.setStart(textNode, maxOffset);
      range.setEnd(textNode, maxOffset);

      const rect = range.getBoundingClientRect();

      // Check if we have valid positioning data (height > 0 indicates valid positioning)
      if (rect.height > 0) {
        // Position cursor relative to body (accounting for body padding)
        const bodyRect = document.body.getBoundingClientRect();
        const left = rect.left - bodyRect.left;
        const top = rect.top - bodyRect.top;
        cursor.style.left = left + 'px';
        cursor.style.top = top + 'px';
        cursor.style.height = rect.height + 'px';
      } else {
        // Fallback to approximate positioning when DOM Range doesn't provide valid positioning
        fallbackCursorPosition();
      }
    } else {
      fallbackCursorPosition();
    }
  } catch (error) {
    console.warn('Error updating cursor position:', error);
    fallbackCursorPosition();
  }
}

// Fallback positioning using approximate calculations
function fallbackCursorPosition() {
  const lines = currentText.split('\n');
  let y = 0;

  // Calculate Y position based on line
  for (let i = 0; i < cursorPosition.line && i < lines.length; i++) {
    y += getLineHeight();
  }

  // Calculate X position based on character
  const currentLine = lines[cursorPosition.line] || '';
  const x = cursorPosition.character * getCharWidth();

  // Account for body padding in fallback positioning
  const bodyRect = document.body.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  const offsetX = contentRect.left - bodyRect.left;
  const offsetY = contentRect.top - bodyRect.top;

  cursor.style.left = (x + offsetX) + 'px';
  cursor.style.top = (y + offsetY) + 'px';
  cursor.style.height = getLineHeight() + 'px';
}

// Convert line/character position to text offset
function getTextOffsetFromPosition(line, character) {
  const lines = currentText.split('\n');
  let offset = 0;

  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline character
  }

  const currentLine = lines[line] || '';
  offset += Math.min(character, currentLine.length);

  return offset;
}

// Convert text offset to line/character position
function getPositionFromTextOffset(offset) {
  const lines = currentText.split('\n');
  let currentOffset = 0;

  for (let line = 0; line < lines.length; line++) {
    const lineLength = lines[line].length;
    if (currentOffset + lineLength >= offset) {
      return {
        line: line,
        character: offset - currentOffset
      };
    }
    currentOffset += lineLength + 1; // +1 for newline
  }

  // If offset is beyond the text, return the last position
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length
  };
}

function getLineHeight() {
  const computedStyle = window.getComputedStyle(content);
  return parseFloat(computedStyle.lineHeight) || parseFloat(computedStyle.fontSize) * 1.5;
}

function getCharWidth() {
  const computedStyle = window.getComputedStyle(content);
  const fontSize = parseFloat(computedStyle.fontSize);
  const fontFamily = computedStyle.fontFamily;

  // Create a temporary span to measure character width
  const span = document.createElement('span');
  span.style.fontSize = fontSize + 'px';
  span.style.fontFamily = fontFamily;
  span.style.visibility = 'hidden';
  span.style.position = 'absolute';
  span.textContent = 'M'; // Use 'M' as it's typically the widest character
  document.body.appendChild(span);

  const width = span.getBoundingClientRect().width;
  document.body.removeChild(span);

  return width;
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

// Handle clicks to position cursor using DOM Range API
content.addEventListener('click', e => {
  try {
    // Use DOM Range API to get accurate text position from click coordinates
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (range) {
      const textNode = range.startContainer;
      const offset = range.startOffset;

      // Convert text offset to line/character position
      cursorPosition = getPositionFromTextOffset(offset);

      updateCursorPosition();

      vscode.postMessage({
        command: 'click',
        position: cursorPosition
      });
    } else {
      // Fallback to approximate positioning when caretRangeFromPoint fails
      const rect = content.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const line = Math.floor(y / getLineHeight());
      const character = Math.floor(x / getCharWidth());

      cursorPosition = { line, character };
      updateCursorPosition();

      vscode.postMessage({
        command: 'click',
        position: cursorPosition
      });
    }
  } catch (error) {
    console.warn('Error handling click:', error);
    // Fallback to approximate positioning
    const rect = content.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const line = Math.floor(y / getLineHeight());
    const character = Math.floor(x / getCharWidth());

    cursorPosition = { line, character };
    updateCursorPosition();

    vscode.postMessage({
      command: 'click',
      position: cursorPosition
    });
  }
});

// Focus content on load
content.focus();
