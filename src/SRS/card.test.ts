import { describe, test, expect } from 'vitest';
import { parseMdCard, extractMdCards, parseMdCardWithPosition, extractMdCardsWithPosition } from './card';

describe('parseMdCard', () => {
    test('parses basic card with single-line content', () => {
        const content = `front: What is TypeScript?
back: A typed superset of JavaScript
tags: programming, typescript
type: basic`;

        const card = parseMdCard(content);
        expect(card).toEqual({
            front: 'What is TypeScript?',
            back: 'A typed superset of JavaScript',
            tags: ['programming', 'typescript'],
            type: 'basic'
        });
    });

    test('parses card with multiline content', () => {
        const content = `front: 
  What are the steps to make a cake?
  Please list them in order.
back: 
  1. Gather ingredients
  2. Mix dry ingredients
  3. Mix wet ingredients
  4. Combine mixtures
  5. Bake at 350°F
tags: cooking, baking
type: problem
steps: true`;

        const card = parseMdCard(content);
        expect(card).toEqual({
            front: 'What are the steps to make a cake?\nPlease list them in order.',
            back: '1. Gather ingredients\n2. Mix dry ingredients\n3. Mix wet ingredients\n4. Combine mixtures\n5. Bake at 350°F',
            tags: ['cooking', 'baking'],
            type: 'problem',
            steps: true
        });
    });

    test('parses card with multiline content starting on same line', () => {
        const content = `front: What are the steps to make a cake?
  Please list them in order.
back: 1. Gather ingredients
  2. Mix dry ingredients
  3. Mix wet ingredients
  4. Combine mixtures
  5. Bake at 350°F
tags: cooking, baking
type: problem
steps: true`;

        const card = parseMdCard(content);
        expect(card).toEqual({
            front: 'What are the steps to make a cake?\n  Please list them in order.',
            back: '1. Gather ingredients\n  2. Mix dry ingredients\n  3. Mix wet ingredients\n  4. Combine mixtures\n  5. Bake at 350°F',
            tags: ['cooking', 'baking'],
            type: 'problem',
            steps: true
        });
    });

    test('handles mixed multiline styles', () => {
        const content = `front: First line of front
  Second line of front
back: 
  First line of back
  Second line of back
type: basic`;

        const card = parseMdCard(content);
        expect(card).toEqual({
            front: 'First line of front\n  Second line of front',
            back: 'First line of back\nSecond line of back',
            type: 'basic',
            tags: []
        });
    });

    test('parses card with all optional fields', () => {
        const content = `title: Complex Integration
front: 
  Explain the Residue Theorem
back: 
  The residue theorem states that for a meromorphic function f(z):
  ∮ f(z)dz = 2πi * Σ Res(f,ak)
  where ak are the poles of f(z) inside the contour.
tags: math, complex analysis
type: derivation
difficulty: hard
steps: true`;

        const card = parseMdCard(content);
        expect(card).toEqual({
            title: 'Complex Integration',
            front: 'Explain the Residue Theorem',
            back: 'The residue theorem states that for a meromorphic function f(z):\n∮ f(z)dz = 2πi * Σ Res(f,ak)\nwhere ak are the poles of f(z) inside the contour.',
            tags: ['math', 'complex analysis'],
            type: 'derivation',
            difficulty: 'hard',
            steps: true
        });
    });

    test('handles empty lines and extra whitespace', () => {
        const content = `
        front: What is gravity?
        
        back: A fundamental force of nature
        
        tags: physics, forces
        type: basic
        `;

        const card = parseMdCard(content);
        expect(card).toEqual({
            front: 'What is gravity?',
            back: 'A fundamental force of nature',
            tags: ['physics', 'forces'],
            type: 'basic'
        });
    });

    test('throws error when missing required fields', () => {
        const content = `front: What is gravity?
type: basic`;

        expect(() => parseMdCard(content)).toThrow('Card must have both front and back content');
    });

    test('validates difficulty enum values', () => {
        const content = `front: Test
back: Test back
type: basic
difficulty: invalid`;

        const card = parseMdCard(content);
        expect(card.difficulty).toBeUndefined();
    });

    test('handles boolean steps field correctly', () => {
        const validContent = `front: Test
back: Test back
type: basic
steps: true`;

        const invalidContent = `front: Test
back: Test back
type: basic
steps: not-a-boolean`;

        const validCard = parseMdCard(validContent);
        const invalidCard = parseMdCard(invalidContent);

        expect(validCard.steps).toBe(true);
        expect(invalidCard.steps).toBe(false);
    });

    test('handles boolean disabled field correctly', () => {
        const trueContent = `front: Test
back: Test back
type: basic
disabled: true`;
        const trueCard = parseMdCard(trueContent);
        expect(trueCard.disabled).toBe(true);

        const falseContent = `front: Test
back: Test back
type: basic
disabled: false`;
        const falseCard = parseMdCard(falseContent);
        expect(falseCard.disabled).toBe(false);

        const invalidContent = `front: Test
back: Test back
type: basic
disabled: not-a-boolean`;
        const invalidCard = parseMdCard(invalidContent);
        expect(invalidCard.disabled).toBe(false);

        const missingContent = `front: Test
back: Test back
type: basic`;
        const missingCard = parseMdCard(missingContent);
        expect(missingCard.disabled).toBeUndefined();
    });

    test('handles tags edge cases', () => {
        const emptyTags = parseMdCard(`
front: Test
back: Test back
tags:
type: basic`);
        expect(emptyTags.tags).toEqual([]);

        const singleTag = parseMdCard(`
front: Test
back: Test back
tags: single
type: basic`);
        expect(singleTag.tags).toEqual(['single']);

        const spacedTags = parseMdCard(`
front: Test
back: Test back
tags:   tag1  ,  tag2   ,tag3
type: basic`);
        expect(spacedTags.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    test('ignores unknown fields', () => {
        const card = parseMdCard(`
front: Test
back: Test back
unknown: This should be stored
type: basic
another_unknown: Also stored
custom_field: With multiple words`);

        expect(card).toEqual({
            front: 'Test',
            back: 'Test back',
            type: 'basic',
            tags: [],
            extraFields: {
                unknown: 'This should be stored',
                another_unknown: 'Also stored',
                custom_field: 'With multiple words'
            }
        });
    });

    test('handles multiline content in unrecognized fields', () => {
        const card = parseMdCard(`
front: Test
back: Test back
custom_field:
    This is a multiline
    custom field content
    with several lines
type: basic`);

        expect(card).toEqual({
            front: 'Test',
            back: 'Test back',
            type: 'basic',
            tags: [],
            extraFields: {
                custom_field: 'This is a multiline\ncustom field content\nwith several lines'
            }
        });
    });

    test('allows omitting all optional fields', () => {
        const card = parseMdCard(`
front: Test
back: Test back`);

        expect(card).toEqual({
            front: 'Test',
            back: 'Test back',
            tags: [],
            type: 'basic'  // assuming 'basic' is default, if not, adjust this
        });
    });

    test('allows fields in any order', () => {
        const card = parseMdCard(`
type: problem
back: Test back
tags: tag1, tag2
steps: true
front: Test
difficulty: hard`);

        expect(card).toEqual({
            front: 'Test',
            back: 'Test back',
            tags: ['tag1', 'tag2'],
            type: 'problem',
            steps: true,
            difficulty: 'hard'
        });
    });

    test('handles numbered lists with colons in content', () => {
        const content = `id: 4PKOf-C7J_kLtAJ_hbGI-
front: What is an ideal in a ring $(R,+,\\cdot)$, and what are its key properties?
back: An ideal $I \\subseteq R$ is a subset that's closed under addition and multiplication by any ring element.
Key properties
1. $(I,+)$ is a subgroup of $(R,+)$:
   - If $a,b \\in I$, then $a + b \\in I$
   - If $a \\in I$, then $-a \\in I$
   - $0 \\in I$
2. For all $r \\in R$ and $a \\in I$:
   $r \\cdot a \\in I$ and $a \\cdot r \\in I$`;

        const card = parseMdCard(content);

        expect(card.id).toBe('4PKOf-C7J_kLtAJ_hbGI-');
        expect(card.front).toBe('What is an ideal in a ring $(R,+,\\cdot)$, and what are its key properties?');

        // The back should include all content including the numbered list with sub-items
        const expectedBack = `An ideal $I \\subseteq R$ is a subset that's closed under addition and multiplication by any ring element.
Key properties
1. $(I,+)$ is a subgroup of $(R,+)$:
   - If $a,b \\in I$, then $a + b \\in I$
   - If $a \\in I$, then $-a \\in I$
   - $0 \\in I$
2. For all $r \\in R$ and $a \\in I$:
   $r \\cdot a \\in I$ and $a \\cdot r \\in I$`;

        expect(card.back).toBe(expectedBack);
        expect(card.type).toBe('basic'); // default type
        expect(card.tags).toEqual([]);
    });

    test('handles content ending with example line containing colons', () => {
        const content = `id: TBqkSM2iQxEwPGRbAGa7q
front: What is a prime ideal? Give both definitions and an example.
back: A prime ideal $P$ is a proper ideal with the following equivalent definitions,
1. For any $a,b \\in R$: if $a \\cdot b \\in P$, then either $a \\in P$ or $b \\in P$
2. The quotient ring $R/P$ is an integral domain

Example In $\\mathbb{Z}$, $(2) = \\{2k : k \\in \\mathbb{Z}\\}$ is prime`;

        const card = parseMdCard(content);

        expect(card.id).toBe('TBqkSM2iQxEwPGRbAGa7q');
        expect(card.front).toBe('What is a prime ideal? Give both definitions and an example.');

        // The back should include all content including the example line at the end
        const expectedBack = `A prime ideal $P$ is a proper ideal with the following equivalent definitions,
1. For any $a,b \\in R$: if $a \\cdot b \\in P$, then either $a \\in P$ or $b \\in P$
2. The quotient ring $R/P$ is an integral domain

Example In $\\mathbb{Z}$, $(2) = \\{2k : k \\in \\mathbb{Z}\\}$ is prime`;

        expect(card.back).toBe(expectedBack);
        expect(card.type).toBe('basic'); // default type
        expect(card.tags).toEqual([]);
    });
});

describe('extractMdCards', () => {
    test('extracts multiple cards from markdown content', () => {
        const mdContent = `# Study Notes

:::card
front: What is Node.js?
back: A JavaScript runtime built on Chrome's V8 engine
tags: programming, nodejs
type: basic
:::

Some notes in between cards...

:::card
front: List HTTP methods
back: |
  1. GET
  2. POST
  3. PUT
  4. DELETE
  5. PATCH
tags: web, http
type: problem
steps: true
:::`;

        const cards = extractMdCards(mdContent);
        expect(cards).toHaveLength(2);
        expect(cards[0].type).toBe('basic');
        expect(cards[1].type).toBe('problem');
        expect(cards[1].steps).toBe(true);
    });

    test('handles invalid cards gracefully', () => {
        const mdContent = `:::card
invalid content
:::

:::card
front: Valid card
back: This one should work
type: basic
:::`;

        const cards = extractMdCards(mdContent);
        expect(cards).toHaveLength(1);
        expect(cards[0].front).toBe('Valid card');
    });

    test('handles empty document and no cards', () => {
        expect(extractMdCards('')).toHaveLength(0);
        expect(extractMdCards('# Just some markdown\nNo cards here')).toHaveLength(0);
    });

    test('handles malformed card markers', () => {
        const mdContent = `:::cardfront: test
back: test
:::

:::card front: test
back: test:::

:::card
front: Valid card
back: test
:::`;

        const cards = extractMdCards(mdContent);
        expect(cards).toHaveLength(1);
        expect(cards[0].front).toBe('Valid card');
    });
});

describe('parseMdCardWithPosition', () => {
    test('tracks positions for single-line fields', () => {
        const content = `front: What is TypeScript?
back: A typed superset of JavaScript
tags: programming, typescript
type: basic`;

        const { card, position } = parseMdCardWithPosition(content, 3);

        // Check card block position (should not include markers as they're handled by extract)
        expect(position.cardBlock).toEqual({
            startLine: 3,
            startCharacter: 0,
            endLine: 8,
            endCharacter: 3,
            value: content
        });

        // Check insert/append positions
        expect(position.insertPosition).toEqual({ line: 4, character: 0 });
        expect(position.appendPosition).toEqual({ line: 7, character: 0 });

        // Check individual field positions
        expect(position.fields.get('front')).toEqual({
            startLine: 3,
            startCharacter: 0,
            endLine: 3,
            endCharacter: 25,
            value: 'What is TypeScript?'
        });

        expect(position.fields.get('back')).toEqual({
            startLine: 4,
            startCharacter: 0,
            endLine: 4,
            endCharacter: 35,
            value: 'A typed superset of JavaScript'
        });
    });

    test('tracks positions for multiline fields', () => {
        const content = `front: 
  What are the steps to make a cake?
  Please list them in order.
back: 
  1. Gather ingredients
  2. Mix dry ingredients
  3. Mix wet ingredients
type: problem
steps: true`;

        const { card, position } = parseMdCardWithPosition(content, 5);

        // Check multiline field positions
        const frontField = position.fields.get('front');
        expect(frontField).toEqual({
            startLine: 5,
            startCharacter: 0,
            endLine: 7,
            endCharacter: 28,
            value: 'What are the steps to make a cake?\nPlease list them in order.'
        });

        const backField = position.fields.get('back');
        expect(backField).toEqual({
            startLine: 8,
            startCharacter: 0,
            endLine: 11,
            endCharacter: 24,
            value: '1. Gather ingredients\n2. Mix dry ingredients\n3. Mix wet ingredients'
        });

        // Check that the field's value matches its position in the original text
        const lines = content.split('\n');
        const frontLines = lines.slice(
            frontField!.startLine - 5,
            frontField!.endLine - 4
        );
        expect(frontLines.join('\n')).toContain(frontField!.value.split('\n')[0]);
    });
});

describe('extractMdCardsWithPosition', () => {
    test('tracks positions for multiple cards in document', () => {
        const mdContent = `# Study Notes

:::card
front: Card 1
back: Answer 1
type: basic
:::

Some notes in between...

:::card
front: Card 2
back: Answer 2
type: basic
:::`;

        const cards = extractMdCardsWithPosition(mdContent);
        expect(cards).toHaveLength(2);

        // First card
        const firstCard = cards[0];
        expect(firstCard.position.cardBlock).toEqual({
            startLine: 3,
            startCharacter: 0,
            endLine: 7,
            endCharacter: 3,
            value: 'front: Card 1\nback: Answer 1\ntype: basic\n'
        });
        expect(firstCard.position.fields.get('front')).toEqual({
            startLine: 3,
            startCharacter: 0,
            endLine: 3,
            endCharacter: 12,
            value: 'Card 1'
        });

        // Second card
        const secondCard = cards[1];
        expect(secondCard.position.cardBlock).toEqual({
            startLine: 11,
            startCharacter: 0,
            endLine: 15,
            endCharacter: 3,
            value: 'front: Card 2\nback: Answer 2\ntype: basic\n'
        });
        expect(secondCard.position.fields.get('front')).toEqual({
            startLine: 11,
            startCharacter: 0,
            endLine: 11,
            endCharacter: 12,
            value: 'Card 2'
        });
    });

    test('handles cards with varying indentation', () => {
        const mdContent = `:::card
    front: Indented card
    back: Indented answer
    type: basic
:::

:::card
front: Non-indented card
back: Non-indented answer
type: basic
:::`;

        const cards = extractMdCardsWithPosition(mdContent);
        expect(cards).toHaveLength(2);

        // First card (indented)
        const firstCard = cards[0];
        const frontField = firstCard.position.fields.get('front');
        const backField = firstCard.position.fields.get('back');

        // Check front field position
        expect(frontField).toEqual({
            startLine: 1,
            startCharacter: 0,
            endLine: 1,
            endCharacter: 19,
            value: 'Indented card'
        });

        // Check back field position
        expect(backField).toEqual({
            startLine: 2,
            startCharacter: 4,
            endLine: 2,
            endCharacter: 24,
            value: 'Indented answer'
        });

        // Second card (non-indented)
        const secondCard = cards[1];
        const secondFrontField = secondCard.position.fields.get('front');
        const secondBackField = secondCard.position.fields.get('back');

        // Check front field position
        expect(secondFrontField).toEqual({
            startLine: 7,
            startCharacter: 0,
            endLine: 7,
            endCharacter: 23,
            value: 'Non-indented card'
        });

        // Check back field position
        expect(secondBackField).toEqual({
            startLine: 8,
            startCharacter: 0,
            endLine: 8,
            endCharacter: 24,
            value: 'Non-indented answer'
        });
    });

    test('maintains correct positions with unicode characters', () => {
        const mdContent = `:::card
front: What is π?
back: 3.14159...
type: basic
:::`;

        const cards = extractMdCardsWithPosition(mdContent);
        const position = cards[0].position;

        // Unicode characters should not affect position calculations
        expect(position.fields.get('front')).toEqual({
            startLine: 1,
            startCharacter: 0,
            endLine: 1,
            endCharacter: 16,
            value: 'What is π?'
        });

        // Verify the actual content matches
        const lines = mdContent.split('\n');
        const frontLine = lines[1];
        expect(frontLine.substring(7)).toBe('What is π?');
    });

    test('handles multiline content with indentation', () => {
        const mdContent = `:::card
    front: First line of front
        Second line of front
        Third line of front
    back: First line of back
        Second line of back
        Third line of back
    type: basic
:::`;

        const cards = extractMdCardsWithPosition(mdContent);
        expect(cards).toHaveLength(1);

        const card = cards[0];
        const frontField = card.position.fields.get('front');
        const backField = card.position.fields.get('back');

        // Check front field position
        expect(frontField).toEqual({
            startLine: 1,
            startCharacter: 0,
            endLine: 3,
            endCharacter: 27,
            value: 'First line of front\n        Second line of front\n        Third line of front'
        });

        // Check back field position
        expect(backField).toEqual({
            startLine: 4,
            startCharacter: 4,
            endLine: 6,
            endCharacter: 26,
            value: 'First line of back\n        Second line of back\n        Third line of back'
        });
    });
}); 