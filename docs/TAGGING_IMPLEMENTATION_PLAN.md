# Advanced Tagging Implementation Plan

## Current State (Completed)

- ✅ SQLite database with full schema
- ✅ TagManagerSqlite with basic CRUD operations
- ✅ Migration from JSON to SQLite
- ✅ Tag Explorer UI

## Prioritized Task List

### Phase 1: Quick Wins (High Value, Easy)

| # | Feature | Status | Testability |
|---|---------|--------|-------------|
| **1** | **Tag Templates** | 🚧 In Progress | ✅ Full unit testing |
| **2** | **Tag Aliases** | Pending | ✅ Full unit testing |

### Phase 2: Organization Power (High Value, Medium Effort)

| # | Feature | Status | Testability |
|---|---------|--------|-------------|
| **3** | **Tag Hierarchies** | Pending | ✅ Core logic unit testable |
| **4** | **Folder Tag Inheritance** | Pending | ✅ Full unit testing |
| **5** | **Folder Auto-Tagging** | Pending | ⚠️ FileSystemWatcher needs integration test |

### Phase 3: Bulk Operations (High Value, UI-Heavy)

| # | Feature | Status | Testability |
|---|---------|--------|-------------|
| **6** | **Multi-Select Tag Operations** | Pending | ⚠️ Needs integration test for explorer |

### Phase 4: Advanced Features (Power Users)

| # | Feature | Status | Testability |
|---|---------|--------|-------------|
| **7** | **View Modes** | Pending | ✅ Unit testable |
| **8** | **Expression System** | Pending | ✅ Fully unit testable |
| **9** | **Smart/Dynamic Tags** | Pending | ⚠️ Needs file metadata integration |

---

## Feature Details

### 1. Tag Templates

**What:** Presets like "New ML Paper" → adds `[ml, paper, unread, to-annotate]`

**Database:** `tag_templates` table already exists in schema

**Implementation:**
```typescript
// Database methods needed:
db.createTemplate(name, tagsToAdd, tagsToRemove?, conditions?)
db.getTemplate(id)
db.getAllTemplates()
db.deleteTemplate(id)

// TagManager API:
tagManager.applyTemplate(uri, templateId)
tagManager.getAllTemplates()
```

**Tests:** All pure data operations, fully unit-testable.

---

### 2. Tag Aliases

**What:** "ML" resolves to "machine-learning" everywhere

**Database:** `tag_aliases` table already exists in schema

**Implementation:**
```typescript
// Database methods needed:
db.createAlias(alias, primaryTag)
db.resolveAlias(tagInput) → primaryTag | tagInput
db.getAliasesForTag(tagName)
db.deleteAlias(alias)

// Modify existing tag operations:
// - addTags() calls resolveAlias() first
// - search uses aliases in WHERE clause
```

**Tests:** Pure string resolution, fully unit-testable.

---

### 3. Tag Hierarchies

**What:** `Programming::Python::Django` displays as "Django" with breadcrumb on hover

**Database:** `parent_tag` column already exists in `tags` table

**Implementation:**
```typescript
// Use existing parent_tag column
// New database methods:
db.setTagParent(childTag, parentTag)
db.getTagChildren(parentTag)
db.getTagAncestors(tag) → string[] // full path up
db.getTagDescendants(parentTag) → string[] // all children recursively

// TagManager changes:
tagManager.getFilesWithTagOrDescendants(tag) // filtering
tagManager.getTagHierarchy() → tree structure for UI
```

**Tests:** Tree operations, fully unit-testable.

---

### 4. Folder Tag Inheritance

**What:** Files in `/ML/Papers/` automatically have `ml` and `papers` tags

**Database:** `folder_rules` table + `getInheritedTags()` already exist

**Implementation:**
```typescript
// New database methods:
db.createFolderRule(folderPath, tags[], recursive?)
db.updateFolderRule(...)
db.deleteFolderRule(folderPath)
db.getAllFolderRules()

// TagManager integration:
tagManager.getTags(uri) // returns explicit + inherited
tagManager.getEffectiveTags(uri) // same but clearly named
tagManager.getExplicitTags(uri) // just what user set
```

**UI:** Show inherited tags dimmed with folder icon.

---

### 5. Folder Auto-Tagging

**What:** When you drop a PDF into `/ML/`, it gets tagged automatically

**Database:** `folder_auto_tags` table already exists

**Implementation:**
```typescript
// Database methods:
db.createAutoTagRule(folderPattern, tags[] | templateId, conditions?)
db.getAutoTagRulesForPath(filePath)

// TagManager: 
// - FileSystemWatcher.onDidCreate → check rules → apply tags
// - Option: prompt user vs silent apply
```

---

### 6. Multi-Select Tag Operations

**What:** Select 10 files, right-click → "Add tag to selected"

**Implementation:**
```typescript
// TagManager batch API:
tagManager.addTagsToFiles(uris: Uri[], tags: string[])
tagManager.removeTagsFromFiles(uris: Uri[], tags: string[])
tagManager.applyTemplateToFiles(uris: Uri[], templateId: string)

// UI: Custom command that reads explorer.selection
// UI: Tag explorer allows multi-select within tag's file list
```

---

### 7. View Modes

**What:** Different "modes" that filter what tags/files are visible

**Database:** `view_modes` table already exists

**Implementation:**
```typescript
interface ViewMode {
  id: string;
  name: string;
  hiddenTags: string[];
  excludeFilesWithTags: string[];
  requireFilesWithTags?: string[];
}

// TagManager integration:
tagManager.setActiveViewMode(id)
tagManager.getActiveViewMode()
// All queries respect active view mode
```

---

### 8. Expression System

**What:** Reusable conditions for smart tags & auto-tagging

**Implementation:**
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

class ExpressionEvaluator {
  matchesFile(expr: TagExpression, fileId: string): Promise<boolean>;
  findMatchingFiles(expr: TagExpression): Promise<string[]>;
  toSqlWhere(expr: TagExpression): { sql: string; params: unknown[] };
}
```

---

### 9. Smart/Dynamic Tags

**What:** Auto-computed tags based on expressions

**Implementation:**
```typescript
interface SmartTag {
  name: string;
  displayName: string;
  rule: TagExpression;
  refreshOn: 'manual' | 'file-open' | 'file-change' | 'schedule';
  cacheResults: boolean;
}

// Examples:
// "recent" = files modified in last 7 days
// "large-files" = files > 10MB
// "unread-papers" = PDFs without "read" tag
```

---

## Design Principles

1. **SQLite as foundation:** ACID transactions, scales to millions, complex queries
2. **Unified storage:** All Lattice features share one database
3. **Graceful degradation:** Advanced features (metadata, expressions) are optional layers
4. **Respect existing organization:** Folder inheritance, auto-tagging work *with* user's structure
5. **Image-board inspiration:** Structured tags, aliases, metadata per-instance (like Danbooru/Hydrus)

## Testing Strategy

- **Unit tests:** All database methods, expression evaluation, pure functions
- **Integration tests:** FileSystemWatcher behavior, migration
- **Manual tests:** UI interactions, Tag Explorer, command palette

