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

  // ==================== Template Commands ====================

  // Apply template to current file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.applyTemplate',
      async (uri?: vscode.Uri) => {
        if (!tagManager.getAllTemplates) {
          vscode.window.showWarningMessage('Templates are not supported in this configuration');
          return;
        }

        const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!targetUri) {
          vscode.window.showWarningMessage('No file is currently open');
          return;
        }

        const templates = tagManager.getAllTemplates();
        if (templates.length === 0) {
          const create = await vscode.window.showInformationMessage(
            'No templates exist yet. Create one?',
            'Create Template'
          );
          if (create) {
            await vscode.commands.executeCommand('lattice.tags.createTemplate');
          }
          return;
        }

        const picked = await vscode.window.showQuickPick(
          templates.map((t) => ({
            label: t.name,
            description: t.description || undefined,
            detail: `+[${t.tagsToAdd.join(', ')}]${t.tagsToRemove.length > 0 ? ` -[${t.tagsToRemove.join(', ')}]` : ''}`,
            template: t,
          })),
          { placeHolder: 'Select template to apply' }
        );

        if (picked && tagManager.applyTemplate) {
          const success = await tagManager.applyTemplate(targetUri, picked.template.id);
          if (success) {
            vscode.window.showInformationMessage(`Applied template "${picked.label}"`);
          } else {
            vscode.window.showErrorMessage('Failed to apply template');
          }
        }
      }
    )
  );

  // Create new template
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.createTemplate',
      async () => {
        if (!tagManager.createTemplate) {
          vscode.window.showWarningMessage('Templates are not supported in this configuration');
          return;
        }

        // Get template name
        const name = await vscode.window.showInputBox({
          prompt: 'Enter template name',
          placeHolder: 'e.g., New ML Paper',
          validateInput: (value) => {
            if (!value.trim()) return 'Name is required';
            if (tagManager.getTemplateByName?.(value)) return 'A template with this name already exists';
            return null;
          },
        });
        if (!name) return;

        // Get tags to add
        const tagsInput = await vscode.window.showInputBox({
          prompt: 'Enter tags to add (comma-separated)',
          placeHolder: 'e.g., ml, paper, unread',
          validateInput: (value) => {
            if (!value.trim()) return 'At least one tag is required';
            return null;
          },
        });
        if (!tagsInput) return;

        const tagsToAdd = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);

        // Get tags to remove (optional)
        const removeInput = await vscode.window.showInputBox({
          prompt: 'Enter tags to remove when applying (comma-separated, optional)',
          placeHolder: 'e.g., draft, wip',
        });
        const tagsToRemove = removeInput
          ? removeInput.split(',').map((t) => t.trim()).filter(Boolean)
          : undefined;

        // Get description (optional)
        const description = await vscode.window.showInputBox({
          prompt: 'Enter template description (optional)',
          placeHolder: 'e.g., Apply to newly downloaded ML papers',
        });

        // Create the template
        const id = tagManager.createTemplate(name, tagsToAdd, {
          description: description || undefined,
          tagsToRemove,
        });

        vscode.window.showInformationMessage(`Created template "${name}"`);
        return id;
      }
    )
  );

  // Manage templates (list/edit/delete)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.manageTemplates',
      async () => {
        if (!tagManager.getAllTemplates) {
          vscode.window.showWarningMessage('Templates are not supported in this configuration');
          return;
        }

        const templates = tagManager.getAllTemplates();
        if (templates.length === 0) {
          const create = await vscode.window.showInformationMessage(
            'No templates exist yet. Create one?',
            'Create Template'
          );
          if (create) {
            await vscode.commands.executeCommand('lattice.tags.createTemplate');
          }
          return;
        }

        const items = [
          { label: '$(add) Create New Template', action: 'create' as const },
          { label: '', kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem,
          ...templates.map((t) => ({
            label: t.name,
            description: t.description || undefined,
            detail: `+[${t.tagsToAdd.join(', ')}]${t.tagsToRemove.length > 0 ? ` -[${t.tagsToRemove.join(', ')}]` : ''}`,
            action: 'edit' as const,
            template: t,
          })),
        ];

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select template to manage',
        });

        if (!picked || !('action' in picked)) return;

        if (picked.action === 'create') {
          await vscode.commands.executeCommand('lattice.tags.createTemplate');
          return;
        }

        if (picked.action === 'edit' && 'template' in picked) {
          const template = picked.template;

          const action = await vscode.window.showQuickPick(
            [
              { label: '$(edit) Edit Name', action: 'name' },
              { label: '$(edit) Edit Description', action: 'description' },
              { label: '$(add) Edit Tags to Add', action: 'tagsToAdd' },
              { label: '$(remove) Edit Tags to Remove', action: 'tagsToRemove' },
              { label: '$(trash) Delete Template', action: 'delete' },
            ],
            { placeHolder: `Manage "${template.name}"` }
          );

          if (!action) return;

          switch (action.action) {
            case 'name': {
              const newName = await vscode.window.showInputBox({
                prompt: 'Enter new template name',
                value: template.name,
                validateInput: (value) => {
                  if (!value.trim()) return 'Name is required';
                  const existing = tagManager.getTemplateByName?.(value);
                  if (existing && existing.id !== template.id) {
                    return 'A template with this name already exists';
                  }
                  return null;
                },
              });
              if (newName && newName !== template.name) {
                tagManager.updateTemplate?.(template.id, { name: newName });
                vscode.window.showInformationMessage(`Renamed template to "${newName}"`);
              }
              break;
            }
            case 'description': {
              const newDesc = await vscode.window.showInputBox({
                prompt: 'Enter new description (leave empty to remove)',
                value: template.description || '',
              });
              if (newDesc !== undefined) {
                tagManager.updateTemplate?.(template.id, {
                  description: newDesc || null,
                });
                vscode.window.showInformationMessage('Updated template description');
              }
              break;
            }
            case 'tagsToAdd': {
              const newTags = await vscode.window.showInputBox({
                prompt: 'Enter tags to add (comma-separated)',
                value: template.tagsToAdd.join(', '),
                validateInput: (value) => {
                  if (!value.trim()) return 'At least one tag is required';
                  return null;
                },
              });
              if (newTags) {
                const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
                tagManager.updateTemplate?.(template.id, { tagsToAdd: tags });
                vscode.window.showInformationMessage('Updated tags to add');
              }
              break;
            }
            case 'tagsToRemove': {
              const newTags = await vscode.window.showInputBox({
                prompt: 'Enter tags to remove (comma-separated, leave empty to clear)',
                value: template.tagsToRemove.join(', '),
              });
              if (newTags !== undefined) {
                const tags = newTags
                  ? newTags.split(',').map((t) => t.trim()).filter(Boolean)
                  : null;
                tagManager.updateTemplate?.(template.id, { tagsToRemove: tags });
                vscode.window.showInformationMessage('Updated tags to remove');
              }
              break;
            }
            case 'delete': {
              const confirm = await vscode.window.showWarningMessage(
                `Delete template "${template.name}"?`,
                { modal: true },
                'Delete'
              );
              if (confirm === 'Delete') {
                tagManager.deleteTemplate?.(template.id);
                vscode.window.showInformationMessage(`Deleted template "${template.name}"`);
              }
              break;
            }
          }
        }
      }
    )
  );

  // ==================== Alias Commands ====================

  // Create alias for a tag
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.createAlias',
      async (arg?: string | { type: string; tag: Tag }) => {
        if (!tagManager.createAlias) {
          vscode.window.showWarningMessage('Aliases are not supported in this configuration');
          return;
        }

        let primaryTag = extractTagName(arg);

        // If no tag provided, let user pick one
        if (!primaryTag) {
          const tags = tagManager.getAllTags();
          if (tags.length === 0) {
            vscode.window.showInformationMessage('No tags exist yet');
            return;
          }

          const picked = await vscode.window.showQuickPick(
            tags.map((t) => ({
              label: t.displayName,
              description: tagManager.getAliasesForTag?.(t.name)?.length
                ? `Aliases: ${tagManager.getAliasesForTag!(t.name).join(', ')}`
                : undefined,
              tag: t.name,
            })),
            { placeHolder: 'Select tag to create alias for' }
          );
          if (!picked) return;
          primaryTag = picked.tag;
        }

        const alias = await vscode.window.showInputBox({
          prompt: `Enter alias for "${primaryTag}"`,
          placeHolder: 'e.g., ml (will resolve to machine-learning)',
          validateInput: (value) => {
            if (!value.trim()) return 'Alias is required';
            if (tagManager.isAlias?.(value)) return 'This alias already exists';
            if (tagManager.getAllTags().some((t) => t.name === value.toLowerCase())) {
              return 'This is already a tag name';
            }
            return null;
          },
        });

        if (alias) {
          const success = tagManager.createAlias(alias, primaryTag);
          if (success) {
            vscode.window.showInformationMessage(
              `Created alias "${alias}" → "${primaryTag}"`
            );
          } else {
            vscode.window.showErrorMessage('Failed to create alias');
          }
        }
      }
    )
  );

  // Manage aliases
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.manageAliases',
      async () => {
        if (!tagManager.getAllAliases) {
          vscode.window.showWarningMessage('Aliases are not supported in this configuration');
          return;
        }

        const aliases = tagManager.getAllAliases();

        const items: Array<vscode.QuickPickItem & { action?: string; alias?: string; primaryTag?: string }> = [
          { label: '$(add) Create New Alias', action: 'create' },
        ];

        if (aliases.length > 0) {
          items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
          for (const a of aliases) {
            items.push({
              label: a.alias,
              description: `→ ${a.primaryTag}`,
              action: 'edit',
              alias: a.alias,
              primaryTag: a.primaryTag,
            });
          }
        }

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: aliases.length === 0 
            ? 'No aliases exist. Create one?' 
            : 'Select alias to manage',
        });

        if (!picked || !picked.action) return;

        if (picked.action === 'create') {
          await vscode.commands.executeCommand('lattice.tags.createAlias');
          return;
        }

        if (picked.action === 'edit' && picked.alias) {
          const action = await vscode.window.showQuickPick(
            [
              { label: '$(edit) Change Primary Tag', action: 'change' },
              { label: '$(trash) Delete Alias', action: 'delete' },
            ],
            { placeHolder: `Manage alias "${picked.alias}" → "${picked.primaryTag}"` }
          );

          if (!action) return;

          switch (action.action) {
            case 'change': {
              const tags = tagManager.getAllTags();
              const newPrimary = await vscode.window.showQuickPick(
                tags.map((t) => ({
                  label: t.displayName,
                  description: t.name === picked.primaryTag ? '(current)' : undefined,
                  tag: t.name,
                })),
                { placeHolder: 'Select new primary tag' }
              );

              if (newPrimary && newPrimary.tag !== picked.primaryTag) {
                tagManager.updateAlias?.(picked.alias, newPrimary.tag);
                vscode.window.showInformationMessage(
                  `Updated alias "${picked.alias}" → "${newPrimary.tag}"`
                );
              }
              break;
            }
            case 'delete': {
              const confirm = await vscode.window.showWarningMessage(
                `Delete alias "${picked.alias}"?`,
                { modal: true },
                'Delete'
              );
              if (confirm === 'Delete') {
                tagManager.deleteAlias?.(picked.alias);
                vscode.window.showInformationMessage(`Deleted alias "${picked.alias}"`);
              }
              break;
            }
          }
        }
      }
    )
  );

  // ==================== Hierarchy Commands ====================

  // Set tag parent (create hierarchy)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.setParent',
      async (arg?: string | { type: string; tag: Tag }) => {
        if (!tagManager.setTagParent) {
          vscode.window.showWarningMessage('Tag hierarchy is not supported in this configuration');
          return;
        }

        let childTag = extractTagName(arg);

        // If no tag provided, let user pick one
        if (!childTag) {
          const tags = tagManager.getAllTags();
          if (tags.length === 0) {
            vscode.window.showInformationMessage('No tags exist yet');
            return;
          }

          const picked = await vscode.window.showQuickPick(
            tags.map((t) => {
              const parent = tagManager.getTagParent?.(t.name);
              return {
                label: t.displayName,
                description: parent ? `Parent: ${parent}` : 'No parent',
                tag: t.name,
              };
            }),
            { placeHolder: 'Select tag to set parent for' }
          );
          if (!picked) return;
          childTag = picked.tag;
        }

        const currentParent = tagManager.getTagParent?.(childTag);
        const tags = tagManager.getAllTags().filter((t) => t.name !== childTag);

        const items: Array<vscode.QuickPickItem & { tag?: string | null }> = [
          { label: '$(close) No Parent (Root Level)', tag: null },
          { label: '', kind: vscode.QuickPickItemKind.Separator },
          ...tags.map((t) => {
            // Check for potential cycle
            const descendants = tagManager.getTagDescendants?.(childTag!) ?? [];
            const wouldCycle = descendants.includes(t.name);
            return {
              label: t.displayName,
              description: t.name === currentParent
                ? '(current parent)'
                : wouldCycle
                  ? '(would create cycle)'
                  : tagManager.getTagDisplayPath?.(t.name),
              tag: t.name,
              disabled: wouldCycle,
            };
          }).filter((item) => !item.disabled),
        ];

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Select parent for "${childTag}"`,
        });

        if (picked !== undefined && picked.tag !== undefined) {
          const success = tagManager.setTagParent(childTag, picked.tag);
          if (success) {
            if (picked.tag) {
              vscode.window.showInformationMessage(
                `Set "${childTag}" as child of "${picked.tag}"`
              );
            } else {
              vscode.window.showInformationMessage(
                `Moved "${childTag}" to root level`
              );
            }
          } else {
            vscode.window.showErrorMessage('Failed to set parent');
          }
        }
      }
    )
  );

  // Show tag hierarchy path
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.showHierarchy',
      async (arg?: string | { type: string; tag: Tag }) => {
        if (!tagManager.getTagDisplayPath) {
          vscode.window.showWarningMessage('Tag hierarchy is not supported in this configuration');
          return;
        }

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
              description: tagManager.getTagDisplayPath?.(t.name),
              tag: t.name,
            })),
            { placeHolder: 'Select tag to see hierarchy' }
          );
          if (!picked) return;
          tagName = picked.tag;
        }

        const displayPath = tagManager.getTagDisplayPath(tagName);
        const ancestors = tagManager.getTagAncestors?.(tagName) ?? [];
        const children = tagManager.getTagChildren?.(tagName) ?? [];
        const descendants = tagManager.getTagDescendants?.(tagName) ?? [];

        const lines = [
          `**${displayPath}**`,
          '',
          `Path depth: ${ancestors.length + 1}`,
          `Direct children: ${children.length}`,
          `Total descendants: ${descendants.length}`,
        ];

        if (ancestors.length > 0) {
          lines.push('', `Ancestors: ${ancestors.join(' → ')}`);
        }
        if (children.length > 0) {
          lines.push('', `Children: ${children.join(', ')}`);
        }

        vscode.window.showInformationMessage(lines.join('\n'));
      }
    )
  );

  // Browse with hierarchy (show files under tag and descendants)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.browseWithDescendants',
      async (arg?: string | { type: string; tag: Tag }) => {
        if (!tagManager.getFilesWithTagOrDescendants) {
          vscode.window.showWarningMessage('Tag hierarchy is not supported in this configuration');
          return;
        }

        let tagName = extractTagName(arg);

        if (!tagName) {
          const tags = tagManager.getAllTags();
          if (tags.length === 0) {
            vscode.window.showInformationMessage('No tags exist yet');
            return;
          }

          const picked = await vscode.window.showQuickPick(
            tags.map((t) => {
              const descendants = tagManager.getTagDescendants?.(t.name) ?? [];
              return {
                label: t.displayName,
                description: descendants.length > 0
                  ? `${descendants.length} descendant tags`
                  : 'No descendants',
                tag: t.name,
              };
            }),
            { placeHolder: 'Select tag to browse (including descendants)' }
          );
          if (!picked) return;
          tagName = picked.tag;
        }

        const files = tagManager.getFilesWithTagOrDescendants(tagName);
        const descendants = tagManager.getTagDescendants?.(tagName) ?? [];

        if (files.length === 0) {
          vscode.window.showInformationMessage(
            `No files found with "${tagName}" or its descendants`
          );
          return;
        }

        const items = files.map((f) => ({
          label: f.filename,
          description: f.path,
          detail: `Tags: ${f.tags.join(', ')}`,
          uri: getUriFromRelativePath(f.path),
        }));

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Files with "${tagName}"${descendants.length > 0 ? ` or descendants (${files.length} files)` : ''}`,
        });

        if (picked?.uri) {
          await vscode.commands.executeCommand('vscode.open', picked.uri);
        }
      }
    )
  );

  // ==================== Folder Rule Commands ====================

  // Create folder rule
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.createFolderRule',
      async (arg?: vscode.Uri) => {
        if (!tagManager.createFolderRule) {
          vscode.window.showWarningMessage('Folder rules are not supported in this configuration');
          return;
        }

        // Get folder path
        let folderPath: string | undefined;
        if (arg?.fsPath) {
          folderPath = getRelativePath(arg);
        } else {
          folderPath = await vscode.window.showInputBox({
            prompt: 'Enter folder path (relative to workspace)',
            placeHolder: 'src/components',
          });
        }
        if (!folderPath) return;

        // Check if rule already exists
        const existing = tagManager.getFolderRule?.(folderPath);
        if (existing) {
          vscode.window.showWarningMessage(`A rule already exists for "${folderPath}"`);
          return;
        }

        // Get tags to inherit
        const tagInput = await vscode.window.showInputBox({
          prompt: 'Enter tags to inherit (comma-separated)',
          placeHolder: 'frontend, react, component',
        });
        if (!tagInput) return;

        const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
        if (tags.length === 0) return;

        // Ask about recursive
        const recursiveChoice = await vscode.window.showQuickPick(
          [
            { label: 'Yes', description: 'Apply to all files in subfolders', value: true },
            { label: 'No', description: 'Only apply to files directly in this folder', value: false },
          ],
          { placeHolder: 'Apply recursively to subfolders?' }
        );
        if (!recursiveChoice) return;

        const result = tagManager.createFolderRule(folderPath, tags, {
          recursive: recursiveChoice.value,
        });

        if (result) {
          vscode.window.showInformationMessage(
            `Created folder rule: "${folderPath}" → [${tags.join(', ')}]`
          );
        } else {
          vscode.window.showErrorMessage('Failed to create folder rule');
        }
      }
    )
  );

  // Manage folder rules
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.tags.manageFolderRules', async () => {
      if (!tagManager.getAllFolderRules) {
        vscode.window.showWarningMessage('Folder rules are not supported in this configuration');
        return;
      }

      const rules = tagManager.getAllFolderRules();

      if (rules.length === 0) {
        const create = await vscode.window.showQuickPick(
          [
            { label: '$(add) Create New Folder Rule', action: 'create' },
          ],
          { placeHolder: 'No folder rules exist yet' }
        );
        if (create?.action === 'create') {
          await vscode.commands.executeCommand('lattice.tags.createFolderRule');
        }
        return;
      }

      type RuleItem = { label: string; description: string; detail: string; rule: typeof rules[0] | null; action?: string };
      const items: RuleItem[] = [
        { label: '$(add) Create New Folder Rule', description: '', detail: '', rule: null, action: 'create' },
        { label: '', description: '', detail: '', rule: null, action: 'separator' },
        ...rules.map((r): RuleItem => ({
          label: r.folderPath,
          description: r.recursive ? '(recursive)' : '(direct only)',
          detail: `Tags: ${r.inheritedTags.join(', ')}`,
          rule: r,
        })),
      ];

      // Filter out the separator since QuickPick doesn't support it directly
      const pickItems = items.filter((i) => i.action !== 'separator');

      const picked = await vscode.window.showQuickPick(pickItems, {
        placeHolder: 'Select a folder rule to manage',
      });
      if (!picked) return;

      if (picked.action === 'create') {
        await vscode.commands.executeCommand('lattice.tags.createFolderRule');
        return;
      }

      if (!picked.rule) return;

      // Show management options for this rule
      const action = await vscode.window.showQuickPick(
        [
          { label: '$(edit) Edit Tags', action: 'editTags' },
          { label: '$(settings) Toggle Recursive', action: 'toggleRecursive' },
          { label: '$(trash) Delete Rule', action: 'delete' },
        ],
        { placeHolder: `Manage rule: ${picked.rule.folderPath}` }
      );
      if (!action) return;

      switch (action.action) {
        case 'editTags': {
          const newTags = await vscode.window.showInputBox({
            prompt: 'Enter new tags (comma-separated)',
            value: picked.rule.inheritedTags.join(', '),
          });
          if (newTags !== undefined) {
            const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
            tagManager.updateFolderRule?.(picked.rule.folderPath, { inheritedTags: tags });
            vscode.window.showInformationMessage('Folder rule updated');
          }
          break;
        }
        case 'toggleRecursive': {
          tagManager.updateFolderRule?.(picked.rule.folderPath, {
            recursive: !picked.rule.recursive,
          });
          vscode.window.showInformationMessage(
            `Folder rule is now ${!picked.rule.recursive ? 'recursive' : 'direct only'}`
          );
          break;
        }
        case 'delete': {
          const confirm = await vscode.window.showWarningMessage(
            `Delete folder rule for "${picked.rule.folderPath}"?`,
            { modal: true },
            'Delete'
          );
          if (confirm === 'Delete') {
            tagManager.deleteFolderRule?.(picked.rule.folderPath);
            vscode.window.showInformationMessage('Folder rule deleted');
          }
          break;
        }
      }
    })
  );

  // Show effective tags for current file
  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.tags.showEffectiveTags', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No file is currently open');
        return;
      }

      if (!tagManager.getEffectiveTags) {
        // Fall back to just showing explicit tags
        const tags = tagManager.getTags(editor.document.uri);
        if (tags.length === 0) {
          vscode.window.showInformationMessage('This file has no tags');
        } else {
          vscode.window.showInformationMessage(`Tags: ${tags.join(', ')}`);
        }
        return;
      }

      const { explicit, inherited } = tagManager.getEffectiveTags(editor.document.uri);

      if (explicit.length === 0 && inherited.length === 0) {
        vscode.window.showInformationMessage('This file has no tags');
        return;
      }

      const lines: string[] = [];
      if (explicit.length > 0) {
        lines.push(`Explicit: ${explicit.join(', ')}`);
      }
      if (inherited.length > 0) {
        lines.push(`Inherited: ${inherited.join(', ')}`);
      }

      vscode.window.showInformationMessage(lines.join(' | '));
    })
  );

  // Exclude file from inherited tag
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lattice.tags.excludeInheritedTag',
      async (arg?: vscode.Uri) => {
        if (!tagManager.addFileTagExclusion || !tagManager.getEffectiveInheritedTags) {
          vscode.window.showWarningMessage('Tag exclusions are not supported in this configuration');
          return;
        }

        const uri = arg ?? vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
          vscode.window.showWarningMessage('No file selected');
          return;
        }

        const inherited = tagManager.getEffectiveInheritedTags(uri);
        if (inherited.length === 0) {
          vscode.window.showInformationMessage('This file has no inherited tags');
          return;
        }

        const picked = await vscode.window.showQuickPick(
          inherited.map((t) => ({ label: t, tag: t })),
          { placeHolder: 'Select inherited tag to exclude from this file' }
        );
        if (!picked) return;

        const result = tagManager.addFileTagExclusion(uri, picked.tag);
        if (result) {
          vscode.window.showInformationMessage(`Excluded "${picked.tag}" from this file`);
        } else {
          vscode.window.showErrorMessage('Failed to add exclusion');
        }
      }
    )
  );
}
