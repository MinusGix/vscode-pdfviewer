import * as vscode from 'vscode';
import { MdCard, extractMdCards } from './card';

export class MdParser {
    /**
     * Parse a markdown file for MdCards
     * @param uri The URI of the markdown file to parse
     * @returns Array of MdCard objects found in the file
     */
    public static async parseFile(uri: vscode.Uri): Promise<MdCard[]> {
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const mdContent = new TextDecoder().decode(content);
            return extractMdCards(mdContent);
        } catch (error) {
            console.error(`Failed to parse markdown file: ${uri.fsPath}`, error);
            return [];
        }
    }

    /**
     * Parse all markdown files in a workspace folder for MdCards
     * @param workspaceFolder The workspace folder to search in
     * @returns Map of file URIs to arrays of MdCard objects
     */
    public static async parseWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder): Promise<Map<vscode.Uri, MdCard[]>> {
        const results = new Map<vscode.Uri, MdCard[]>();

        // Find all markdown files in the workspace
        const mdFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, '**/*.md'),
            '**/node_modules/**'
        );

        // Parse each file
        for (const uri of mdFiles) {
            const cards = await this.parseFile(uri);
            if (cards.length > 0) {
                results.set(uri, cards);
            }
        }

        return results;
    }

    /**
     * Parse all markdown files in all workspace folders for MdCards
     * @returns Map of file URIs to arrays of MdCard objects
     */
    public static async parseWorkspace(): Promise<Map<vscode.Uri, MdCard[]>> {
        const results = new Map<vscode.Uri, MdCard[]>();

        // Get all workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return results;
        }

        // Parse each workspace folder
        for (const folder of workspaceFolders) {
            const folderResults = await this.parseWorkspaceFolder(folder);
            // Merge results
            for (const [uri, cards] of folderResults) {
                results.set(uri, cards);
            }
        }

        return results;
    }
} 