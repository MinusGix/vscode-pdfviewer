/**
 * TagExplorerProvider - TreeView provider for the tag explorer side panel
 *
 * Shows:
 * - Current file section (with its tags)
 * - All tags list (with file counts)
 * - Broken links section
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ITagManager, getTagManager, hasTagManager } from './tagManagerInterface';
import { TaggedFile, Tag } from './tagTypes';
import { getRelativePath, getUriFromRelativePath } from './fileIdentity';
import { getThemeColorId } from './tagColors';
import {
  extractTagName,
  parseRemoveTagArgs,
  buildTagTooltip,
  buildTagDescription,
} from './tagExplorerHelpers';

/**
 * Get the icon for a tag
 * Note: VS Code TreeItems only support ThemeColor, not arbitrary CSS colors.
 * Custom colors will be shown in the tooltip/description and used in future webview panels.
 */
function getTagIcon(
  tagName: string,
  customColor: string | undefined,
  iconName: 'tag' | 'circle-filled' = 'tag'
): vscode.ThemeIcon {
  // Use theme color based on tag name hash for visual variety
  const themeColorId = getThemeColorId(tagName);
  return new vscode.ThemeIcon(iconName, new vscode.ThemeColor(themeColorId));
}

type TreeItemType =
  | { type: 'section'; section: 'currentFile' | 'allTags' | 'brokenLinks' }
  | { type: 'currentFileInfo'; uri: vscode.Uri }
  | { type: 'currentFileTag'; tag: string; uri: vscode.Uri }
  | { type: 'addTagButton'; uri: vscode.Uri }
  | { type: 'tag'; tag: Tag }
  | { type: 'taggedFile'; file: TaggedFile; parentTag?: string }
  | { type: 'brokenFile'; file: TaggedFile }
  | { type: 'noTags' }
  | { type: 'noCurrentFile' };

export class TagExplorerProvider
  implements vscode.TreeDataProvider<TreeItemType> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeItemType | undefined
  >();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private tagManager: ITagManager;
  private currentFileUri: vscode.Uri | undefined;
  private expandedTag: string | undefined; // Track which tag is expanded to show files
  private disposables: vscode.Disposable[] = [];

  constructor(tagManager: ITagManager) {
    this.tagManager = tagManager;

    // Listen for tag changes
    this.disposables.push(
      this.tagManager.onDidChangeTags(() => {
        this._onDidChangeTreeData.fire(undefined);
      })
    );

    // Listen for active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.updateCurrentFile(editor?.document.uri);
      })
    );

    // Initialize with current editor
    this.updateCurrentFile(vscode.window.activeTextEditor?.document.uri);
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this._onDidChangeTreeData.dispose();
  }

  private updateCurrentFile(uri: vscode.Uri | undefined): void {
    const oldUri = this.currentFileUri;
    this.currentFileUri = uri;

    if (oldUri?.toString() !== uri?.toString()) {
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  public setExpandedTag(tagName: string | undefined): void {
    this.expandedTag = tagName;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItemType): vscode.TreeItem {
    switch (element.type) {
      case 'section':
        return this.createSectionItem(element.section);

      case 'currentFileInfo':
        return this.createCurrentFileInfoItem(element.uri);

      case 'currentFileTag':
        return this.createCurrentFileTagItem(element.tag, element.uri);

      case 'addTagButton':
        return this.createAddTagButtonItem(element.uri);

      case 'tag':
        return this.createTagItem(element.tag);

      case 'taggedFile':
        return this.createTaggedFileItem(element.file);

      case 'brokenFile':
        return this.createBrokenFileItem(element.file);

      case 'noTags':
        return this.createNoTagsItem();

      case 'noCurrentFile':
        return this.createNoCurrentFileItem();
    }
  }

  async getChildren(element?: TreeItemType): Promise<TreeItemType[]> {
    if (!element) {
      // Root level - return sections
      const sections: TreeItemType[] = [
        { type: 'section', section: 'currentFile' },
        { type: 'section', section: 'allTags' },
      ];

      // Only show broken links section if there are broken files
      const brokenFiles = this.tagManager.getBrokenFiles();
      if (brokenFiles.length > 0) {
        sections.push({ type: 'section', section: 'brokenLinks' });
      }

      return sections;
    }

    switch (element.type) {
      case 'section':
        return this.getSectionChildren(element.section);

      case 'tag':
        // When a tag is expanded, show its files
        return this.tagManager
          .getFilesWithTag(element.tag.name)
          .map((file) => ({
            type: 'taggedFile' as const,
            file,
            parentTag: element.tag.name,
          }));

      default:
        return [];
    }
  }

  private getSectionChildren(
    section: 'currentFile' | 'allTags' | 'brokenLinks'
  ): TreeItemType[] {
    switch (section) {
      case 'currentFile': {
        if (!this.currentFileUri) {
          return [{ type: 'noCurrentFile' }];
        }

        const tags = this.tagManager.getTags(this.currentFileUri);
        const items: TreeItemType[] = [
          { type: 'currentFileInfo', uri: this.currentFileUri },
        ];

        // Add current tags
        for (const tag of tags) {
          items.push({ type: 'currentFileTag', tag, uri: this.currentFileUri });
        }

        // Add "add tag" button
        items.push({ type: 'addTagButton', uri: this.currentFileUri });

        return items;
      }

      case 'allTags': {
        const tags = this.tagManager.getAllTags();
        if (tags.length === 0) {
          return [{ type: 'noTags' }];
        }
        return tags.map((tag) => ({ type: 'tag' as const, tag }));
      }

      case 'brokenLinks': {
        return this.tagManager
          .getBrokenFiles()
          .map((file) => ({ type: 'brokenFile' as const, file }));
      }
    }
  }

  // ================== Item Creators ==================

  private createSectionItem(
    section: 'currentFile' | 'allTags' | 'brokenLinks'
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(
      '',
      vscode.TreeItemCollapsibleState.Expanded
    );

    switch (section) {
      case 'currentFile':
        item.label = 'Current File';
        item.iconPath = new vscode.ThemeIcon('file');
        break;
      case 'allTags': {
        const tagCount = this.tagManager.getAllTags().length;
        item.label = `All Tags (${tagCount})`;
        item.iconPath = new vscode.ThemeIcon('tag');
        break;
      }
      case 'brokenLinks': {
        const brokenCount = this.tagManager.getBrokenFiles().length;
        item.label = `Broken Links (${brokenCount})`;
        item.iconPath = new vscode.ThemeIcon('warning');
        break;
      }
    }

    item.contextValue = `section-${section}`;
    return item;
  }

  private createCurrentFileInfoItem(uri: vscode.Uri): vscode.TreeItem {
    const filename = path.basename(uri.fsPath);
    const item = new vscode.TreeItem(
      filename,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = path.dirname(getRelativePath(uri));
    item.iconPath = this.getFileIcon(uri);
    item.tooltip = uri.fsPath;
    item.contextValue = 'currentFileInfo';
    item.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [uri],
    };

    return item;
  }

  private createCurrentFileTagItem(
    tag: string,
    uri: vscode.Uri
  ): vscode.TreeItem {
    const tagData = this.tagManager.getAllTags().find((t) => t.name === tag);
    const displayName = tagData?.displayName || tag;
    const customColor = tagData?.color;

    const item = new vscode.TreeItem(
      displayName,
      vscode.TreeItemCollapsibleState.None
    );

    item.iconPath = getTagIcon(tag, customColor, 'circle-filled');
    item.description = customColor ? `[${customColor}]` : '';
    item.tooltip = customColor
      ? `"${displayName}" (custom: ${customColor})\nClick to remove`
      : `Click to remove "${displayName}" tag`;
    item.contextValue = 'currentFileTag';
    // Use fsPath string for serialization compatibility
    item.command = {
      command: 'lattice.tags.removeTagFromFile',
      title: 'Remove Tag',
      arguments: [uri.fsPath, tag],
    };

    return item;
  }

  private createAddTagButtonItem(uri: vscode.Uri): vscode.TreeItem {
    const item = new vscode.TreeItem(
      'Add Tag...',
      vscode.TreeItemCollapsibleState.None
    );

    item.iconPath = new vscode.ThemeIcon('add');
    item.tooltip = 'Add a new tag to this file';
    item.contextValue = 'addTagButton';
    item.command = {
      command: 'lattice.tags.addTagToFile',
      title: 'Add Tag',
      arguments: [uri],
    };

    return item;
  }

  private createTagItem(tag: Tag): vscode.TreeItem {
    const item = new vscode.TreeItem(
      tag.displayName,
      vscode.TreeItemCollapsibleState.Collapsed
    );

    const fileCountStr = `${tag.fileCount} file${tag.fileCount === 1 ? '' : 's'}`;
    item.description = tag.color
      ? `${fileCountStr} [${tag.color}]`
      : fileCountStr;

    item.iconPath = getTagIcon(tag.name, tag.color, 'tag');

    const tooltipLines = [`${tag.displayName} - ${fileCountStr}`];
    if (tag.color) {
      tooltipLines.push(`Custom color: ${tag.color}`);
    }
    tooltipLines.push('Click to see files');
    item.tooltip = tooltipLines.join('\n');
    item.contextValue = 'tag';

    return item;
  }

  private createTaggedFileItem(file: TaggedFile): vscode.TreeItem {
    const item = new vscode.TreeItem(
      file.filename,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = path.dirname(file.path);
    item.iconPath = this.getFileIconForPath(file.path);
    item.tooltip = file.path;
    item.contextValue = 'taggedFile';

    const uri = getUriFromRelativePath(file.path);
    if (uri) {
      item.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [uri],
      };
    }

    return item;
  }

  private createBrokenFileItem(file: TaggedFile): vscode.TreeItem {
    const item = new vscode.TreeItem(
      file.filename,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = `${file.path} (missing)`;
    item.iconPath = new vscode.ThemeIcon('error');
    item.tooltip = `File not found at: ${file.path}\nTags: ${file.tags.join(
      ', '
    )}\nClick to locate or dismiss`;
    item.contextValue = 'brokenFile';
    item.command = {
      command: 'lattice.tags.handleBrokenFile',
      title: 'Handle Broken File',
      arguments: [file.id],
    };

    return item;
  }

  private createNoTagsItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      'No tags yet',
      vscode.TreeItemCollapsibleState.None
    );
    item.description = 'Add tags to files to see them here';
    item.iconPath = new vscode.ThemeIcon('info');
    return item;
  }

  private createNoCurrentFileItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      'No file open',
      vscode.TreeItemCollapsibleState.None
    );
    item.description = 'Open a file to see its tags';
    item.iconPath = new vscode.ThemeIcon('info');
    return item;
  }

  // ================== Helpers ==================

  private getFileIcon(uri: vscode.Uri): vscode.ThemeIcon {
    return this.getFileIconForPath(uri.fsPath);
  }

  private getFileIconForPath(filePath: string): vscode.ThemeIcon {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.md':
        return new vscode.ThemeIcon('markdown');
      case '.pdf':
        return new vscode.ThemeIcon('file-pdf');
      case '.png':
      case '.jpg':
      case '.jpeg':
      case '.gif':
      case '.webp':
      case '.svg':
        return new vscode.ThemeIcon('file-media');
      case '.url':
        return new vscode.ThemeIcon('link');
      case '.txt':
        return new vscode.ThemeIcon('file-text');
      default:
        return new vscode.ThemeIcon('file');
    }
  }
}

/**
 * Helper to add a tag to a file with picker UI
 * Uses a custom QuickPick that allows typing to filter OR create new tags
 */
async function addTagToFile(
  uri: vscode.Uri,
  tagManager: ITagManager
): Promise<void> {
  const existingTags = tagManager.getAllTags();
  const currentTags = tagManager.getTags(uri);

  // Filter out tags already on this file
  const availableTags = existingTags.filter(
    (t: Tag) => !currentTags.includes(t.name)
  );

  return new Promise<void>((resolve) => {
    const quickPick = vscode.window.createQuickPick<
      vscode.QuickPickItem & { tag?: string }
    >();
    quickPick.placeholder = 'Type to search or create a new tag';
    quickPick.matchOnDescription = true;

    const updateItems = () => {
      const typedValue = quickPick.value.trim();
      const filtered = availableTags.filter(
        (t: Tag) =>
          t.displayName.toLowerCase().includes(typedValue.toLowerCase()) ||
          t.name.includes(typedValue.toLowerCase())
      );

      const items: (vscode.QuickPickItem & { tag?: string })[] = filtered.map(
        (t: Tag) => ({
          label: t.displayName,
          description: `${t.fileCount} files`,
          tag: t.name,
        })
      );

      // If typed value doesn't match any existing tag exactly, offer to create it
      const exactMatch = availableTags.some(
        (t: Tag) => t.name === typedValue.toLowerCase()
      );
      if (typedValue && !exactMatch) {
        items.unshift({
          label: `$(add) Create "${typedValue}"`,
          description: 'New tag',
          tag: typedValue,
        });
      }

      quickPick.items = items;
    };

    // Initial items
    quickPick.items = availableTags.map((t: Tag) => ({
      label: t.displayName,
      description: `${t.fileCount} files`,
      tag: t.name,
    }));

    quickPick.onDidChangeValue(updateItems);

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      const typedValue = quickPick.value.trim();

      quickPick.hide();

      if (selected?.tag) {
        // Selected an item (existing or new)
        await tagManager.addTags(uri, [selected.tag]);
      } else if (typedValue) {
        // Just pressed enter with typed text, create new tag
        await tagManager.addTags(uri, [typedValue]);
      }

      resolve();
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve();
    });

    quickPick.show();
  });
}

/**
 * Register all tag-related commands
 */
export function registerTagCommands(
  context: vscode.ExtensionContext,
  tagManager: ITagManager
): void {

  // Add tag to current file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.addTagToCurrentFile',
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('No file is currently open');
          return;
        }
        await addTagToFile(editor.document.uri, tagManager);
      }
    )
  );

  // Add tag to specific file (from tree view)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.addTagToFile',
      async (uri?: vscode.Uri) => {
        if (!uri) {
          uri = vscode.window.activeTextEditor?.document.uri;
        }
        if (!uri) {
          vscode.window.showWarningMessage('No file selected');
          return;
        }
        await addTagToFile(uri, tagManager);
      }
    )
  );

  // Remove tag from file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.removeTagFromFile',
      async (arg1: unknown, arg2?: unknown) => {
        const parsed = parseRemoveTagArgs(arg1, arg2);

        if (!parsed) {
          console.error('removeTagFromFile: invalid args', arg1, arg2);
          vscode.window.showErrorMessage(
            'Could not remove tag: invalid arguments'
          );
          return;
        }

        const uri = vscode.Uri.file(parsed.uriPath);
        await tagManager.removeTags(uri, [parsed.tag]);
      }
    )
  );

  // Remove tag from current file (with picker)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.removeTagFromCurrentFile',
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('No file is currently open');
          return;
        }

        const tags = tagManager.getTagsWithDisplayNames(editor.document.uri);
        if (tags.length === 0) {
          vscode.window.showInformationMessage('This file has no tags');
          return;
        }

        const items = tags.map((t) => ({
          label: t.displayName,
          tag: t.name,
        }));

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select tag to remove',
        });

        if (picked) {
          await tagManager.removeTags(editor.document.uri, [picked.tag]);
        }
      }
    )
  );

  // Show file tags
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.tags.showFileTags', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No file is currently open');
        return;
      }

      const tags = tagManager.getTagsWithDisplayNames(editor.document.uri);
      if (tags.length === 0) {
        vscode.window.showInformationMessage('This file has no tags');
      } else {
        vscode.window.showInformationMessage(
          `Tags: ${tags.map((t) => t.displayName).join(', ')}`
        );
      }
    })
  );

  // Handle broken file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.handleBrokenFile',
      async (fileId: string) => {
        const action = await vscode.window.showQuickPick(
          [
            {
              label: 'Find File',
              description: 'Search for the file in the workspace',
            },
            {
              label: 'Locate Manually',
              description: 'Choose a file to reassign tags to',
            },
            { label: 'Dismiss', description: 'Remove this file from tracking' },
          ],
          {
            placeHolder: 'What would you like to do with this broken link?',
          }
        );

        if (!action) return;

        switch (action.label) {
          case 'Find File':
            await tagManager.findMissingFile(fileId);
            break;
          case 'Locate Manually': {
            const files = await vscode.window.showOpenDialog({
              canSelectMany: false,
              openLabel: 'Select File',
            });
            if (files && files[0]) {
              await tagManager.reassignFile(fileId, files[0]);
            }
            break;
          }
          case 'Dismiss':
            tagManager.dismissBrokenFile(fileId);
            break;
        }
      }
    )
  );

  // Refresh tag explorer
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.tags.refresh', () => {
      // The tree view will refresh when we fire the event
      tagManager.checkAllFiles();
    })
  );

  // Set tag color
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.setTagColor',
      async (arg?: string | { type: string; tag: Tag }) => {
        let tagName = extractTagName(arg);

        if (!tagName) {
          // Pick a tag first
          const tags = tagManager.getAllTags();
          if (tags.length === 0) {
            vscode.window.showInformationMessage('No tags exist yet');
            return;
          }
          const picked = await vscode.window.showQuickPick(
            tags.map((t) => ({ label: t.displayName, tag: t.name })),
            { placeHolder: 'Select tag to set color for' }
          );
          if (!picked) return;
          tagName = picked.tag;
        }

        const color = await vscode.window.showInputBox({
          prompt: 'Enter a CSS color (e.g., #ff0000, red, hsl(120, 50%, 50%))',
          placeHolder: 'Color or leave empty to reset',
        });

        if (color === undefined) return; // Cancelled

        tagManager.setTagColor(tagName, color || null);
      }
    )
  );

  // Rename tag
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.renameTag',
      async (arg?: string | { type: string; tag: Tag }) => {
        let tagName = extractTagName(arg);

        if (!tagName) {
          const tags = tagManager.getAllTags();
          if (tags.length === 0) {
            vscode.window.showInformationMessage('No tags exist yet');
            return;
          }
          const picked = await vscode.window.showQuickPick(
            tags.map((t) => ({ label: t.displayName, tag: t.name })),
            { placeHolder: 'Select tag to rename' }
          );
          if (!picked) return;
          tagName = picked.tag;
        }

        const displayName =
          tagManager.getAllTags().find((t) => t.name === tagName)
            ?.displayName || tagName;
        const newName = await vscode.window.showInputBox({
          prompt: 'Enter new tag name',
          value: displayName,
        });

        if (newName && newName !== displayName) {
          await tagManager.renameTag(tagName, newName);
        }
      }
    )
  );

  // Delete tag
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.deleteTag',
      async (arg?: string | { type: string; tag: Tag }) => {
        let tagName = extractTagName(arg);

        if (!tagName) {
          const tags = tagManager.getAllTags();
          if (tags.length === 0) {
            vscode.window.showInformationMessage('No tags exist yet');
            return;
          }
          const picked = await vscode.window.showQuickPick(
            tags.map((t) => ({
              label: t.displayName,
              description: `${t.fileCount} files`,
              tag: t.name,
            })),
            { placeHolder: 'Select tag to delete' }
          );
          if (!picked) return;
          tagName = picked.tag;
        }

        const displayName =
          tagManager.getAllTags().find((t) => t.name === tagName)
            ?.displayName || tagName;
        const confirm = await vscode.window.showWarningMessage(
          `Delete tag "${displayName}"? It will be removed from all files.`,
          { modal: true },
          'Delete'
        );

        if (confirm === 'Delete') {
          await tagManager.deleteTag(tagName);
        }
      }
    )
  );
}
