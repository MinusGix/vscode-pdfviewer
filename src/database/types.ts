/**
 * TypeScript types for the Lattice database entities
 */

/**
 * File record in the database
 */
export interface DbFile {
  id: string;
  path: string;
  filename: string;
  file_size: number | null;
  last_modified: number | null;
  content_signature: string | null;
  last_seen: number | null;
  status: 'ok' | 'missing' | 'moved';
  created_at: number;
}

/**
 * Tag record in the database
 */
export interface DbTag {
  name: string;
  display_name: string;
  color: string | null;
  parent_tag: string | null;
  visibility: 'normal' | 'shadow' | 'hidden';
  shadowed_by: string | null;
  created_at: number;
}

/**
 * Tag alias record
 */
export interface DbTagAlias {
  alias: string;
  primary_tag: string;
}

/**
 * Tag instance - a specific application of a tag to a file
 */
export interface DbTagInstance {
  id: string;
  file_id: string;
  tag_name: string;
  parent_instance_id: string | null;
  metadata: string | null; // JSON string
  created_at: number;
}

/**
 * Parsed tag instance with deserialized metadata
 */
export interface TagInstanceWithMetadata extends Omit<DbTagInstance, 'metadata'> {
  metadata: Record<string, unknown> | null;
}

/**
 * Folder rule for tag inheritance
 */
export interface DbFolderRule {
  folder_path: string;
  inherited_tags: string; // JSON array
  recursive: number; // SQLite boolean
  priority: number;
  created_at: number;
}

/**
 * Parsed folder rule
 */
export interface FolderRule {
  folderPath: string;
  inheritedTags: string[];
  recursive: boolean;
  priority: number;
  createdAt: number;
}

/**
 * Folder auto-tag rule
 */
export interface DbFolderAutoTag {
  id: string;
  folder_pattern: string;
  tags_to_apply: string; // JSON array
  template_id: string | null;
  conditions: string | null; // JSON
  enabled: number; // SQLite boolean
  created_at: number;
}

/**
 * Parsed folder auto-tag rule
 */
export interface FolderAutoTagRule {
  id: string;
  folderPattern: string;
  tagsToApply: string[];
  templateId: string | null;
  conditions: TagExpression | null;
  enabled: boolean;
  createdAt: number;
}

/**
 * View mode configuration
 */
export interface DbViewMode {
  id: string;
  name: string;
  config: string; // JSON blob
  is_active: number; // SQLite boolean
  created_at: number;
}

/**
 * Parsed view mode
 */
export interface ViewMode {
  id: string;
  name: string;
  hiddenTags: string[];
  hiddenTagNamespaces: string[];
  excludeFilesWithTags: string[];
  requireFilesWithTags: string[];
  hiddenTagsSearchable: boolean;
  showFilterIndicator: boolean;
}

/**
 * Tag template for quick application
 */
export interface DbTagTemplate {
  id: string;
  name: string;
  description: string | null;
  tags_to_add: string; // JSON array
  tags_to_remove: string | null; // JSON array
  shortcut: string | null;
  conditions: string | null; // JSON
  created_at: number;
}

/**
 * Parsed tag template
 */
export interface TagTemplate {
  id: string;
  name: string;
  description: string | null;
  tagsToAdd: string[];
  tagsToRemove: string[];
  shortcut: string | null;
  conditions: TagExpression | null;
  createdAt: number;
}

/**
 * SRS Card record
 */
export interface DbCard {
  id: string;
  file_path: string | null;
  fsrs_state: string; // JSON blob
  last_review_date: string | null;
  deleted: number; // SQLite boolean
  created_at: number;
}

/**
 * Document metadata record
 */
export interface DbDocumentMetadata {
  uri: string;
  title: string | null;
  custom_data: string | null; // JSON
}

/**
 * Notes association record
 */
export interface DbNotesAssociation {
  pdf_path: string;
  notes_path: string;
  created_at: number;
}

/**
 * File tag exclusion record
 */
export interface DbFileTagExclusion {
  file_id: string;
  tag_name: string;
}

/**
 * Tag expression for conditions (used in smart tags, auto-tagging, etc.)
 */
export type TagExpression =
  | { type: 'modified-within'; days: number }
  | { type: 'larger-than'; bytes: number }
  | { type: 'has-tag'; tag: string }
  | { type: 'missing-tag'; tag: string }
  | { type: 'in-folder'; pattern: string }
  | { type: 'filename-matches'; pattern: string }
  | { type: 'extension'; ext: string }
  | { type: 'and'; exprs: TagExpression[] }
  | { type: 'or'; exprs: TagExpression[] }
  | { type: 'not'; expr: TagExpression };

/**
 * Schema info key-value pair
 */
export interface DbSchemaInfo {
  key: string;
  value: string;
}

/**
 * Result of a file query with its tags
 */
export interface FileWithTags extends DbFile {
  tags: string[];
  tagInstances: TagInstanceWithMetadata[];
}

/**
 * Result of a tag query with file count
 */
export interface TagWithCount extends DbTag {
  fileCount: number;
}

/**
 * Tag hierarchy node for tree display
 */
export interface TagHierarchyNode {
  tag: DbTag;
  children: TagHierarchyNode[];
  /** Files directly tagged with this tag */
  fileCount: number;
  /** Files tagged with this tag or any descendant */
  totalFileCount: number;
}

/**
 * Migration source data (from JSON files)
 */
export interface MigrationSource {
  tagsJson?: {
    version: number;
    files: Record<string, {
      id: string;
      path: string;
      filename: string;
      fileSize?: number;
      lastModified?: number;
      contentSignature?: string;
      tags: string[];
      lastSeen?: number;
      status: 'ok' | 'missing' | 'moved';
    }>;
    tags: Record<string, {
      name: string;
      displayName: string;
      color?: string;
      fileCount: number;
    }>;
    tagDisplayNames: Record<string, string>;
  };
  cardsJson?: Array<{
    cardId: string;
    fsrsCard: unknown;
    lastReviewDate?: string;
    deleted?: boolean;
  }>;
  documentTitles?: Record<string, string>;
  notesAssociations?: Record<string, string>;
}

