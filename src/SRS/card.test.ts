import { describe, test, expect } from 'vitest';
import { parseMdCard, extractMdCards } from './card';

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

    test('parses card with multiline content using pipe syntax', () => {
        const content = `front: |
  What are the steps to make a cake?
  Please list them in order.
back: |
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

    test('parses card with all optional fields', () => {
        const content = `title: Complex Integration
front: Explain the Residue Theorem
back: |
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
custom_field: |
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