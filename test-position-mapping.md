# Position Mapping Test Cases

## Test Case 1: Simple Bold Text
This is **bold** text.

## Test Case 2: Simple Italic Text
This is *italic* text.

## Test Case 3: Nested Formatting
This is **bold and *italic* together**.

## Test Case 4: Adjacent Formatting
**Bold** and *italic* side by side.

## Test Case 5: Links
Click [here](https://example.com) to visit.

## Test Case 6: Inline Code
Use the `console.log()` function.

## Test Case 7: Multiple List Items
- First item
- Second item with **bold**
- Third item with *italic*

## Test Case 8: Heading with Formatting
### This is a **bold** heading

## Test Case 9: Blockquote
> This is a quote with **bold** text.

## Test Case 10: Complex Mix
Regular text **bold text** more regular *italic* and `code` end.

---

### Expected Behavior Test
When you click on:
1. The word "bold" in "**bold**" → cursor should go to character 'b' in source
2. Text after "**bold**" → cursor should account for the 4 asterisk characters
3. Inside links → cursor should map correctly despite [text](url) syntax
4. Inside inline code → cursor should account for backticks

### Source Position Reference
Line 3: "This is **bold** text."
- "T" at position 0
- "b" in bold at position 10 (after "This is **")
- "t" after bold at position 18 (after "This is **bold** ")

