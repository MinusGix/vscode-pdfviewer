// @ts-ignore
const vscode = acquireVsCodeApi();
const content = document.getElementById('content');
const cursor = document.getElementById('cursor');

let currentText = '';
let currentHtml = '';
let cursorPosition = { line: 0, character: 0 };
let positionIndex = [];
let characterMap = []; // Character-level mapping between source and render positions

// Handle messages from extension
window.addEventListener('message', event => {
  const message = event.data;
  switch (message.type) {
    case 'update':
      currentText = message.text;
      currentHtml = message.html || message.text;
      characterMap = message.characterMap || [];
      content.innerHTML = currentHtml;
      buildPositionIndex();
      updateCursorPosition();
      break;
  }
});

// Build position index for efficient lookup
function buildPositionIndex() {
  const elements = [...content.querySelectorAll('[data-sourcepos]')];
  positionIndex = elements.map(el => {
    const [start, end] = el.dataset.sourcepos.split(':').map(Number);
    return { sourceStart: start, sourceEnd: end, element: el };
  }).sort((a, b) => a.sourceStart - b.sourceStart);
}

// Find element at specific source offset using binary search
function findElementAtOffset(offset) {
  let lo = 0;
  let hi = positionIndex.length - 1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const item = positionIndex[mid];

    if (offset < item.sourceStart) {
      hi = mid - 1;
    } else if (offset >= item.sourceEnd) {
      lo = mid + 1;
    } else {
      return item.element;
    }
  }

  return null;
}

// Convert render offset to source offset using character map
function renderOffsetToSourceOffset(renderOffset) {
  if (!characterMap || characterMap.length === 0) {
    return renderOffset; // Fallback to 1:1 mapping
  }

  // Find the first mapping entry where renderOffset matches (and it's not syntax)
  for (let i = 0; i < characterMap.length; i++) {
    const entry = characterMap[i];
    if (!entry.inSyntax && entry.renderOffset === renderOffset) {
      return entry.sourceOffset;
    }
    // If we've passed the target renderOffset, return the closest match
    if (!entry.inSyntax && entry.renderOffset > renderOffset) {
      return i > 0 ? characterMap[i - 1].sourceOffset : entry.sourceOffset;
    }
  }

  // If not found, return the last source offset
  return characterMap.length > 0 ? characterMap[characterMap.length - 1].sourceOffset : renderOffset;
}

// Convert source offset to render offset using character map
function sourceOffsetToRenderOffset(sourceOffset) {
  if (!characterMap || characterMap.length === 0) {
    return sourceOffset; // Fallback to 1:1 mapping
  }

  // Find the mapping entry for this source offset
  const entry = characterMap.find(e => e.sourceOffset === sourceOffset);
  if (entry) {
    return entry.renderOffset;
  }

  // If not found, find the closest non-syntax entry
  for (let i = 0; i < characterMap.length; i++) {
    if (characterMap[i].sourceOffset >= sourceOffset && !characterMap[i].inSyntax) {
      return characterMap[i].renderOffset;
    }
  }

  return sourceOffset; // Fallback
}

// Update cursor position using DOM Range API for accuracy with character mapping
function updateCursorPosition() {
  try {
    const sourceOffset = getTextOffsetFromPosition(cursorPosition.line, cursorPosition.character);

    // Convert source offset to render offset using character map
    const renderOffset = sourceOffsetToRenderOffset(sourceOffset);

    console.log(`UpdateCursor: sourceOffset=${sourceOffset}, renderOffset=${renderOffset}, position=${JSON.stringify(cursorPosition)}`);

    // Walk through the rendered text to find the position
    const walker = document.createTreeWalker(
      content,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let currentRenderOffset = 0;
    let textNode = walker.nextNode();
    let found = false;

    while (textNode) {
      const nodeLength = textNode.textContent.length;

      if (currentRenderOffset + nodeLength >= renderOffset) {
        // Found the text node containing our cursor position
        const nodeOffset = Math.min(renderOffset - currentRenderOffset, nodeLength);

        try {
          const range = document.createRange();
          range.setStart(textNode, nodeOffset);
          range.setEnd(textNode, nodeOffset);

          const rect = range.getBoundingClientRect();

          if (rect.height > 0) {
            // Position cursor relative to body (accounting for body padding)
            const bodyRect = document.body.getBoundingClientRect();
            const left = rect.left - bodyRect.left;
            const top = rect.top - bodyRect.top;
            cursor.style.left = left + 'px';
            cursor.style.top = top + 'px';
            cursor.style.height = rect.height + 'px';
            found = true;
            return;
          }
        } catch (rangeError) {
          console.warn('Error creating range:', rangeError);
        }
        break;
      }

      currentRenderOffset += nodeLength;
      textNode = walker.nextNode();
    }

    if (!found) {
      // Fallback to approximate positioning
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

// Handle clicks to position cursor using DOM Range API and character mapping
content.addEventListener('click', e => {
  try {
    // Use DOM Range API to get accurate text position from click coordinates
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (range) {
      // Calculate the render offset by walking through all text in the document
      let renderOffset = 0;
      let found = false;

      const walker = document.createTreeWalker(
        content,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let textNode = walker.nextNode();
      while (textNode) {
        if (textNode === range.startContainer) {
          renderOffset += range.startOffset;
          found = true;
          break;
        }
        renderOffset += textNode.textContent.length;
        textNode = walker.nextNode();
      }

      if (found) {
        // Use character map to convert render offset to source offset
        const sourceOffset = renderOffsetToSourceOffset(renderOffset);
        cursorPosition = getPositionFromTextOffset(sourceOffset);

        console.log(`Click: renderOffset=${renderOffset}, sourceOffset=${sourceOffset}, position=${JSON.stringify(cursorPosition)}`);
      } else {
        // Fallback to approximate positioning
        const rect = content.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const line = Math.floor(y / getLineHeight());
        const character = Math.floor(x / getCharWidth());

        cursorPosition = { line, character };
      }

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
