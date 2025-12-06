import { describe, it, expect } from 'vitest';
import {
  generateTagColor,
  getContrastTextColor,
  isValidColor,
  getTagColor,
} from './tagColors';

describe('tagColors', () => {
  describe('generateTagColor', () => {
    it('should generate consistent colors for the same tag', () => {
      const color1 = generateTagColor('ML');
      const color2 = generateTagColor('ML');
      expect(color1).toBe(color2);
    });

    it('should be case insensitive', () => {
      const color1 = generateTagColor('Machine Learning');
      const color2 = generateTagColor('machine learning');
      const color3 = generateTagColor('MACHINE LEARNING');
      expect(color1).toBe(color2);
      expect(color2).toBe(color3);
    });

    it('should generate different colors for different tags', () => {
      const colors = new Set([
        generateTagColor('ML'),
        generateTagColor('Physics'),
        generateTagColor('Economics'),
        generateTagColor('Math'),
        generateTagColor('Biology'),
      ]);
      // All should be unique (statistically very likely)
      expect(colors.size).toBe(5);
    });

    it('should return valid HSL color strings', () => {
      const color = generateTagColor('TestTag');
      expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    });
  });

  describe('getContrastTextColor', () => {
    it('should return black for light backgrounds', () => {
      expect(getContrastTextColor('hsl(0, 50%, 70%)')).toBe('black');
      expect(getContrastTextColor('hsl(120, 50%, 80%)')).toBe('black');
    });

    it('should return white for dark backgrounds', () => {
      expect(getContrastTextColor('hsl(0, 50%, 30%)')).toBe('white');
      expect(getContrastTextColor('hsl(240, 50%, 40%)')).toBe('white');
    });

    it('should handle 6-digit hex colors', () => {
      expect(getContrastTextColor('#ffffff')).toBe('black');
      expect(getContrastTextColor('#000000')).toBe('white');
      expect(getContrastTextColor('#ff0000')).toBe('white'); // Red is dark
    });

    it('should handle 3-digit hex colors', () => {
      expect(getContrastTextColor('#fff')).toBe('black');
      expect(getContrastTextColor('#000')).toBe('white');
      expect(getContrastTextColor('#f00')).toBe('white'); // Red is dark
      expect(getContrastTextColor('#0f0')).toBe('black'); // Green is light
    });

    it('should default to white for unknown formats', () => {
      expect(getContrastTextColor('not-a-color')).toBe('white');
    });
  });

  describe('isValidColor', () => {
    it('should accept valid hex colors', () => {
      expect(isValidColor('#ff0000')).toBe(true);
      expect(isValidColor('#F00')).toBe(true);
      expect(isValidColor('#123abc')).toBe(true);
    });

    it('should accept valid rgb colors', () => {
      expect(isValidColor('rgb(255, 0, 0)')).toBe(true);
      expect(isValidColor('rgb(0, 128, 255)')).toBe(true);
    });

    it('should accept valid hsl colors', () => {
      expect(isValidColor('hsl(120, 50%, 50%)')).toBe(true);
      expect(isValidColor('hsl(0, 100%, 25%)')).toBe(true);
    });

    it('should accept named colors', () => {
      expect(isValidColor('red')).toBe(true);
      expect(isValidColor('Blue')).toBe(true);
      expect(isValidColor('CYAN')).toBe(true);
    });

    it('should reject invalid colors', () => {
      expect(isValidColor('not-a-color')).toBe(false);
      expect(isValidColor('#gggggg')).toBe(false);
      expect(isValidColor('')).toBe(false);
    });
  });

  describe('getTagColor', () => {
    it('should return custom color if valid', () => {
      expect(getTagColor('ML', '#ff0000')).toBe('#ff0000');
      expect(getTagColor('ML', 'red')).toBe('red');
    });

    it('should return generated color if custom is invalid', () => {
      const generated = generateTagColor('ML');
      expect(getTagColor('ML', 'invalid')).toBe(generated);
      expect(getTagColor('ML', '')).toBe(generated);
    });

    it('should return generated color if no custom provided', () => {
      const generated = generateTagColor('Physics');
      expect(getTagColor('Physics')).toBe(generated);
      expect(getTagColor('Physics', undefined)).toBe(generated);
    });
  });
});
