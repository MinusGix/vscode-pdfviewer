/**
 * TagManager Interface - Common interface for JSON and SQLite backends
 * 
 * This allows the extension to use either backend transparently.
 */

import * as vscode from 'vscode';
import { TaggedFile, Tag, TagQuery, TagChangeEvent } from './tagTypes';
import { TagTemplate } from '../database';

/**
 * Interface that both TagManager implementations must satisfy
 */
export interface ITagManager extends vscode.Disposable {
  // Event for tag changes
  readonly onDidChangeTags: vscode.Event<TagChangeEvent>;

  // Initialization
  initialize(): Promise<void>;
  isInitialized?(): boolean;

  // File operations
  addTags(uri: vscode.Uri, tags: string[]): Promise<void>;
  removeTags(uri: vscode.Uri, tags: string[]): Promise<void>;
  setTags(uri: vscode.Uri, tags: string[]): Promise<void>;
  getTags(uri: vscode.Uri): string[];
  getTagsWithDisplayNames(uri: vscode.Uri): Array<{ name: string; displayName: string }>;
  hasTag(uri: vscode.Uri, tag: string): boolean;

  // Tag operations
  getAllTags(): Tag[];
  getFilesWithTag(tag: string): TaggedFile[];
  renameTag(oldName: string, newName: string): Promise<void>;
  deleteTag(tagName: string): Promise<void>;
  setTagColor(tagName: string, color: string | null): void;
  getTagColorValue(tagName: string): string;

  // Query operations
  findFiles(query: TagQuery): TaggedFile[];
  getAllTrackedFiles(): TaggedFile[];
  getBrokenFiles(): TaggedFile[];

  // Recovery operations
  checkAllFiles(): Promise<void>;
  findMissingFile(fileId: string): Promise<void>;
  reassignFile(fileId: string, newUri: vscode.Uri): Promise<void>;
  dismissBrokenFile(fileId: string): void;

  // Template operations (optional - only SQLite backend supports these)
  getAllTemplates?(): TagTemplate[];
  getTemplate?(id: string): TagTemplate | null;
  getTemplateByName?(name: string): TagTemplate | null;
  createTemplate?(
    name: string,
    tagsToAdd: string[],
    options?: {
      description?: string;
      tagsToRemove?: string[];
      shortcut?: string;
    }
  ): string;
  updateTemplate?(
    id: string,
    updates: {
      name?: string;
      description?: string | null;
      tagsToAdd?: string[];
      tagsToRemove?: string[] | null;
      shortcut?: string | null;
    }
  ): boolean;
  deleteTemplate?(id: string): boolean;
  applyTemplate?(uri: vscode.Uri, templateId: string): Promise<boolean>;
  applyTemplateToFiles?(
    uris: vscode.Uri[],
    templateId: string
  ): Promise<{ success: number; failed: number }>;

  // Alias operations (optional - only SQLite backend supports these)
  createAlias?(alias: string, primaryTag: string): boolean;
  getAliasesForTag?(tagName: string): string[];
  getAllAliases?(): Array<{ alias: string; primaryTag: string }>;
  deleteAlias?(alias: string): boolean;
  updateAlias?(alias: string, newPrimaryTag: string): boolean;
  isAlias?(tagName: string): boolean;
  resolveAlias?(tagName: string): string;

  // Hierarchy operations (optional - only SQLite backend supports these)
  setTagParent?(childTag: string, parentTag: string | null): boolean;
  getTagParent?(tagName: string): string | null;
  getTagChildren?(parentTag: string): string[];
  getTagAncestors?(tagName: string): string[];
  getTagDescendants?(tagName: string): string[];
  getTagPath?(tagName: string): string[];
  getTagDisplayPath?(tagName: string): string;
  getRootTags?(): string[];
  getFilesWithTagOrDescendants?(tagName: string): TaggedFile[];
  getTagHierarchy?(): import('../database').TagHierarchyNode[];
}

/**
 * Global tag manager instance
 */
let globalTagManager: ITagManager | null = null;

/**
 * Get the current tag manager instance
 */
export function getTagManager(): ITagManager {
  if (!globalTagManager) {
    throw new Error('TagManager not initialized. Call initializeTagManager first.');
  }
  return globalTagManager;
}

/**
 * Set the global tag manager instance
 */
export function setTagManager(manager: ITagManager): void {
  globalTagManager = manager;
}

/**
 * Check if tag manager is available
 */
export function hasTagManager(): boolean {
  return globalTagManager !== null;
}

