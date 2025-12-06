# Advanced Tagging System Design

## Overview

This document explores advanced tagging features for Lattice, moving beyond simple flat tags toward a flexible, powerful system suitable for organizing diverse content: notes, papers, images, websites, and more.

**Design Philosophy:**
- SQLite-based storage (single file, ACID transactions, scales to millions)
- JSON export for backup/portability
- Graceful degradation (advanced features optional)
- Performance at scale (100K+ files, millions of tag associations)
- Corruption resistance (SQLite WAL mode, automatic backups)

---

## Key Decisions (Resolved)

| Decision              | Choice                    | Rationale                                          |
| --------------------- | ------------------------- | -------------------------------------------------- |
| Storage backend       | **SQLite**                | ACID, scales, single file, handles complex queries |
| Git-friendliness      | **JSON export option**    | Accept SQLite isn't diffable; provide export       |
| View mode scope       | **Per-workspace**         | Monolithic notes folder use case                   |
| Hierarchy separator   | **`::`** (display as `→`) | Avoids path conflicts                              |
| Collaborative tagging | **Skip for v1**           | Complexity vs. value                               |

---

## Feature Analysis

### 1. Folder Tag Inheritance

**What:** Files automatically inherit tags from their parent folders.

**Why it's useful:**
- Leverages existing folder organization
- Reduces manual tagging for well-organized content
- Natural for project-based workflows (`/ML/Papers/` → all files get `ML` and `Papers` tags)

**Design Considerations:**

```typescript
interface FolderTagRule {
  folderPath: string;           // Workspace-relative path
  inheritedTags: string[];      // Tags applied to all files in this folder
  recursive: boolean;           // Apply to subfolders?
  priority: number;             // For conflict resolution
}

// Storage: separate from file tags for clarity
interface TagDatabase {
  // ... existing fields ...
  folderRules: { [folderPath: string]: FolderTagRule };
}
```

**UI Implications:**
- Show inherited tags differently (dimmed, with folder icon, or separate section)
- "Effective tags" = explicit tags + inherited tags
- Allow override: file can explicitly remove an inherited tag
- Folder context menu: "Add tag to folder..."

**Edge Cases:**
- Nested folders: deepest wins? Accumulate all? (Recommend: accumulate with override)
- Moving files: inherited tags change automatically (feature, not bug)
- Renaming folders: rules need path update or use folder ID

**Recommendation:** Implement this - it's high value, moderate complexity. Use a simple recursive inheritance model with explicit overrides.

---

### 2. Multi-Select Tag Operations

**What:** Select multiple files and add/remove tags in one operation.

**Why it's useful:**
- Essential for batch organization
- Import workflows (tag 50 downloaded papers at once)
- Reorganization tasks

**Implementation Approaches:**

1. **File Explorer Integration:**
   - VS Code doesn't expose multi-select context menu well
   - Workaround: Custom "Tag Selected Files" command that reads `explorer.selection`

2. **Tag Explorer Integration:**
   - When viewing a tag's files, allow multi-select within that view
   - Drag multiple files onto a tag in the sidebar

3. **Quick Pick with Multi-Select:**
   ```
   [Search files...                    ]
   ☑ notes/ml-basics.md
   ☑ papers/transformer.pdf
   ☐ papers/attention.pdf
   ☑ images/diagram.png
   
   [Apply] [Cancel]
   ```

**Recommendation:** High priority. Start with command palette approach, then enhance with drag-drop.

---

### 3. Tag Hierarchies

**What:** Nested tags like `Programming/Python/Django` where `Django` implies `Python` implies `Programming`.

**Why it's useful:**
- Natural categorization
- Flexible filtering (show all `Programming/*` or just `Django`)
- Avoids tag explosion while maintaining specificity

**Design Options:**

**Option A: Explicit Parent-Child Relationships**
```typescript
interface HierarchicalTag extends Tag {
  parent?: string;        // Parent tag name (lowercase)
  children?: string[];    // Cached for quick lookup
}

// Example:
// "python" has parent "programming"
// "django" has parent "python"
```

**Option B: Path-Based Naming Convention**
```typescript
// Tags are stored with "/" separator
// "programming/python/django"
// UI shows only "Django" but understands hierarchy

interface Tag {
  name: string;           // "programming/python/django"
  displayName: string;    // "Django" (leaf)
  fullDisplayPath: string; // "Programming > Python > Django"
}
```

**Option C: Hybrid (Recommended)**
- Tags are flat internally (for search performance)
- Hierarchy is metadata layer
- User sees hierarchy in UI, system stores relationships

```typescript
interface TagHierarchy {
  // Map from child tag to parent tag
  parents: { [childTag: string]: string };
  // Cached: map from parent to all descendants
  descendants: { [parentTag: string]: string[] };
}
```

**Display Behavior:**
- **Collapsed view (default):** Show most specific tag only ("Django")
- **Expanded view:** Show full path or breadcrumb ("Programming > Python > Django")
- **Filtering:** Selecting parent shows all descendants
- **Colors:** Inherit from root? Override at any level? (Setting)

**Recommendation:** Implement with Option C (hybrid). Start simple - just parent relationships, derive hierarchy. Display most specific tag with hover showing full path.

---

### 4. Shadow Tags (Aliases/Hidden Tags)

**What:** Alternative names for tags that work in search but don't display prominently.

**Use Cases:**
- Synonyms: "ML" shadows "machine-learning"
- Alternate spellings: "colour" shadows "color"  
- Import cleanup: AI-generated verbose tags shadow cleaner manual ones
- Image tagging: multiple terms for same concept

**Design:**

```typescript
interface Tag {
  // ... existing fields ...
  aliases: string[];              // Shadow tags that resolve to this tag
  shadowedBy?: string;            // If this tag is hidden, which tag shows instead
  visibility: 'normal' | 'shadow' | 'hidden';
}

// Example:
// Tag "machine-learning" has aliases ["ml", "deep-learning", "neural-networks"]
// When user searches "ml", finds files tagged with "machine-learning"
// Display always shows "Machine Learning", never the alias
```

**Behavior:**
- Adding alias tag → actually adds the primary tag
- Search matches any alias
- Export/display shows primary tag only
- Alias → Primary resolution happens at query time

**UI:**
- Tag settings panel to manage aliases
- Import wizard: "These tags were found. Map to existing or create new?"
- Alias indicator in tag management view

**Recommendation:** Valuable feature, especially for imports. Implement after core hierarchy.

---

### 5. Structured/Qualified Tags

**What:** Tags with context/qualifiers like `character:male > hair:black` or `artist:monet`.

**Inspiration:** Danbooru-style namespaced tags, Hydrus tag namespaces.

**Key Requirement:** Some structured tags need to be **repeated** on the same file. Example: an image with multiple characters, each with their own attributes (`character:alice > hair:blonde`, `character:bob > hair:black`).

**Design: Tag Instances with Metadata**

```typescript
// A tag can be applied multiple times with different context/metadata
interface TagInstance {
  id: string;              // Unique instance ID
  fileId: string;          // Which file this is on
  tagName: string;         // The tag (lowercase)
  
  // Optional: Parent context for structured tags
  parentInstanceId?: string;  // Links to another TagInstance on same file
  // e.g., "black_hair" instance links to "male" instance
  
  // Optional: Arbitrary metadata per instance
  metadata?: Record<string, unknown>;  // JSON blob
  // Examples:
  // - AI bbox: { "bbox": [100, 200, 300, 400], "confidence": 0.95 }
  // - Character details: { "expression": "smiling" }
  // - Source info: { "page": 42, "paragraph": 3 }
}

// SQL Schema
CREATE TABLE tag_instances (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id),
  tag_name TEXT NOT NULL REFERENCES tags(name),
  parent_instance_id TEXT REFERENCES tag_instances(id),
  metadata TEXT,  -- JSON blob, nullable
  created_at INTEGER NOT NULL,
  UNIQUE(file_id, tag_name, parent_instance_id)  -- Can repeat with different parents
);
```

**Metadata Tag Rendering:**
- Normal display: Show tag name only ("Black Hair")
- Hover/detail view: Show metadata if present
- Metadata with `hidden: true` doesn't render in normal views
- Search can query metadata: `character:* WHERE metadata.bbox IS NOT NULL`

**Use Cases:**
```typescript
// Image with two characters
{
  instances: [
    { id: "i1", tag: "male", metadata: { name: "Character A" } },
    { id: "i2", tag: "black_hair", parentInstanceId: "i1" },
    { id: "i3", tag: "female", metadata: { name: "Character B" } },
    { id: "i4", tag: "blonde_hair", parentInstanceId: "i3" },
    { id: "i5", tag: "black_hair", parentInstanceId: "i3" },  // Different character!
  ]
}

// AI-generated bounding boxes
{
  instances: [
    { id: "i1", tag: "person", metadata: { bbox: [10, 20, 100, 200], confidence: 0.92 } },
    { id: "i2", tag: "person", metadata: { bbox: [150, 30, 250, 210], confidence: 0.87 } },
  ]
}
```

**Recommendation:** Implement TagInstance model with optional parent linking and metadata. This handles both structured tags AND repeating tags AND AI annotation data elegantly.

---

### 6. View Modes (Tag/Content Filtering)

**What:** Different "modes" that filter what tags and/or files are visible.

**Use Cases:**
- SFW mode: Hide suggestive tags from display
- Work mode: Hide personal tags/files
- Focus mode: Show only project-relevant tags
- Archive mode: Show/hide archived content

**Design:**

```typescript
interface ViewMode {
  id: string;
  name: string;
  description?: string;
  
  // Tag visibility
  hiddenTags: string[];           // Tags not shown in UI (but still searchable?)
  hiddenTagNamespaces?: string[]; // e.g., hide all "nsfw:*" tags
  
  // File visibility  
  excludeFilesWithTags: string[]; // Files with these tags are hidden
  requireFilesWithTags?: string[]; // Only show files with ALL these tags
  
  // UI customization
  hiddenTagsSearchable: boolean;  // Can still find via search?
  showFilterIndicator: boolean;   // Show "Filtered" badge
}

interface TagDatabase {
  // ... existing ...
  viewModes: { [id: string]: ViewMode };
  activeViewMode?: string;
}
```

**Behavior:**
- Mode affects Tag Explorer display
- Mode affects file list when browsing by tag
- Search can optionally respect mode or search everything
- Keyboard shortcut to toggle modes
- Status bar indicator showing active mode

**UI:**
- Mode selector in Tag Explorer header
- Quick toggle in command palette
- Mode editor in settings

**Security Note:** This is UI filtering, not access control. Files still exist and could be found via VS Code's search. For true hiding, files would need to be encrypted or stored separately.

**Recommendation:** Useful for organization. Implement as a UI filter layer on top of existing tag system. Start with just file filtering (`excludeFilesWithTags`), add tag hiding later.

---

### 7. Unified SQLite Database

**Decision:** Use SQLite as the single storage backend for all Lattice data.

**Current Lattice Storage (to migrate):**
| Feature           | Current Storage  | Location                         |
| ----------------- | ---------------- | -------------------------------- |
| Tags              | JSON file        | `.vscode/lattice.tags.json`      |
| SRS Cards         | JSON file        | `.vscode/lattice.cards.json`     |
| Notes Association | VS Code settings | `lattice.associatedNotes` config |
| Document Titles   | VS Code Memento  | Extension storage                |

**New Unified Storage:** `.vscode/lattice.db` (SQLite)

**Why SQLite:**
- ACID transactions (corruption resistant)
- Handles millions of rows efficiently
- Complex queries (JOIN tags with cards, etc.)
- Single file, no server required
- WAL mode for concurrent reads
- FTS5 for full-text search (future)

**Trade-off Accepted:** Binary format means git diffs aren't useful. Mitigation: JSON export command for backup/sharing.

**Schema Design:**

```sql
-- Core tables
CREATE TABLE files (
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

CREATE TABLE tags (
  name TEXT PRIMARY KEY,  -- lowercase
  display_name TEXT NOT NULL,
  color TEXT,
  parent_tag TEXT REFERENCES tags(name),  -- hierarchy
  visibility TEXT CHECK(visibility IN ('normal', 'shadow', 'hidden')) DEFAULT 'normal',
  shadowed_by TEXT REFERENCES tags(name),  -- for aliases
  created_at INTEGER NOT NULL
);

CREATE TABLE tag_aliases (
  alias TEXT PRIMARY KEY,
  primary_tag TEXT NOT NULL REFERENCES tags(name)
);

CREATE TABLE tag_instances (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL REFERENCES tags(name),
  parent_instance_id TEXT REFERENCES tag_instances(id),
  metadata TEXT,  -- JSON
  created_at INTEGER NOT NULL
);

CREATE TABLE folder_rules (
  folder_path TEXT PRIMARY KEY,
  inherited_tags TEXT NOT NULL,  -- JSON array
  recursive INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0
);

CREATE TABLE view_modes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT NOT NULL,  -- JSON blob
  is_active INTEGER DEFAULT 0
);

-- SRS Cards (migrated from lattice.cards.json)
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  file_path TEXT,
  fsrs_state TEXT NOT NULL,  -- JSON: FSRS card state
  last_review_date TEXT,
  deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Document metadata (migrated from Memento)
CREATE TABLE document_metadata (
  uri TEXT PRIMARY KEY,
  title TEXT,
  custom_data TEXT  -- JSON for future extensibility
);

-- Notes associations (migrated from settings)
CREATE TABLE notes_associations (
  pdf_path TEXT PRIMARY KEY,
  notes_path TEXT NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_files_path ON files(path);
CREATE INDEX idx_files_filename ON files(filename);
CREATE INDEX idx_tag_instances_file ON tag_instances(file_id);
CREATE INDEX idx_tag_instances_tag ON tag_instances(tag_name);
CREATE INDEX idx_tags_parent ON tags(parent_tag);
CREATE INDEX idx_cards_due ON cards(json_extract(fsrs_state, '$.due'));
```

**Migration Strategy:**
1. On extension activation, check for existing JSON files
2. If found and no SQLite DB exists, run migration
3. Create SQLite DB, import all data
4. Keep JSON files as backup (rename to `.bak`)
5. Future: Only use SQLite

**Library Choice:** `better-sqlite3` (synchronous, fast, native)
- Bundled with extension via esbuild
- Fallback: `sql.js` for web/WASM environments

**Performance Optimizations:**
1. **WAL mode:** Concurrent reads during writes
2. **Prepared statements:** Reuse for frequent queries
3. **Batch operations:** Wrap bulk changes in transactions
4. **Connection pooling:** Single connection, careful with async
5. **Virtualized lists:** Tag Explorer uses pagination
6. **Lazy file status:** Check file existence on demand, cache results

---

### 8. Data Integrity & Corruption Prevention

**Risks:**
- Crash during write = corrupted JSON
- Concurrent access (multiple VS Code windows)
- Sync conflicts (Syncthing/Git)
- User accidentally edits file

**Mitigations:**

```typescript
// Atomic writes
async function saveDatabase(db: TagDatabase): Promise<void> {
  const tempPath = dbPath + '.tmp';
  const backupPath = dbPath + '.bak';
  
  // 1. Write to temp file
  await fs.writeFile(tempPath, JSON.stringify(db, null, 2));
  
  // 2. Validate temp file is valid JSON
  const validation = JSON.parse(await fs.readFile(tempPath));
  if (!isValidTagDatabase(validation)) {
    throw new Error('Database validation failed');
  }
  
  // 3. Backup existing file
  if (await fs.exists(dbPath)) {
    await fs.copyFile(dbPath, backupPath);
  }
  
  // 4. Atomic rename
  await fs.rename(tempPath, dbPath);
}
```

**Backup Strategy:**
```typescript
interface BackupConfig {
  keepBackups: number;          // Number of backups to retain (default: 5)
  backupOnSignificantChange: boolean;  // Auto-backup before big operations
  backupInterval?: number;      // Minutes between auto-backups
}

// Backup naming: lattice.tags.bak.1, lattice.tags.bak.2, etc.
// Or timestamped: lattice.tags.2024-01-15T14-30-00.bak
```

**Sync Conflict Resolution:**
- Detect conflicts (file changed externally)
- Merge strategy: union of tags (additive), prompt for deletions
- Show notification: "Tag database updated externally. Reload?"

**Validation:**
```typescript
function isValidTagDatabase(obj: unknown): obj is TagDatabase {
  if (!obj || typeof obj !== 'object') return false;
  const db = obj as Record<string, unknown>;
  
  // Check version
  if (typeof db.version !== 'number') return false;
  
  // Check files structure
  if (!db.files || typeof db.files !== 'object') return false;
  
  // Validate each file entry
  for (const file of Object.values(db.files as object)) {
    if (!isValidTaggedFile(file)) return false;
  }
  
  // ... more validation
  return true;
}
```

**Recommendation:** Implement atomic writes + rolling backups immediately. This is essential for user trust.

---

## Additional Features to Consider

### 9. Smart/Dynamic Tags & Auto-Tagging

Tags that auto-update based on rules, plus automatic tagging for new files.

**Smart Tags (Computed):**
```typescript
interface SmartTag {
  name: string;
  displayName: string;
  rule: TagExpression;  // See expression system below
  refreshOn: 'manual' | 'file-open' | 'file-change' | 'schedule';
  cacheResults: boolean;  // For expensive queries
}

// Examples:
// "recent" = files modified in last 7 days
// "large-files" = files > 10MB
// "unread-papers" = PDFs without "read" tag
// "needs-review" = files with tag "draft" AND modified > 7 days ago
```

**Folder Auto-Tagging (On File Add):**
```typescript
interface FolderAutoTag {
  folderPattern: string;   // Glob: "ML/**", "Papers/*.pdf"
  tagsToApply: string[];   // Tags added when file appears
  templateId?: string;     // Or use a tag template
  conditions?: TagExpression;  // Optional: only if condition met
}

// SQL Table
CREATE TABLE folder_auto_tags (
  id TEXT PRIMARY KEY,
  folder_pattern TEXT NOT NULL,
  tags_to_apply TEXT NOT NULL,  -- JSON array
  template_id TEXT REFERENCES tag_templates(id),
  conditions TEXT,  -- JSON expression
  enabled INTEGER DEFAULT 1
);
```

**Expression System (for Smart Tags & Conditions):**

Need a simple expression language for rules. Options:

**Option A: Predefined Rule Types**
```typescript
type TagExpression = 
  | { type: 'modified-within', days: number }
  | { type: 'larger-than', bytes: number }
  | { type: 'has-tag', tag: string }
  | { type: 'missing-tag', tag: string }
  | { type: 'in-folder', pattern: string }
  | { type: 'filename-matches', pattern: string }
  | { type: 'extension', ext: string }
  | { type: 'and', exprs: TagExpression[] }
  | { type: 'or', exprs: TagExpression[] }
  | { type: 'not', expr: TagExpression };
```

**Option B: SQL-like DSL**
```
modified < 7d AND NOT has_tag("read") AND extension = ".pdf"
```

**Option C: JSON Query (MongoDB-style)**
```json
{
  "$and": [
    { "modified": { "$gt": "-7d" } },
    { "tags": { "$nin": ["read"] } },
    { "extension": ".pdf" }
  ]
}
```

**Recommendation:** Start with Option A (type-safe, easier to build UI). Add Option B parser later for power users. The expression system can be reused for:
- Smart tags
- Folder auto-tagging conditions
- View mode file filtering
- Combined search queries

### 10. Tag Statistics & Analytics

Track tag usage over time:

```typescript
interface TagStats {
  tag: string;
  filesAdded: { date: string; count: number }[];
  filesRemoved: { date: string; count: number }[];
  firstUsed: number;
  lastUsed: number;
}

// "What have I been working on this week?"
// "Show me my most-used tags"
// "When did I last touch anything tagged 'thesis'?"
```

### 11. Import/Export & Interoperability

```typescript
interface TagExport {
  format: 'lattice-json' | 'csv' | 'yaml-frontmatter';
  includeMetadata: boolean;
  relativePaths: boolean;
}

// CSV export for spreadsheet analysis
// YAML frontmatter export to embed tags in markdown files
// Import from other systems (Zotero, etc.)
```

### 12. Tag Templates/Presets

Quick-apply multiple tags:

```typescript
interface TagTemplate {
  id: string;
  name: string;
  description?: string;
  tagsToAdd: string[];
  tagsToRemove?: string[];  // Optional: remove these when applying
  shortcut?: string;        // Keyboard shortcut
  conditions?: TagExpression;  // Optional: only show/apply if condition met
}

// Examples:
// "New ML Paper" → adds ["ml", "paper", "unread", "to-annotate"]
// "Mark Read"    → adds ["read"], removes ["unread", "to-read"]
// "Archive"      → adds ["archived"], removes ["active", "urgent", "wip"]

// SQL Table
CREATE TABLE tag_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tags_to_add TEXT NOT NULL,    -- JSON array
  tags_to_remove TEXT,          -- JSON array
  shortcut TEXT,
  conditions TEXT,              -- JSON expression
  created_at INTEGER NOT NULL
);
```

**Integration with Folder Auto-Tagging:**

Templates can be referenced by folder auto-tag rules:

```typescript
// When PDF copied to ML folder, apply "New ML Paper" template
{
  folderPattern: "ML/**/*.pdf",
  templateId: "new-ml-paper",  // References template above
}

// Equivalent to:
{
  folderPattern: "ML/**/*.pdf",
  tagsToApply: ["ml", "paper", "unread", "to-annotate"],
}
```

This keeps tag presets DRY and allows updating a template to affect all folder rules using it.

### 13. Collaborative Tagging

For shared workspaces:

- Per-user tag namespaces: `@alice:important` vs `@bob:important`
- Shared vs personal tags
- Tag suggestions from collaborators

### 14. Full-Text Search Integration & Unified Query System

Combine tag filtering with content search using a unified expression system:

```typescript
interface CombinedQuery {
  tags: TagQuery;
  text?: string;        // Full-text search within tagged files
  path?: string;        // Path glob pattern
  dateRange?: { after?: Date; before?: Date };
}

// "Find all ML papers mentioning 'transformer' from 2023"
```

**Unified Expression System:**

The `TagExpression` type (from Smart Tags) can be reused across:

| Feature         | Uses Expression For              |
| --------------- | -------------------------------- |
| Smart Tags      | Defining which files match       |
| Folder Auto-Tag | Conditions for when to apply     |
| View Modes      | File filtering rules             |
| Combined Search | Complex query building           |
| Tag Templates   | Conditional template application |

```typescript
// Single expression evaluator, multiple use cases
class ExpressionEvaluator {
  constructor(private db: LatticeDatabase) {}
  
  async matchesFile(expr: TagExpression, fileId: string): Promise<boolean>;
  async findMatchingFiles(expr: TagExpression): Promise<string[]>;
  
  // Compile to SQL WHERE clause for efficient DB queries
  toSqlWhere(expr: TagExpression): { sql: string; params: unknown[] };
}

// Example: Smart tag "unread-papers"
const expr: TagExpression = {
  type: 'and',
  exprs: [
    { type: 'extension', ext: '.pdf' },
    { type: 'missing-tag', tag: 'read' },
    { type: 'has-tag', tag: 'paper' }
  ]
};

// Same expression used in:
// 1. Smart tag definition
// 2. "Find files matching..." search
// 3. View mode filter
// 4. Auto-tag condition
```

**Future: DSL Parser**
```
# Human-readable syntax (parsed to TagExpression)
extension:.pdf AND NOT tag:read AND tag:paper
modified:<7d AND (tag:draft OR tag:wip)
folder:"ML/*" AND size:>1MB
```

---

## Implementation Roadmap

### Phase 1: SQLite Foundation (Do First)
- [ ] Add `better-sqlite3` dependency, configure esbuild bundling
- [ ] Create `LatticeDatabase` class (connection, schema, migrations)
- [ ] Implement schema from Section 7
- [ ] Migration: import existing `lattice.tags.json`
- [ ] Migration: import existing `lattice.cards.json`  
- [ ] Migration: import document titles from Memento
- [ ] Migration: import notes associations from settings
- [ ] JSON export command for backup
- [ ] Automatic backup before migrations

### Phase 2: Adapt Existing Features
- [ ] Update `TagManager` to use SQLite
- [ ] Update `CardReviewState` to use SQLite
- [ ] Update `DocumentTitleManager` to use SQLite
- [ ] Update `NotesAssociationManager` to use SQLite
- [ ] Remove old JSON/Memento code paths
- [ ] Performance testing with large datasets

### Phase 3: Bulk Operations
- [ ] Multi-select tagging in Tag Explorer
- [ ] Command: "Tag files matching pattern..."
- [ ] Import from folder (scan and suggest tags)
- [ ] Tag templates (quick-apply presets)

### Phase 4: Tag Hierarchy & Aliases
- [ ] Parent-child tag relationships in DB
- [ ] Display: show leaf tag, tooltip shows full path
- [ ] Filter: select parent = show all descendants
- [ ] Shadow tags / aliases
- [ ] Tag alias resolution in queries

### Phase 5: Folder Rules & Auto-Tagging
- [ ] Folder inheritance rules (files inherit folder tags)
- [ ] Folder auto-tagging (new files get tags automatically)
- [ ] "Un-inherit" mechanism (exclude specific inherited tags)
- [ ] UI for managing folder rules

### Phase 6: Advanced Features
- [ ] Tag instances with metadata (for AI bboxes, etc.)
- [ ] Structured/qualified tags with parent linking
- [ ] Expression system for conditions
- [ ] Smart/dynamic tags

### Phase 7: View Modes
- [ ] Define custom view modes (per-workspace)
- [ ] Mode: file filtering by tag
- [ ] Mode: tag visibility filtering
- [ ] Quick mode toggle in UI
- [ ] Status bar mode indicator

### Phase 8: Polish & Analytics
- [ ] Tag statistics tracking
- [ ] Usage analytics dashboard
- [ ] Full-text search integration (FTS5)
- [ ] Performance profiling & optimization

---

## Open Questions

1. **Hierarchy separator:** Use `/` (Programming/Python) or `:` (programming:python) or `>` (programming > python)?
   - `/` is natural but conflicts with paths
   - `:` is namespace-y (like Danbooru)
   - `>` is visual but unusual
   - **Decision:** Use `::` for namespaces, UI shows as `→` or breadcrumb

2. **Inheritance override:** How does a file "un-inherit" a folder tag?
   - Explicit exclusion list: `excludedInheritedTags: ["ml"]`
   - Or just ignore (user can move file)
   - **Leaning toward:** Exclusion list stored per-file

3. **Shadow tag storage:** Store aliases on primary tag, or separate alias→primary mapping?
   - **Decision:** Separate `tag_aliases` table (easier to query, promote aliases)

4. **View mode persistence:** Per-workspace or global?
   - **Decision:** Per-workspace (user's intended use case)

5. ~~**SQLite vs JSON timeline:**~~ **Resolved:** SQLite from the start

6. **Web extension support:** `better-sqlite3` is native. Need `sql.js` fallback?
   - For VS Code web (vscode.dev), would need WASM version
   - **Defer:** Focus on desktop first, add web support later if needed

7. **Metadata search syntax:** How to query tag instance metadata?
   - Option A: `tag:person[confidence>0.9]`
   - Option B: Separate metadata search command
   - **Leaning toward:** Option B for simplicity, A for power users later

8. **Tag instance display:** When a tag appears multiple times (with different parents), how to show?
   - Show count: "person (×3)"
   - Show grouped: "person → male, person → female"
   - **Needs UX exploration**

---

## Technical Considerations

### SQLite in VS Code Extensions

**Bundling `better-sqlite3`:**
```javascript
// esbuild.config.js
{
  external: ['better-sqlite3'],  // Native module, can't bundle
  // OR use @vscode/sqlite3 which is pre-built for VS Code
}
```

**Alternative: `sql.js` (WASM)**
- Pure JavaScript, no native deps
- Works in web extensions
- Slower than native, but acceptable for most workloads
- Async API (different from better-sqlite3)

**Recommendation:** Try `@vscode/sqlite3` first (Microsoft's fork, optimized for extensions). Fall back to `sql.js` if bundling issues.

### Database Location

**Options:**
1. `.vscode/lattice.db` - Hidden, consistent with current pattern
2. `lattice.db` at workspace root - Visible, easier to backup
3. Configurable via setting

**Decision:** `.vscode/lattice.db` (matches existing `.vscode/lattice.*.json` pattern)

### Backup Strategy

```typescript
async function backupDatabase(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.backup-${timestamp}`;
  
  // SQLite online backup API
  await db.backup(backupPath);
  
  // Keep only last N backups
  await pruneOldBackups(5);
}

// Automatic backups:
// - Before migrations
// - Before bulk operations (>100 changes)
// - Daily (if extension active)
```

### Migration from JSON

```typescript
async function migrateFromJson(): Promise<void> {
  const tagsJson = await tryReadJson('.vscode/lattice.tags.json');
  const cardsJson = await tryReadJson('.vscode/lattice.cards.json');
  
  if (!tagsJson && !cardsJson) return;  // Nothing to migrate
  
  await backupDatabase();
  
  await db.transaction(() => {
    if (tagsJson) {
      for (const file of Object.values(tagsJson.files)) {
        insertFile(file);
      }
      for (const tag of Object.values(tagsJson.tags)) {
        insertTag(tag);
      }
    }
    
    if (cardsJson) {
      for (const card of cardsJson) {
        insertCard(card);
      }
    }
  });
  
  // Rename old files
  await rename('.vscode/lattice.tags.json', '.vscode/lattice.tags.json.migrated');
  await rename('.vscode/lattice.cards.json', '.vscode/lattice.cards.json.migrated');
}
```

### ID Generation

Keep using `nanoid` for new records. UUIDs are fine for SQLite (TEXT primary keys work well with proper indexing).

### Tag Normalization

```typescript
function normalizeTagName(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')      // Collapse spaces to hyphens
    .replace(/[^\w\-:.]/g, '') // Remove special chars except -, :, .
    .slice(0, 100);            // Max length
}
```

---

## Conclusion

This is an ambitious system that goes beyond typical file tagging toward a **personal knowledge database**. The key principles:

1. **SQLite as foundation:** ACID transactions, scales to millions, complex queries
2. **Unified storage:** All Lattice features share one database
3. **Graceful degradation:** Advanced features (metadata, expressions) are optional layers
4. **Respect existing organization:** Folder inheritance, auto-tagging work *with* user's structure
5. **Image-board inspiration:** Structured tags, aliases, metadata per-instance (like Danbooru/Hydrus)

**Trade-off accepted:** SQLite isn't git-diffable. Mitigation: JSON export for backup/sharing.

**End goal:** A tagging system powerful enough for organizing 100K+ images with detailed AI-generated metadata, yet simple enough for casual note organization. The complexity is opt-in.

