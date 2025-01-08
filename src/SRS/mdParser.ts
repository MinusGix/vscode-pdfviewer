import * as vscode from 'vscode';
import { MdCard, extractMdCardsWithPosition, CardPosition } from './card';

export interface ParseResult {
    cards: MdCard[];
    positions: CardPosition[];
}

export class MdParser {
    /**
     * Parse a markdown file for MdCards
     * @param uri The URI of the markdown file to parse
     * @returns Array of MdCard objects found in the file
     */
    public static async parseFile(uri: vscode.Uri): Promise<ParseResult> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const mdContent = document.getText();
            const results = extractMdCardsWithPosition(mdContent);
            return {
                cards: results.map(r => r.card),
                positions: results.map(r => r.position)
            };
        } catch (error) {
            console.error(`Failed to parse markdown file: ${uri.fsPath}`, error);
            return { cards: [], positions: [] };
        }
    }

    /**
     * Parse all markdown files in a workspace folder for MdCards
     * @param workspaceFolder The workspace folder to search in
     * @returns Map of file URIs to arrays of MdCard objects
     */
    public static async parseWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder): Promise<Map<vscode.Uri, ParseResult>> {
        const results = new Map<vscode.Uri, ParseResult>();

        // Find all markdown files in the workspace
        const mdFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, '**/*.md'),
            '**/node_modules/**'
        );

        // Parse each file
        for (const uri of mdFiles) {
            const parseResult = await this.parseFile(uri);
            if (parseResult.cards.length > 0) {
                results.set(uri, parseResult);
            }
        }

        return results;
    }

    /**
     * Parse all markdown files in all workspace folders for MdCards
     * @returns Map of file URIs to arrays of MdCard objects
     */
    public static async parseWorkspace(): Promise<Map<vscode.Uri, ParseResult>> {
        const results = new Map<vscode.Uri, ParseResult>();

        // Get all workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return results;
        }

        // Parse each workspace folder
        for (const folder of workspaceFolders) {
            const folderResults = await this.parseWorkspaceFolder(folder);
            // Merge results
            for (const [uri, parseResult] of folderResults) {
                results.set(uri, parseResult);
            }
        }

        return results;
    }
} 