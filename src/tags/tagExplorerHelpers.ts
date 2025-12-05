/**
 * Tag Explorer Helper functions
 * Extracted for testability
 */

import { Tag } from './tagTypes';

/**
 * Extract tag name from various command argument types
 */
export function extractTagName(
  arg: string | { type: string; tag: Tag } | undefined
): string | undefined {
  if (typeof arg === 'string') {
    return arg;
  } else if (arg && typeof arg === 'object' && 'tag' in arg) {
    return arg.tag.name;
  }
  return undefined;
}

/**
 * Parse remove tag command arguments
 * Handles both (uri, tag) format and serialized tree item format
 */
export interface RemoveTagArgs {
  uriPath: string;
  tag: string;
}

export function parseRemoveTagArgs(
  arg1: unknown,
  arg2?: unknown
): RemoveTagArgs | null {
  // Format 1: Direct call with (uri, tag)
  if (arg1 && typeof arg1 === 'object' && 'fsPath' in arg1 && typeof arg2 === 'string') {
    return {
      uriPath: (arg1 as { fsPath: string }).fsPath,
      tag: arg2,
    };
  }

  // Format 2: Serialized arguments from tree item [uriString, tag]
  if (typeof arg1 === 'string' && typeof arg2 === 'string') {
    return {
      uriPath: arg1,
      tag: arg2,
    };
  }

  // Format 3: Object with uri and tag properties (tree item data)
  if (arg1 && typeof arg1 === 'object') {
    const obj = arg1 as Record<string, unknown>;
    if ('uri' in obj && 'tag' in obj) {
      const uri = obj.uri;
      const tag = obj.tag;
      if (uri && typeof uri === 'object' && 'fsPath' in uri && typeof tag === 'string') {
        return {
          uriPath: (uri as { fsPath: string }).fsPath,
          tag,
        };
      }
    }
  }

  return null;
}

/**
 * Build tooltip text for a tag
 */
export function buildTagTooltip(
  displayName: string,
  fileCount: number,
  customColor?: string
): string {
  const lines = [`${displayName} - ${fileCount} file${fileCount === 1 ? '' : 's'}`];
  if (customColor) {
    lines.push(`Custom color: ${customColor}`);
  }
  lines.push('Click to see files');
  return lines.join('\n');
}

/**
 * Build description text for a tag
 */
export function buildTagDescription(
  fileCount: number,
  customColor?: string
): string {
  const fileCountStr = `${fileCount} file${fileCount === 1 ? '' : 's'}`;
  return customColor ? `${fileCountStr} [${customColor}]` : fileCountStr;
}
