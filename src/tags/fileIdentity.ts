/**
 * File identity and recovery system
 *
 * Handles tracking files even when they're moved or renamed
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { TaggedFile, RecoveryCandidate } from './tagTypes';

/**
 * Supported file extensions for tagging
 */
export const SUPPORTED_EXTENSIONS = [
  '.md',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.txt',
  '.url',
];

/**
 * Check if a file extension is supported for tagging
 */
export function isSupportedFile(uri: vscode.Uri): boolean {
  const ext = path.extname(uri.fsPath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Get workspace-relative path from URI
 */
export function getRelativePath(uri: vscode.Uri): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (workspaceFolder) {
    return path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  }
  // Fallback to fsPath if not in workspace
  return uri.fsPath;
}

/**
 * Get URI from workspace-relative path
 */
export function getUriFromRelativePath(
  relativePath: string
): vscode.Uri | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }

  // Try each workspace folder
  for (const folder of workspaceFolders) {
    const fullPath = path.join(folder.uri.fsPath, relativePath);
    return vscode.Uri.file(fullPath);
  }

  return undefined;
}

/**
 * Generate a content signature for text files
 * Uses hash of first and last chunks for efficiency
 */
export async function generateContentSignature(
  uri: vscode.Uri
): Promise<string | undefined> {
  const ext = path.extname(uri.fsPath).toLowerCase();
  const textExtensions = ['.md', '.txt', '.url'];

  if (!textExtensions.includes(ext)) {
    return undefined;
  }

  try {
    const content = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(content).toString('utf8');

    // Take first 1KB and last 1KB
    const chunkSize = 1024;
    const firstChunk = text.slice(0, chunkSize);
    const lastChunk = text.length > chunkSize ? text.slice(-chunkSize) : '';

    const combined = firstChunk + '|||' + lastChunk + '|||' + text.length;
    return crypto.createHash('md5').update(combined).digest('hex').slice(0, 16);
  } catch {
    return undefined;
  }
}

/**
 * Get file metadata for identity tracking
 */
export async function getFileMetadata(
  uri: vscode.Uri
): Promise<Partial<TaggedFile>> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    const contentSig = await generateContentSignature(uri);

    return {
      filename: path.basename(uri.fsPath),
      fileSize: stat.size,
      lastModified: stat.mtime,
      contentSignature: contentSig,
      lastSeen: Date.now(),
      status: 'ok',
    };
  } catch {
    return {
      filename: path.basename(uri.fsPath),
      status: 'missing',
    };
  }
}

/**
 * Check if a file exists at the given path
 */
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find potential matches for a missing file
 */
export async function findRecoveryCandidates(
  trackedFile: TaggedFile
): Promise<RecoveryCandidate[]> {
  const candidates: RecoveryCandidate[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    return candidates;
  }

  // Search for files with the same name
  const searchPattern = `**/${trackedFile.filename}`;
  const foundFiles = await vscode.workspace.findFiles(
    searchPattern,
    '**/node_modules/**',
    50
  );

  for (const uri of foundFiles) {
    // Skip if it's the same path (shouldn't happen but check anyway)
    const relativePath = getRelativePath(uri);
    if (relativePath === trackedFile.path) {
      continue;
    }

    let confidence = 0.3; // Base confidence for same filename
    const reasons: string[] = ['Same filename'];

    try {
      const stat = await vscode.workspace.fs.stat(uri);

      // Check file size
      if (trackedFile.fileSize && stat.size === trackedFile.fileSize) {
        confidence += 0.2;
        reasons.push('Same file size');
      }

      // Check content signature for text files
      if (trackedFile.contentSignature) {
        const newSig = await generateContentSignature(uri);
        if (newSig === trackedFile.contentSignature) {
          confidence += 0.4;
          reasons.push('Matching content signature');
        }
      }

      // Bonus for being in a similar directory structure
      const oldDir = path.dirname(trackedFile.path);
      const newDir = path.dirname(relativePath);
      if (oldDir.split(path.sep).some((part) => newDir.includes(part))) {
        confidence += 0.1;
        reasons.push('Similar directory structure');
      }
    } catch {
      // Can't stat file, keep low confidence
    }

    candidates.push({
      uri,
      confidence: Math.min(confidence, 1.0),
      reason: reasons.join(', '),
    });
  }

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);

  return candidates;
}

/**
 * Calculate similarity between two paths (for ranking candidates)
 */
export function pathSimilarity(path1: string, path2: string): number {
  const parts1 = path1.split(path.sep);
  const parts2 = path2.split(path.sep);

  let common = 0;
  for (const part of parts1) {
    if (parts2.includes(part)) {
      common++;
    }
  }

  return common / Math.max(parts1.length, parts2.length);
}
