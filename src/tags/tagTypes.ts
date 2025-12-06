/**
 * Type definitions for the tagging system
 */

/**
 * Represents a tracked file with its identity and tags
 */
export interface TaggedFile {
  /** Stable UUID for this tracked file */
  id: string;
  /** Workspace-relative path */
  path: string;

  // Recovery hints for finding moved/renamed files
  /** Just the filename (for search when path fails) */
  filename: string;
  /** File size in bytes */
  fileSize?: number;
  /** Last known modification time (Unix timestamp ms) */
  lastModified?: number;
  /** Content signature for text files (hash of first+last chunks) */
  contentSignature?: string;

  // Tags (stored lowercase for matching)
  tags: string[];

  // Metadata
  /** Last time file was confirmed to exist (Unix timestamp ms) */
  lastSeen?: number;
  /** Current status of the file */
  status: 'ok' | 'missing' | 'moved';
}

/**
 * Represents a tag with its metadata
 */
export interface Tag {
  /** Tag name (lowercase for matching) */
  name: string;
  /** Display name (preserves original casing) */
  displayName: string;
  /** User-set color (CSS color string), null = auto-generate */
  color?: string;
  /** Number of files with this tag (cached for UI) */
  fileCount: number;
}

/**
 * The complete tag database structure
 */
export interface TagDatabase {
  version: number;
  files: { [id: string]: TaggedFile };
  /** Map from lowercase tag name to Tag */
  tags: { [name: string]: Tag };
  /** Map from lowercase tag name to display name (for preserving case) */
  tagDisplayNames: { [name: string]: string };
}

/**
 * Query options for finding files
 */
export interface TagQuery {
  /** OR: has any of these tags */
  anyOf?: string[];
  /** AND: has all of these tags */
  allOf?: string[];
  /** NOT: has none of these tags */
  noneOf?: string[];
  /** Only return untagged files */
  untagged?: boolean;
}

/**
 * Event fired when tags change
 */
export interface TagChangeEvent {
  type: 'add' | 'remove' | 'update' | 'delete-file' | 'reassign';
  fileId?: string;
  filePath?: string;
  tags?: string[];
}

/**
 * File recovery candidate when original path is missing
 */
export interface RecoveryCandidate {
  uri: import('vscode').Uri;
  /** How confident we are this is the right file (0-1) */
  confidence: number;
  /** Why we think this might be the file */
  reason: string;
}

/**
 * Default database structure
 */
export const DEFAULT_TAG_DATABASE: TagDatabase = {
  version: 1,
  files: {},
  tags: {},
  tagDisplayNames: {},
};
