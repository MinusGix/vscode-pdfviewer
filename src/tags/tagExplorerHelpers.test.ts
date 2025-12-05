import { describe, it, expect } from 'vitest';
import {
  extractTagName,
  parseRemoveTagArgs,
  buildTagTooltip,
  buildTagDescription,
} from './tagExplorerHelpers';

describe('tagExplorerHelpers', () => {
  describe('extractTagName', () => {
    it('should extract tag name from string', () => {
      expect(extractTagName('my-tag')).toBe('my-tag');
    });

    it('should extract tag name from TreeItemType object', () => {
      const treeItem = {
        type: 'tag',
        tag: {
          name: 'ml',
          displayName: 'ML',
          fileCount: 5,
        },
      };
      expect(extractTagName(treeItem)).toBe('ml');
    });

    it('should return undefined for undefined input', () => {
      expect(extractTagName(undefined)).toBeUndefined();
    });

    it('should return undefined for invalid object', () => {
      expect(extractTagName({ type: 'other' } as any)).toBeUndefined();
    });
  });

  describe('parseRemoveTagArgs', () => {
    it('should parse uri object and tag string', () => {
      const uri = { fsPath: '/path/to/file.md' };
      const result = parseRemoveTagArgs(uri, 'my-tag');

      expect(result).toEqual({
        uriPath: '/path/to/file.md',
        tag: 'my-tag',
      });
    });

    it('should parse two strings (serialized format)', () => {
      const result = parseRemoveTagArgs('/path/to/file.md', 'my-tag');

      expect(result).toEqual({
        uriPath: '/path/to/file.md',
        tag: 'my-tag',
      });
    });

    it('should parse object with uri and tag properties', () => {
      const obj = {
        uri: { fsPath: '/path/to/file.md' },
        tag: 'my-tag',
      };
      const result = parseRemoveTagArgs(obj);

      expect(result).toEqual({
        uriPath: '/path/to/file.md',
        tag: 'my-tag',
      });
    });

    it('should return null for invalid arguments', () => {
      expect(parseRemoveTagArgs(null)).toBeNull();
      expect(parseRemoveTagArgs(undefined)).toBeNull();
      expect(parseRemoveTagArgs(123)).toBeNull();
      expect(parseRemoveTagArgs({ invalid: 'object' })).toBeNull();
    });
  });

  describe('buildTagTooltip', () => {
    it('should build tooltip without custom color', () => {
      const tooltip = buildTagTooltip('ML', 5);
      expect(tooltip).toBe('ML - 5 files\nClick to see files');
    });

    it('should build tooltip with custom color', () => {
      const tooltip = buildTagTooltip('ML', 5, '#ff0000');
      expect(tooltip).toBe('ML - 5 files\nCustom color: #ff0000\nClick to see files');
    });

    it('should handle singular file count', () => {
      const tooltip = buildTagTooltip('Single', 1);
      expect(tooltip).toBe('Single - 1 file\nClick to see files');
    });

    it('should handle zero files', () => {
      const tooltip = buildTagTooltip('Empty', 0);
      expect(tooltip).toBe('Empty - 0 files\nClick to see files');
    });
  });

  describe('buildTagDescription', () => {
    it('should build description without custom color', () => {
      expect(buildTagDescription(5)).toBe('5 files');
      expect(buildTagDescription(1)).toBe('1 file');
      expect(buildTagDescription(0)).toBe('0 files');
    });

    it('should build description with custom color', () => {
      expect(buildTagDescription(5, '#ff0000')).toBe('5 files [#ff0000]');
      expect(buildTagDescription(1, 'red')).toBe('1 file [red]');
    });
  });
});
