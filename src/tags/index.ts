/**
 * Tags module - File tagging system for Lattice
 */

// Tag manager interface and initialization
export { ITagManager, getTagManager, setTagManager, hasTagManager } from './tagManagerInterface';
export { initializeTagSystem, getOrInitializeTagManager } from './tagInitialization';

// Legacy JSON-based TagManager (will be deprecated)
export { TagManager } from './tagManager';

// New SQLite-based TagManager
export { TagManagerSqlite } from './tagManagerSqlite';

export {
  TagExplorerProvider,
  registerTagCommands,
} from './tagExplorerProvider';
export * from './tagTypes';
export * from './tagColors';
export * from './fileIdentity';
export * from './tagExplorerHelpers';
