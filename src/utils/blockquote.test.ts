import { describe, it, expect } from 'vitest';
import { toggleBlockquote } from './blockquote';

describe('toggleBlockquote', () => {
    it('should add blockquote to single line', () => {
        expect(toggleBlockquote('hello')).toBe('> hello');
    });

    it('should remove blockquote from single line', () => {
        expect(toggleBlockquote('> hello')).toBe('hello');
    });

    it('should handle empty string', () => {
        expect(toggleBlockquote('')).toBe('');
    });

    it('should handle multiple lines', () => {
        const input = 'line 1\nline 2\nline 3';
        const expected = '> line 1\n> line 2\n> line 3';
        expect(toggleBlockquote(input)).toBe(expected);
    });

    it('should remove blockquotes from all lines when all lines are quoted', () => {
        const input = '> line 1\n> line 2\n> line 3';
        const expected = 'line 1\nline 2\nline 3';
        expect(toggleBlockquote(input)).toBe(expected);
    });

    it('should preserve indentation within blockquotes', () => {
        const input = '    hello\n  world';
        const expected = '>     hello\n>   world';
        expect(toggleBlockquote(input)).toBe(expected);
    });

    it('should handle empty lines when adding blockquotes', () => {
        const input = 'line 1\n\nline 2';
        const expected = '> line 1\n>\n> line 2';
        expect(toggleBlockquote(input)).toBe(expected);
    });

    it('should handle empty lines when removing blockquotes', () => {
        const input = '> line 1\n>\n> line 2';
        const expected = 'line 1\n\nline 2';
        expect(toggleBlockquote(input)).toBe(expected);
    });

    it('should handle mixed quoted and unquoted lines by adding quotes', () => {
        const input = '> line 1\nline 2\n> line 3';
        const expected = '> line 1\n> line 2\n> line 3';
        expect(toggleBlockquote(input)).toBe(expected);
    });

    it('should handle indented blockquotes correctly', () => {
        const input = '>     hello\n>   world';
        const expected = '    hello\n  world';
        expect(toggleBlockquote(input)).toBe(expected);
    });

    it('should handle multiple empty lines', () => {
        const input = 'line 1\n\n\nline 2';
        const expected = '> line 1\n>\n>\n> line 2';
        expect(toggleBlockquote(input)).toBe(expected);
    });

    it('should handle multiple empty lines when removing blockquotes', () => {
        const input = '> line 1\n>\n>\n> line 2';
        const expected = 'line 1\n\n\nline 2';
        expect(toggleBlockquote(input)).toBe(expected);
    });
});
