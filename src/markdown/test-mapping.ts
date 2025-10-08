/**
 * Test script to validate character mapping functionality
 * Run with: npx ts-node src/markdown/test-mapping.ts
 */

import { MarkdownRenderer } from './markdownRenderer';

async function testCharacterMapping() {
    const renderer = new MarkdownRenderer();

    // Test cases with expected mappings
    const testCases = [
        {
            name: 'Simple bold',
            markdown: 'This is **bold** text',
            tests: [
                { sourceOffset: 0, expectedRenderOffset: 0, char: 'T' },
                { sourceOffset: 8, expectedRenderOffset: 8, char: '*', isSyntax: true },
                { sourceOffset: 9, expectedRenderOffset: 8, char: '*', isSyntax: true },
                { sourceOffset: 10, expectedRenderOffset: 8, char: 'b' },
                { sourceOffset: 14, expectedRenderOffset: 12, char: '*', isSyntax: true },
                { sourceOffset: 16, expectedRenderOffset: 12, char: ' ' },
            ]
        },
        {
            name: 'Simple italic',
            markdown: 'This is *italic* text',
            tests: [
                { sourceOffset: 0, expectedRenderOffset: 0, char: 'T' },
                { sourceOffset: 8, expectedRenderOffset: 8, char: '*', isSyntax: true },
                { sourceOffset: 9, expectedRenderOffset: 8, char: 'i' },
                { sourceOffset: 15, expectedRenderOffset: 14, char: '*', isSyntax: true },
                { sourceOffset: 16, expectedRenderOffset: 14, char: ' ' },
            ]
        },
        {
            name: 'Link',
            markdown: 'Click [here](https://example.com) please',
            tests: [
                { sourceOffset: 0, expectedRenderOffset: 0, char: 'C' },
                { sourceOffset: 6, expectedRenderOffset: 6, char: '[', isSyntax: true },
                { sourceOffset: 7, expectedRenderOffset: 6, char: 'h' },
                { sourceOffset: 11, expectedRenderOffset: 10, char: ']', isSyntax: true },
                { sourceOffset: 12, expectedRenderOffset: 10, char: '(', isSyntax: true },
                { sourceOffset: 32, expectedRenderOffset: 10, char: ')', isSyntax: true },
                { sourceOffset: 33, expectedRenderOffset: 10, char: ' ' },
                { sourceOffset: 34, expectedRenderOffset: 11, char: 'p' },
            ]
        },
        {
            name: 'Heading',
            markdown: '# Heading\nText',
            tests: [
                { sourceOffset: 0, expectedRenderOffset: 0, char: '#', isSyntax: true },
                { sourceOffset: 1, expectedRenderOffset: 0, char: ' ', isSyntax: true },
                { sourceOffset: 2, expectedRenderOffset: 0, char: 'H' },
                { sourceOffset: 9, expectedRenderOffset: 7, char: '\n' },
                { sourceOffset: 10, expectedRenderOffset: 8, char: 'T' },
            ]
        },
        {
            name: 'List',
            markdown: '- Item 1\n- Item 2',
            tests: [
                { sourceOffset: 0, expectedRenderOffset: 0, char: '-', isSyntax: true },
                { sourceOffset: 1, expectedRenderOffset: 0, char: ' ', isSyntax: true },
                { sourceOffset: 2, expectedRenderOffset: 0, char: 'I' },
                { sourceOffset: 9, expectedRenderOffset: 7, char: '-', isSyntax: true },
                { sourceOffset: 10, expectedRenderOffset: 7, char: ' ', isSyntax: true },
                { sourceOffset: 11, expectedRenderOffset: 7, char: 'I' },
            ]
        },
        {
            name: 'Nested formatting',
            markdown: 'Text **bold and *italic* together** end',
            tests: [
                { sourceOffset: 0, expectedRenderOffset: 0, char: 'T' },
                { sourceOffset: 5, expectedRenderOffset: 5, char: '*', isSyntax: true },
                { sourceOffset: 7, expectedRenderOffset: 5, char: 'b' },
                { sourceOffset: 16, expectedRenderOffset: 14, char: '*', isSyntax: true },
                { sourceOffset: 17, expectedRenderOffset: 14, char: 'i' },
                { sourceOffset: 23, expectedRenderOffset: 20, char: '*', isSyntax: true },
                { sourceOffset: 24, expectedRenderOffset: 20, char: ' ' },
                { sourceOffset: 33, expectedRenderOffset: 29, char: '*', isSyntax: true },
                { sourceOffset: 35, expectedRenderOffset: 29, char: ' ' },
            ]
        },
        {
            name: 'Adjacent formatting',
            markdown: '**Bold** *italic* `code`',
            tests: [
                { sourceOffset: 0, expectedRenderOffset: 0, char: '*', isSyntax: true },
                { sourceOffset: 2, expectedRenderOffset: 0, char: 'B' },
                { sourceOffset: 6, expectedRenderOffset: 4, char: '*', isSyntax: true },
                { sourceOffset: 9, expectedRenderOffset: 5, char: '*', isSyntax: true },
                { sourceOffset: 10, expectedRenderOffset: 5, char: 'i' },
                { sourceOffset: 16, expectedRenderOffset: 11, char: '*', isSyntax: true },
                { sourceOffset: 18, expectedRenderOffset: 12, char: '`', isSyntax: true },
                { sourceOffset: 19, expectedRenderOffset: 12, char: 'c' },
                { sourceOffset: 23, expectedRenderOffset: 16, char: '`', isSyntax: true },
            ]
        },
        {
            name: 'Multiple lines with formatting',
            markdown: '# Title\n\nThis is **bold**.\n\n- Item 1',
            tests: [
                { sourceOffset: 0, expectedRenderOffset: 0, char: '#', isSyntax: true },
                { sourceOffset: 2, expectedRenderOffset: 0, char: 'T' },
                { sourceOffset: 7, expectedRenderOffset: 5, char: '\n' },
                { sourceOffset: 8, expectedRenderOffset: 6, char: '\n' },
                { sourceOffset: 17, expectedRenderOffset: 15, char: '*', isSyntax: true },
                { sourceOffset: 19, expectedRenderOffset: 15, char: 'b' },
                { sourceOffset: 23, expectedRenderOffset: 19, char: '*', isSyntax: true },
                { sourceOffset: 28, expectedRenderOffset: 22, char: '-', isSyntax: true },
                { sourceOffset: 30, expectedRenderOffset: 22, char: 'I' },
            ]
        },
        {
            name: 'Blockquote',
            markdown: '> This is a quote\n> with **bold**',
            tests: [
                { sourceOffset: 0, expectedRenderOffset: 0, char: '>', isSyntax: true },
                { sourceOffset: 1, expectedRenderOffset: 0, char: ' ', isSyntax: true },
                { sourceOffset: 2, expectedRenderOffset: 0, char: 'T' },
                { sourceOffset: 18, expectedRenderOffset: 16, char: '\n', isSyntax: true },
                { sourceOffset: 19, expectedRenderOffset: 16, char: '>', isSyntax: true },
                { sourceOffset: 20, expectedRenderOffset: 16, char: ' ' },
                { sourceOffset: 26, expectedRenderOffset: 21, char: '*', isSyntax: true },
                { sourceOffset: 28, expectedRenderOffset: 22, char: 'b' },
            ]
        },
    ];

    console.log('Running character mapping tests...\n');

    let passCount = 0;
    let failCount = 0;

    for (const testCase of testCases) {
        console.log(`Test: ${testCase.name}`);
        console.log(`Markdown: "${testCase.markdown}"`);

        const result = await renderer.render(testCase.markdown);
        const charMap = result.characterMap;

        console.log(`Character map length: ${charMap.length}`);

        // @ts-ignore
        if (testCase.debug) {
            console.log('  Full character map:');
            for (let i = 0; i < charMap.length; i++) {
                const m = charMap[i];
                const char = testCase.markdown[m.sourceOffset];
                const displayChar = char === '\n' ? '\\n' : char === ' ' ? '·' : char;
                console.log(`    [${i}] source=${m.sourceOffset} ('${displayChar}') → render=${m.renderOffset} syntax=${m.inSyntax}`);
            }
        }

        for (const test of testCase.tests) {
            const mapping = charMap.find(m => m.sourceOffset === test.sourceOffset);

            if (!mapping) {
                console.log(`  ❌ FAIL: No mapping found for source offset ${test.sourceOffset} (char: '${test.char}')`);
                failCount++;
                continue;
            }

            const renderOffsetMatch = mapping.renderOffset === test.expectedRenderOffset;
            const syntaxMatch = test.isSyntax === undefined || mapping.inSyntax === test.isSyntax;

            if (renderOffsetMatch && syntaxMatch) {
                console.log(`  ✅ PASS: Source ${test.sourceOffset} ('${test.char}') → Render ${mapping.renderOffset} (syntax: ${mapping.inSyntax})`);
                passCount++;
            } else {
                console.log(`  ❌ FAIL: Source ${test.sourceOffset} ('${test.char}')`);
                console.log(`     Expected: render=${test.expectedRenderOffset}, syntax=${test.isSyntax ?? 'any'}`);
                console.log(`     Got: render=${mapping.renderOffset}, syntax=${mapping.inSyntax}`);
                failCount++;
            }
        }

        console.log('');
    }

    console.log(`\nResults: ${passCount} passed, ${failCount} failed`);
    console.log(passCount === 0 && failCount === 0 ? '⚠️  No tests run' :
        failCount === 0 ? '✅ All tests passed!' : '❌ Some tests failed');
}

// Run tests
testCharacterMapping().catch(console.error);

