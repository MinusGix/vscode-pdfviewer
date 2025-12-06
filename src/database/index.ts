/**
 * Database module - Unified SQLite storage for Lattice
 */

export { LatticeDatabase, setExtensionUri } from './latticeDatabase';
export { SCHEMA_VERSION, SCHEMA_SQL } from './schema';
export * from './types';
export {
  checkLegacyStorage,
  readLegacyStorage,
  migrateToSqlite,
  performFullMigration,
} from './migrations';
