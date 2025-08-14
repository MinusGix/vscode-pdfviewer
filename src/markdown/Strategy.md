Design checklist for a **“live-rendered Markdown editor”** implemented as a **Custom Text Editor** in VS Code

The key rule: **keep the *document* identical to the one that ships with VS Code** – every character, every line ending, every cursor position.  
Your webview is just a **presentation layer** that happens to show “pretty” text instead of raw `# Heading`.  
That guarantees that IntelliSense, snippets, diagnostics, Git diff, etc. continue to work.

────────────────────────────────────────
1. File-system contract
• Never mutate the document except through the official `WorkspaceEdit`/`TextEditorEdit` APIs.  
• Treat the `TextDocument` as the single source of truth; the webview is read-only except when the user *explicitly* types.

2. Rendering strategy
A. Fast, per-keystroke diff
   - Maintain a lightweight Markdown → HTML converter (markdown-it, unified/remark, etc.).  NOTE: See the existing card renderer, would its markdown+katex library work or do we need a different one?
   - Re-render only the paragraph (or even the line) that changed.  
   - Cache the last HTML so you can diff and patch the DOM instead of blowing it away. Flickering is bad.

B. Bidirectional mapping
   - Store an offset map (or per-line map) so you can translate:
     – Editor position → pixel in webview (for cursor / selection overlay)  
     – Pixel click in webview → editor position (so clicking a heading puts the caret *inside* the `#`)

C. Selection overlay
   - Overlay a zero-width `<span>` or SVG rectangle at the mapped locations so the native caret still blinks inside the `<textarea>` you hide.  
   - When the user hits arrow keys, you forward them to the hidden `<textarea>` and let VS Code handle the movement.  
   - Re-calculate the overlay position after every `onDidChangeTextEditorSelection`.

3. Input handling
• Capture printable keys in the webview, forward them as `type` commands:

```ts
vscode.commands.executeCommand('type', { text: key });
```

• Non-printable keys (arrows, backspace, enter, tab) should be routed to the hidden `<textarea>` so VS Code’s keybindings, snippets, and multi-cursor logic all fire automatically.

4. Feature parity checklist
☐ Visual theme matching. Ideally colors should be the same as what VS Code uses for rendering markdown.
☐ Undo / redo (works automatically via VS Code)  
☐ Multi-cursor (overlay multiple rectangles)  
  - Ideally, as much logic as possible should be handled by VS Code.
☐ Find / replace (Ctrl+F works because the document is the real editor)  
☐ Formatting, code completion, diagnostics (all already attached to the document)  
☐ Folding ranges (use VS Code’s folding provider, not your own)  
☐ Hover / go-to-definition (works because the language server still sees the raw text)

1. Performance
• Use a Web Worker for Markdown parsing if the file is large.  
• For huge files (>200 kB) switch to “viewport-only” rendering: only render the visible lines and update on scroll.

1. User escape hatch
• Provide a toggle command (`markdownLive.toggle`) that switches back to the plain text editor without changing the file.  
• Respect VS Code’s `workbench.editorAssociations` setting so users can opt out globally.

1. Skeleton implementation outline
```ts
class LiveMdEditorProvider implements vscode.CustomTextEditorProvider {
  resolveCustomTextEditor(
    doc: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    // 1. Build HTML for the webview (hidden textarea + rendered div).
    webviewPanel.webview.html = getHtml(webviewPanel.webview);

    // 2. Push initial content.
    updateContent(doc.getText(), webviewPanel.webview);

    // 3. Listen for document changes.
    const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === doc.uri.toString()) {
        const [start, end] = getMinimalChangeRange(e.contentChanges);
        patchDom(webviewPanel.webview, doc.getText(), start, end);
      }
    });

    // 4. Listen for selection changes.
    const selSub = vscode.window.onDidChangeTextEditorSelection(e => {
      if (e.textEditor.document.uri.toString() === doc.uri.toString()) {
        moveOverlay(e.selections, webviewPanel.webview);
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      selSub.dispose();
    });
  }
}
```

1. Testing
A very important aspect is *testing*.  
Ideally, we should rarely need to actually manually test the webview. Instead, we should simply be able to verify that the correct markdown is being rendered.

Fast feedback loop – no VS Code window
1.1 Unit tests in Node
• Parse Markdown → HTML, assert that the offset map is correct for 100 % of sample snippets.
• Run the same parser inside a Web Worker and measure timing to ensure <1 ms per line on CI hardware.
• Write property-based tests with fast-check: generate random Markdown, parse, round-trip back to text via the offset map, assert identity.
1.2 Virtual document integration
• Use @vscode/test-electron only to spin up an extension host without opening any window (--disable-workspace-trust --disable-extensions --user-data-dir <tmp>).
• Open a TextDocument via workspace.openTextDocument, fire synthetic onDidChangeTextDocument events, and assert that the provider emits the expected webview messages.
1.3 Keybinding forwarding harness
• Spawn a minimal VS Code instance in headless mode (--headless --disable-extensions).
• Use the unpublished but stable vscode.commands.executeCommand('type', { text }) API to inject keystrokes.
• Assert that the document content is what you would get if the same keys were typed in the normal editor.
• This verifies that your hidden <textarea> and overlay logic do not drop, duplicate, or reorder characters.

