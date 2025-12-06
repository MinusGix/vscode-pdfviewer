# Markdown Position Mapping - Quick Reference

## Problem Summary
Click-to-position mapping was incorrect because markdown syntax characters (like `**`, `*`, `[`, `]`) were counted in position calculations even though they don't appear in the rendered output.

## Solution
Implemented **character-level mapping** using **pattern-based detection** that tracks which characters are syntax vs content:

**Why Pattern-Based vs AST-Based?**
- ✅ Simpler and more maintainable
- ✅ 65/65 tests passing
- ✅ Single-pass O(n) performance
- ✅ Independent of parser internals

```javascript
// Example for "**bold**"
characterMap = [
  { sourceOffset: 0, renderOffset: 0, inSyntax: true },   // *
  { sourceOffset: 1, renderOffset: 0, inSyntax: true },   // *
  { sourceOffset: 2, renderOffset: 0, inSyntax: false },  // b
  { sourceOffset: 3, renderOffset: 1, inSyntax: false },  // o
  { sourceOffset: 4, renderOffset: 2, inSyntax: false },  // l
  { sourceOffset: 5, renderOffset: 3, inSyntax: false },  // d
  { sourceOffset: 6, renderOffset: 4, inSyntax: true },   // *
  { sourceOffset: 7, renderOffset: 4, inSyntax: true },   // *
]
```

## Key Files Modified

### Backend (TypeScript)
- **`src/markdown/markdownRenderer.ts`**
  - Added `CharacterMapping` interface
  - Added `buildCharacterMapping()` method
  - Returns `RenderResult` with both HTML and character map

- **`src/markdown/basicWysiwygProvider.ts`**
  - Passes character map to webview

### Frontend (JavaScript)
- **`lib/markdown/basic-wysiwyg.js`**
  - Added `characterMap` state
  - New: `renderOffsetToSourceOffset()` function
  - New: `sourceOffsetToRenderOffset()` function
  - Rewrote click handler to use character mapping
  - Rewrote cursor positioning to use character mapping

## Testing

### Run All Tests
```bash
npx ts-node src/markdown/test-mapping.ts
```

**Expected:** ✅ 65 passed, 0 failed

### Test Coverage
- Simple bold: `**text**`
- Simple italic: `*text*`
- Links: `[text](url)`
- Headings: `# text`
- Lists: `- item`
- Nested formatting: `**bold and *italic***`
- Adjacent formatting: `**bold** *italic* \`code\``
- Multi-line documents
- Blockquotes: `> text`

### Manual Testing
1. Open `test-position-mapping.md` in WYSIWYG editor
2. Click on various positions
3. Verify cursor appears at correct source location

## API Reference

### TypeScript (Backend)

#### `MarkdownRenderer.render(markdown: string)`
```typescript
const result = await renderer.render(markdown);
// Returns: {
//   html: string,
//   characterMap: CharacterMapping[]
// }
```

#### `CharacterMapping` Interface
```typescript
interface CharacterMapping {
  sourceOffset: number;    // Position in markdown source
  renderOffset: number;    // Position in rendered text
  inSyntax: boolean;       // True if markdown syntax
}
```

### JavaScript (Frontend)

#### `renderOffsetToSourceOffset(renderOffset: number)`
Converts a click position in rendered HTML to source markdown position.

```javascript
const renderOffset = 10; // Clicked 10 chars into rendered text
const sourceOffset = renderOffsetToSourceOffset(renderOffset);
// Returns source position accounting for markdown syntax
```

#### `sourceOffsetToRenderOffset(sourceOffset: number)`
Converts a cursor position in source markdown to rendered position.

```javascript
const sourceOffset = 15; // Cursor at char 15 in source
const renderOffset = sourceOffsetToRenderOffset(sourceOffset);
// Returns render position for cursor display
```

## Supported Markdown Syntax

✅ **Inline Formatting:**
- Bold: `**text**` or `__text__`
- Italic: `*text*` or `_text_`
- Code: `` `text` ``

✅ **Block Elements:**
- Headings: `# H1`, `## H2`, etc.
- Lists: `- item`, `+ item`, `* item`
- Blockquotes: `> text`

✅ **Links:**
- `[text](url)`

✅ **Nested/Adjacent:**
- `**bold and *italic* together**`
- `**bold** *italic* \`code\``

⚠️ **Limited Support:**
- Math equations: `$E=mc^2$` (basic support)
- Code blocks: ` ```code``` ` (basic support)
- Tables (basic support)

## Performance

- **Character Map Size:** ~40 bytes per source character
- **10KB Document:** ~10K entries = ~400KB memory
- **Lookup Time:** O(n) linear search
  - Could be optimized to O(log n) with binary search

## Known Limitations

1. **Escaped Syntax:** `\*not italic\*` may not be handled correctly
2. **Complex GFM:** Tables, task lists need enhancement
3. **Math Equations:** LaTeX syntax needs special handling
4. **HTML Blocks:** Raw HTML in markdown not fully supported

## Debugging

### Enable Console Logging
In `lib/markdown/basic-wysiwyg.js`, look for these debug logs:

```javascript
console.log(`Click: renderOffset=${renderOffset}, sourceOffset=${sourceOffset}`);
console.log(`UpdateCursor: sourceOffset=${sourceOffset}, renderOffset=${renderOffset}`);
```

### Inspect Character Map
In browser console:
```javascript
console.log(characterMap);
```

### Test Specific Markdown
```typescript
import { MarkdownRenderer } from './markdownRenderer';

const renderer = new MarkdownRenderer();
const result = await renderer.render('**test**');
console.log(result.characterMap);
```

## Troubleshooting

### Issue: Cursor appears in wrong position
**Check:**
1. Is `characterMap` populated in webview?
2. Check browser console for errors
3. Verify markdown syntax is supported

### Issue: Clicks don't work
**Check:**
1. Verify `data-sourcepos` attributes exist in rendered HTML
2. Check TreeWalker is finding text nodes correctly
3. Verify `caretRangeFromPoint` is supported (Chrome/Edge)

### Issue: New markdown syntax not working
**Solution:** Add pattern detection in `buildCharacterMapping()`:
```typescript
// Example for strikethrough ~~text~~
if (char === '~' && markdown[i + 1] === '~') {
  // Mark as syntax
  mapping.push({ sourceOffset: i, renderOffset, inSyntax: true });
  mapping.push({ sourceOffset: i + 1, renderOffset, inSyntax: true });
  i += 2;
  continue;
}
```

## Future Enhancements

### Priority 1: AST-Based Mapping
Replace pattern detection with remark AST traversal for 100% accuracy.

### Priority 2: Binary Search Optimization
```javascript
function renderOffsetToSourceOffset(renderOffset) {
  // Use binary search instead of linear
  let lo = 0, hi = characterMap.length - 1;
  // ... binary search implementation
}
```

### Priority 3: Incremental Updates
Only rebuild character map for changed regions, not entire document.

## Support

- **Documentation:** See `MARKDOWN_POSITION_MAPPING_FIX.md`
- **Tests:** See `src/markdown/test-mapping.ts`
- **Design:** See `src/markdown/WYSIWYG_Design_Strategy.md`

## Version History

- **v1.0** (Current): Initial character mapping implementation
  - 65 test cases passing
  - Supports common markdown syntax
  - Pattern-based syntax detection

