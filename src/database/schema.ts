/**
 * SQLite schema definitions for the Lattice database
 */

/**
 * Current schema version. Increment when making breaking changes.
 */
export const SCHEMA_VERSION = 1;

/**
 * Core schema SQL statements
 */
export const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_info (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Files table: tracked files with identity hints
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  file_size INTEGER,
  last_modified INTEGER,
  content_signature TEXT,
  last_seen INTEGER,
  status TEXT CHECK(status IN ('ok', 'missing', 'moved')) DEFAULT 'ok',
  created_at INTEGER NOT NULL
);

-- Tags table: tag definitions with hierarchy support
CREATE TABLE IF NOT EXISTS tags (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  color TEXT,
  parent_tag TEXT REFERENCES tags(name),
  visibility TEXT CHECK(visibility IN ('normal', 'shadow', 'hidden')) DEFAULT 'normal',
  shadowed_by TEXT REFERENCES tags(name),
  created_at INTEGER NOT NULL
);

-- Tag aliases: alternative names that resolve to primary tags
CREATE TABLE IF NOT EXISTS tag_aliases (
  alias TEXT PRIMARY KEY,
  primary_tag TEXT NOT NULL REFERENCES tags(name) ON DELETE CASCADE
);

-- Tag instances: junction table with support for parent linking and metadata
CREATE TABLE IF NOT EXISTS tag_instances (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL REFERENCES tags(name) ON DELETE CASCADE,
  parent_instance_id TEXT REFERENCES tag_instances(id) ON DELETE SET NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

-- Folder rules: tag inheritance for folders
CREATE TABLE IF NOT EXISTS folder_rules (
  folder_path TEXT PRIMARY KEY,
  inherited_tags TEXT NOT NULL,
  recursive INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Folder auto-tags: automatic tagging when files appear in folders
CREATE TABLE IF NOT EXISTS folder_auto_tags (
  id TEXT PRIMARY KEY,
  folder_pattern TEXT NOT NULL,
  tags_to_apply TEXT NOT NULL,
  template_id TEXT,
  conditions TEXT,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- View modes: different visibility configurations
CREATE TABLE IF NOT EXISTS view_modes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Tag templates: presets for quick tag application
CREATE TABLE IF NOT EXISTS tag_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tags_to_add TEXT NOT NULL,
  tags_to_remove TEXT,
  shortcut TEXT,
  conditions TEXT,
  created_at INTEGER NOT NULL
);

-- SRS Cards: flashcard review state (migrated from lattice.cards.json)
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  file_path TEXT,
  fsrs_state TEXT NOT NULL,
  last_review_date TEXT,
  deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Document metadata: titles and custom data (migrated from Memento)
CREATE TABLE IF NOT EXISTS document_metadata (
  uri TEXT PRIMARY KEY,
  title TEXT,
  custom_data TEXT
);

-- Notes associations: PDF to notes file mappings (migrated from settings)
CREATE TABLE IF NOT EXISTS notes_associations (
  pdf_path TEXT PRIMARY KEY,
  notes_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- File tag exclusions: inherited tags explicitly excluded per file
CREATE TABLE IF NOT EXISTS file_tag_exclusions (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL,
  PRIMARY KEY (file_id, tag_name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_files_filename ON files(filename);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
CREATE INDEX IF NOT EXISTS idx_tag_instances_file ON tag_instances(file_id);
CREATE INDEX IF NOT EXISTS idx_tag_instances_tag ON tag_instances(tag_name);
CREATE INDEX IF NOT EXISTS idx_tag_instances_parent ON tag_instances(parent_instance_id);
CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_tag);
CREATE INDEX IF NOT EXISTS idx_tags_visibility ON tags(visibility);
CREATE INDEX IF NOT EXISTS idx_cards_deleted ON cards(deleted);
`;

/**
 * SQL to drop all tables (for testing/reset)
 */
export const DROP_ALL_SQL = `
DROP TABLE IF EXISTS file_tag_exclusions;
DROP TABLE IF EXISTS notes_associations;
DROP TABLE IF EXISTS document_metadata;
DROP TABLE IF EXISTS cards;
DROP TABLE IF EXISTS tag_templates;
DROP TABLE IF EXISTS view_modes;
DROP TABLE IF EXISTS folder_auto_tags;
DROP TABLE IF EXISTS folder_rules;
DROP TABLE IF EXISTS tag_instances;
DROP TABLE IF EXISTS tag_aliases;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS schema_info;
`;

