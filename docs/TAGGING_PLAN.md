# Tagging System Plan

## Overview

A file tagging system for Lattice that allows users to organize their notes, PDFs, and images beyond traditional folder hierarchies. The system should be resilient to file moves/renames and provide an intuitive UI for tag management.

## Core Requirements

### 1. File Tracking (Antifragile to Moves/Renames)

**Problem**: Traditional path-based tracking breaks when files are moved or renamed.

**Solution: Hybrid Identity System**

Store multiple identifiers for each tracked file:
- **Primary**: Workspace-relative path (fast lookups)
- **Recovery Hints** (for when path fails):
  - Original filename
  - File size (bytes)
  - Last known modification time
  - For text files: content signature (hash of first 1KB + last 1KB, periodically updated)
  - For binary files: file size + creation metadata if available

**Recovery Algorithm**:
1. Try primary path → if exists, done
2. Search workspace for exact filename match
3. If text file, search for content signature matches
4. If multiple candidates, rank by similarity and prompt user
5. If no matches, mark as "broken link"

**Broken Link Handling**:
- Show broken link icon (🔗❌ or similar) in tag views
- Allow manual reassignment: "Locate file..." action
- Keep tag data intact—reassignment transfers all tags
- Option to "dismiss" broken links (removes from tracking but preserves in history)

### 2. Tag Data Model

```typescript
interface TaggedFile {
  // Identity
  id: string;                    // Stable UUID for this tracked file
  path: string;                  // Workspace-relative path
  
  // Recovery hints
  filename: string;              // Just the filename (for search)
  fileSize?: number;             // Bytes
  lastModified?: number;         // Unix timestamp
  contentSignature?: string;     // For text files
  
  // Tags
  tags: string[];                // Lowercase internally for matching
  tagDisplayNames: { [lower: string]: string }; // Original casing for display
  
  // Metadata
  lastSeen?: number;             // Last time file was confirmed to exist
  status: 'ok' | 'missing' | 'moved'; // Current status
}

interface Tag {
  name: string;                  // Lowercase for matching
  displayName: string;           // Original casing
  color?: string;                // User-set color (null = auto-generate)
  fileCount: number;             // Cached count for UI
}

interface TagDatabase {
  version: number;
  files: { [id: string]: TaggedFile };
  tags: { [name: string]: Tag };
}
```

### 3. Tag Colors

**Auto-generation**: Hash tag name to generate consistent HSL color
- Use string hash → map to hue (0-360)
- Fixed saturation (~65%) and lightness (~45%) for readability
- Same tag always gets same color across sessions

**User Override**:
- Store custom colors in tag metadata
- Color picker in tag context menu
- "Reset to auto" option

### 4. Storage Strategy

**Location**: `.vscode/lattice.tags.json` in workspace root
- Consistent with existing pattern (`.vscode/lattice.cards.json`)
- Syncs with workspace (Syncthing, git, etc.)

**Backup**: Keep last N versions for recovery (configurable, default 3)

### 5. UI Components

#### A. Tag Explorer Side Panel (Primary View)

```
┌─────────────────────────────────┐
│ 🏷️ TAGS                    [+] │  ← Add tag button
├─────────────────────────────────┤
│ 🔍 Filter tags...               │  ← Quick filter
├─────────────────────────────────┤
│ ▼ Current File                  │  ← Section for active document
│   📄 MyNotes.md                 │
│   [ML] [Physics] [+]            │  ← Current tags + add button
├─────────────────────────────────┤
│ ▼ All Tags (12)                 │  ← Collapsible tag list
│   ● ML (24 files)               │
│   ● Physics (18 files)          │
│   ● Economics (15 files)        │
│   ● Reading (8 files)           │
│   ● ToReview (5 files)          │
│   ...                           │
├─────────────────────────────────┤
│ ▼ Broken Links (2)              │  ← Only shown if any exist
│   ❌ OldNotes.md                │
│   ❌ Archive/Paper.pdf          │
└─────────────────────────────────┘
```

#### B. Tag View (clicking a tag)

```
┌─────────────────────────────────┐
│ ← Back    🏷️ ML (24 files)     │
│                    [Edit] [Del] │
├─────────────────────────────────┤
│ 🔍 Filter files...              │
├─────────────────────────────────┤
│ 📄 TransformerNotes.md          │
│   /ML/Transformers/             │
│                                 │
│ 📄 AttentionPaper.pdf           │
│   /ML/Papers/                   │
│                                 │
│ 📄 MLBasics.md                  │
│   /Active/                      │
└─────────────────────────────────┘
```

#### C. Multi-Tag Filter View

- Allow selecting multiple tags (AND/OR filter)
- Show intersection/union of tagged files
- Quick "All untagged files" filter

#### D. Quick Tagging (Context Menu & Commands)

**Context Menu** (right-click file in explorer):
- "Add Tag..." → Quick picker with existing tags + create new
- "Remove Tag..." → Show current tags to remove
- "Show in Tag Explorer"

**Commands** (Ctrl+Shift+P):
- `Lattice: Add Tag to Current File`
- `Lattice: Remove Tag from Current File`
- `Lattice: Show File Tags`
- `Lattice: Open Tag Explorer`

**Keybinding suggestion**: `Ctrl+Shift+T` → Add tag to current file

### 6. API for Programmatic Tagging

```typescript
// Public API for AI integration and other automation
export interface TaggingAPI {
  // File operations
  addTags(fileUri: vscode.Uri, tags: string[]): Promise<void>;
  removeTags(fileUri: vscode.Uri, tags: string[]): Promise<void>;
  setTags(fileUri: vscode.Uri, tags: string[]): Promise<void>; // Replace all
  getTags(fileUri: vscode.Uri): Promise<string[]>;
  
  // Tag operations
  getAllTags(): Promise<Tag[]>;
  getFilesWithTag(tag: string): Promise<vscode.Uri[]>;
  renameTag(oldName: string, newName: string): Promise<void>;
  deleteTag(name: string): Promise<void>; // Removes from all files
  setTagColor(tag: string, color: string | null): Promise<void>;
  
  // Search
  findFiles(query: TagQuery): Promise<vscode.Uri[]>;
  
  // Events
  onDidChangeTags: vscode.Event<TagChangeEvent>;
}

interface TagQuery {
  anyOf?: string[];      // OR: has any of these tags
  allOf?: string[];      // AND: has all of these tags
  noneOf?: string[];     // NOT: has none of these tags
  untagged?: boolean;    // Only untagged files
}
```

### 7. File Type Support

**Supported file types**:
- Markdown (.md)
- PDF (.pdf)
- Images (.png, .jpg, .jpeg, .gif, .webp, .svg)
- URL files (.url) - already used by Lattice
- Plain text (.txt)

**Configuration**: Allow users to add/remove extensions via settings

### 8. Integration Points

#### With Existing Features:

1. **Document Titles**: Show custom title in tag views if set
2. **PDF Preview**: "Add Tag" button in PDF toolbar
3. **Card System**: Could add phantom tags based on file tags
4. **Notes Association**: Tagged PDFs could show their associated notes' tags

#### Future AI Integration:

```typescript
// Example AI auto-tagging hook
async function autoTagFile(uri: vscode.Uri): Promise<string[]> {
  const content = await readFileContent(uri);
  const suggestedTags = await aiService.suggestTags(content);
  
  // Show confirmation dialog
  const confirmed = await confirmTags(uri, suggestedTags);
  if (confirmed) {
    await taggingAPI.addTags(uri, suggestedTags);
  }
  return suggestedTags;
}
```

### 9. Settings

```json
{
  "lattice.tags.autoTrack": {
    "description": "Automatically track opened files",
    "type": "boolean",
    "default": false
  },
  "lattice.tags.supportedExtensions": {
    "description": "File extensions that can be tagged",
    "type": "array",
    "default": [".md", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".url"]
  },
  "lattice.tags.showInExplorer": {
    "description": "Show tag indicators in file explorer",
    "type": "boolean",
    "default": true
  },
  "lattice.tags.brokenLinkCheckInterval": {
    "description": "How often to check for broken links (minutes, 0 = manual only)",
    "type": "number",
    "default": 0
  }
}
```

## Implementation Phases

### Phase 1: Core Infrastructure ✅ COMPLETE
- [x] TagManager class (singleton, storage, CRUD operations)
- [x] File identity and recovery system
- [x] Basic API
- [x] Storage format and migration

### Phase 2: Basic UI ✅ COMPLETE
- [x] Tag Explorer side panel (tree view)
- [x] Current file section
- [x] Basic tag list with file counts
- [x] Click to see files

### Phase 3: Commands & Context Menu ✅ COMPLETE
- [x] Add/remove tag commands
- [x] Context menu integration
- [x] Quick pick for tag selection
- [x] Keybindings (Ctrl+Shift+T to add tag)

### Phase 4: Enhanced UI ✅ PARTIAL
- [x] Tag colors (auto-generated based on tag name)
- [x] Custom tag colors (via setTagColor command)
- [x] Broken link section
- [x] File reassignment UI
- [ ] Multi-tag filtering (future)

### Phase 5: Integration & Polish (Pending)
- [ ] Integration with existing features
- [ ] Settings UI
- [ ] Performance optimization for large workspaces
- [ ] Documentation

## Questions & Considerations

### Open Questions:

1. **Tag inheritance**: Should subdirectories inherit parent folder tags? (Probably not for v1)

2. **Bulk operations**: How to efficiently tag many files at once? (Multi-select in explorer?)

3. **Tag suggestions**: Should we suggest tags based on folder path? (e.g., files in `/ML/` suggest "ML" tag)

4. **Export/Import**: Should tags be exportable? (For sharing/backup beyond sync)

5. **Tag hierarchies**: Should we support nested tags like `Programming/Python`? (Complexity vs value)

6. **Cross-workspace tags**: What if user has multiple workspaces? Keep separate for now.

### Edge Cases:

1. **Large workspaces**: Lazy load file lists, virtualize tree view
2. **Many tags on one file**: Scrollable tag chips, limit display
3. **Very long tag names**: Truncate with tooltip
4. **Special characters in tags**: Allow most Unicode, sanitize for storage keys
5. **Case sensitivity**: "ML" and "ml" are same tag, preserve first-seen casing

### Potential Future Features:

1. **Smart tags**: Auto-update based on rules (e.g., "files modified this week")
2. **Tag templates**: Apply multiple tags at once
3. **Tag aliases**: "Machine Learning" → "ML"
4. **File preview on hover**: See file content in tooltip
5. **Drag-and-drop**: Drag files onto tags to add
6. **Keyboard navigation**: Full keyboard control in tag explorer
7. **Tag statistics**: When were tags added, usage over time

## Technical Notes

### VSCode APIs to Use:

- `vscode.window.createTreeView()` - For the side panel
- `vscode.TreeDataProvider` - Data for tree view
- `vscode.FileDecorationProvider` - Show tags in file explorer
- `vscode.workspace.createFileSystemWatcher()` - Track file changes
- `vscode.commands.registerCommand()` - Commands
- `vscode.window.registerWebviewViewProvider()` - If we need rich UI

### Dependencies:

- `nanoid` - Already in project for ID generation
- Consider `fast-glob` for file searching (or use VS Code's findFiles)

### Performance Considerations:

- Cache tag data in memory, persist on change
- Debounce writes to storage file
- Use workspace-relative paths for smaller storage
- Lazy load file existence checks
