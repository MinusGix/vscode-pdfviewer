import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { MdParser } from './mdParser';

describe('MdParser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('file parsing with disabled files', () => {
        test('should return empty result for disabled file with lattice:disabled marker', async () => {
            const disabledContent = `<!-- lattice:disabled -->
# Study Notes

:::card
front: What is Node.js?
back: A JavaScript runtime built on Chrome's V8 engine
tags: programming, nodejs
type: basic
:::`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
                getText: () => disabledContent
            } as any);

            const uri = vscode.Uri.parse('test.md');
            const result = await MdParser.parseFile(uri);

            expect(result.cards).toHaveLength(0);
            expect(result.positions).toHaveLength(0);
        });

        test('should return empty result for disabled file with disabled marker', async () => {
            const disabledContent = `<!-- disabled -->
# Study Notes

:::card
front: What is TypeScript?
back: A typed superset of JavaScript
tags: programming, typescript
type: basic
:::`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
                getText: () => disabledContent
            } as any);

            const uri = vscode.Uri.parse('test.md');
            const result = await MdParser.parseFile(uri);

            expect(result.cards).toHaveLength(0);
            expect(result.positions).toHaveLength(0);
        });

        test('should parse cards from enabled file normally', async () => {
            const enabledContent = `# Study Notes

:::card
front: What is Node.js?
back: A JavaScript runtime built on Chrome's V8 engine
tags: programming, nodejs
type: basic
:::`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
                getText: () => enabledContent
            } as any);

            const uri = vscode.Uri.parse('test.md');
            const result = await MdParser.parseFile(uri);

            expect(result.cards).toHaveLength(1);
            expect(result.cards[0].front).toBe('What is Node.js?');
            expect(result.cards[0].back).toBe('A JavaScript runtime built on Chrome\'s V8 engine');
        });

        test('should handle disabled marker with extra whitespace', async () => {
            const disabledContent = `<!--   lattice:disabled   -->
# Study Notes

:::card
front: Test
back: Test back
type: basic
:::`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
                getText: () => disabledContent
            } as any);

            const uri = vscode.Uri.parse('test.md');
            const result = await MdParser.parseFile(uri);

            expect(result.cards).toHaveLength(0);
        });

        test('should handle disabled marker case insensitive', async () => {
            const disabledContent = `<!-- LATTICE:DISABLED -->
# Study Notes

:::card
front: Test
back: Test back
type: basic
:::`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
                getText: () => disabledContent
            } as any);

            const uri = vscode.Uri.parse('test.md');
            const result = await MdParser.parseFile(uri);

            expect(result.cards).toHaveLength(0);
        });

        test('should only check first 10 lines for disabled marker', async () => {
            const contentWithLateDisabledMarker = `# Study Notes
Line 2
Line 3
Line 4
Line 5
Line 6
Line 7
Line 8
Line 9
Line 10
Line 11
<!-- lattice:disabled -->

:::card
front: Test
back: Test back
type: basic
:::`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
                getText: () => contentWithLateDisabledMarker
            } as any);

            const uri = vscode.Uri.parse('test.md');
            const result = await MdParser.parseFile(uri);

            // Should parse the card since disabled marker is after line 10
            expect(result.cards).toHaveLength(1);
            expect(result.cards[0].front).toBe('Test');
        });

        test('should ignore disabled marker in code blocks or other contexts', async () => {
            const contentWithFakeDisabledMarker = `# Study Notes

This is not a disabled marker: <!-- lattice:disabled in text -->

:::card
front: Test
back: Test back
type: basic
:::`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
                getText: () => contentWithFakeDisabledMarker
            } as any);

            const uri = vscode.Uri.parse('test.md');
            const result = await MdParser.parseFile(uri);

            // Should parse the card since the marker is not at the start of a line
            expect(result.cards).toHaveLength(1);
            expect(result.cards[0].front).toBe('Test');
        });

        test('should handle file with both disabled marker and no cards', async () => {
            const disabledContentNoCards = `<!-- lattice:disabled -->
# Study Notes

Just some regular markdown content without any cards.`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
                getText: () => disabledContentNoCards
            } as any);

            const uri = vscode.Uri.parse('test.md');
            const result = await MdParser.parseFile(uri);

            expect(result.cards).toHaveLength(0);
            expect(result.positions).toHaveLength(0);
        });
    });

    describe('error handling', () => {
        test('should handle file read errors gracefully', async () => {
            vi.mocked(vscode.workspace.openTextDocument).mockRejectedValue(new Error('File not found'));

            const uri = vscode.Uri.parse('nonexistent.md');
            const result = await MdParser.parseFile(uri);

            expect(result.cards).toHaveLength(0);
            expect(result.positions).toHaveLength(0);
        });
    });
}); 