import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { CardManager, CardUpdateEvent } from './cardManager';
import { MdParser } from './mdParser';
import { MdCard, CardPosition } from './card';

// Mock MdParser
vi.mock('./mdParser', () => ({
    MdParser: {
        parseFile: vi.fn(),
        parseWorkspace: vi.fn(),
        parseWorkspaceFolder: vi.fn()
    }
}));

describe('CardManager', () => {
    let manager: CardManager;
    let updateEvents: CardUpdateEvent[] = [];

    // Helper function to create a mock ParseResult
    function createMockParseResult(cards: MdCard[]): { cards: MdCard[], positions: CardPosition[] } {
        return {
            cards,
            positions: cards.map((_, i) => ({
                cardBlock: {
                    startLine: i * 5 + 1,
                    startCharacter: 0,
                    endLine: i * 5 + 5,
                    endCharacter: 3,
                    value: 'mock content'
                },
                insertPosition: {
                    line: i * 5 + 2,
                    character: 0
                },
                appendPosition: {
                    line: i * 5 + 4,
                    character: 0
                },
                fields: new Map()
            }))
        };
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        // Ensure any previous instance is disposed
        try {
            CardManager.getInstance().dispose();
        } catch (e) {
            // Ignore errors if no instance exists
        }
        manager = CardManager.getInstance();
        updateEvents = [];
        manager.onDidUpdateCards(event => updateEvents.push(event));
    });

    afterEach(() => {
        try {
            manager.dispose();
        } catch (e) {
            // Ignore errors during disposal
        }
    });

    describe('initialization', () => {
        it('should load cards from workspace on initialize', async () => {
            const mockCards: MdCard[] = [{
                front: 'Test front',
                back: 'Test back',
                tags: [],
                type: 'basic'
            }];

            const mockResults = new Map([
                [vscode.Uri.parse('file1.md'), createMockParseResult(mockCards)]
            ]);

            vi.mocked(MdParser.parseWorkspace).mockResolvedValue(mockResults);

            await manager.initialize();

            expect(MdParser.parseWorkspace).toHaveBeenCalled();
            expect(manager.getAllCards()).toEqual([expect.objectContaining({
                front: 'Test front',
                back: 'Test back',
                tags: [],
                type: 'basic'
            })]);
            expect(updateEvents).toHaveLength(1);
            expect({
                ...updateEvents[0],
                uri: updateEvents[0].uri.toString(),
                cards: updateEvents[0].cards?.map(card => ({
                    front: card.front,
                    back: card.back,
                    tags: card.tags,
                    type: card.type
                }))
            }).toEqual({
                type: 'add',
                uri: 'file1.md',
                cards: mockCards
            });
        });

        it('should handle initialization errors gracefully', async () => {
            vi.mocked(MdParser.parseWorkspace).mockRejectedValue(new Error('Parse error'));

            await manager.initialize();
            expect(manager.getAllCards()).toEqual([]);
        });

        it('should not initialize twice', async () => {
            vi.mocked(MdParser.parseWorkspace).mockResolvedValue(new Map());

            await manager.initialize();
            await manager.initialize();

            expect(MdParser.parseWorkspace).toHaveBeenCalledTimes(1);
        });
    });

    describe('workspace folder changes', () => {
        const mockFolder1 = { uri: vscode.Uri.parse('/workspace1'), name: 'ws1', index: 0 };
        const mockFolder2 = { uri: vscode.Uri.parse('/workspace2'), name: 'ws2', index: 1 };

        beforeEach(async () => {
            await manager.initialize();
            updateEvents = []; // Clear initialization events
        });

        it('should load cards from added workspace folders', async () => {
            const mockCards: MdCard[] = [{
                front: 'New workspace card',
                back: 'Test back',
                tags: [],
                type: 'basic'
            }];

            vi.mocked(MdParser.parseWorkspaceFolder).mockResolvedValue(new Map([
                [vscode.Uri.parse('/workspace2/test.md'), createMockParseResult(mockCards)]
            ]));

            // Simulate workspace folder added
            await (vscode.workspace as any).fireWorkspaceFoldersChange({
                added: [mockFolder2],
                removed: []
            });

            expect(MdParser.parseWorkspaceFolder).toHaveBeenCalledWith(mockFolder2);
            expect(updateEvents).toHaveLength(1);
            expect({
                ...updateEvents[0],
                uri: updateEvents[0].uri.toString(),
                cards: updateEvents[0].cards?.map(card => ({
                    front: card.front,
                    back: card.back,
                    tags: card.tags,
                    type: card.type
                }))
            }).toEqual({
                type: 'add',
                uri: '/workspace2/test.md',
                cards: mockCards
            });
        });

        it('should remove cards when workspace folders are removed', async () => {
            // First add some cards
            const mockCards: MdCard[] = [{
                front: 'Test front',
                back: 'Test back',
                tags: [],
                type: 'basic'
            }];

            const fileUri = vscode.Uri.parse('/workspace1/test.md');
            vi.mocked(MdParser.parseFile).mockResolvedValue(createMockParseResult(mockCards));
            await manager['handleFileChange'](fileUri);
            updateEvents = []; // Clear add events

            // Mock findFiles to return our test file
            vi.mocked(vscode.workspace.findFiles).mockResolvedValue([fileUri]);

            // Simulate workspace folder removed
            await (vscode.workspace as any).fireWorkspaceFoldersChange({
                added: [],
                removed: [mockFolder1]
            });

            expect(updateEvents).toHaveLength(1);
            expect({
                ...updateEvents[0],
                uri: updateEvents[0].uri.toString()
            }).toEqual({
                type: 'delete',
                uri: '/workspace1/test.md'
            });
            expect(manager.getCardsFromFile(fileUri)).toBeUndefined();
        });
    });

    describe('file operations', () => {
        const mockUri = vscode.Uri.file('test.md');
        const mockCards: MdCard[] = [{
            front: 'Test front',
            back: 'Test back',
            tags: [],
            type: 'basic'
        }];

        beforeEach(async () => {
            vi.mocked(MdParser.parseWorkspace).mockResolvedValue(new Map());
            await manager.initialize();
        });

        it('should handle file changes with new cards', async () => {
            vi.mocked(MdParser.parseFile).mockResolvedValue(createMockParseResult(mockCards));

            await manager['handleFileChange'](mockUri);

            expect(manager.getCardsFromFile(mockUri)).toEqual([expect.objectContaining({
                front: 'Test front',
                back: 'Test back',
                tags: [],
                type: 'basic'
            })]);
            expect(updateEvents).toHaveLength(1);
            expect({
                ...updateEvents[0],
                cards: updateEvents[0].cards?.map(card => ({
                    front: card.front,
                    back: card.back,
                    tags: card.tags,
                    type: card.type
                }))
            }).toEqual({
                type: 'add',
                uri: mockUri,
                cards: mockCards
            });
        });

        it('should handle file changes that update existing cards', async () => {
            // First add initial cards
            vi.mocked(MdParser.parseFile).mockResolvedValue(createMockParseResult(mockCards));
            await manager['handleFileChange'](mockUri);
            updateEvents = []; // Clear initial events

            // Then update with new cards
            const updatedCards = [{
                front: 'Updated front',
                back: 'Updated back',
                tags: [],
                type: 'basic'
            }];
            vi.mocked(MdParser.parseFile).mockResolvedValue(createMockParseResult(updatedCards));
            await manager['handleFileChange'](mockUri);

            expect(manager.getCardsFromFile(mockUri)).toEqual([expect.objectContaining({
                front: 'Updated front',
                back: 'Updated back',
                tags: [],
                type: 'basic'
            })]);
            expect(updateEvents).toHaveLength(1);
            expect({
                ...updateEvents[0],
                cards: updateEvents[0].cards?.map(card => ({
                    front: card.front,
                    back: card.back,
                    tags: card.tags,
                    type: card.type
                }))
            }).toEqual({
                type: 'update',
                uri: mockUri,
                cards: updatedCards
            });
        });

        it('should handle file deletion', async () => {
            // First add some cards
            vi.mocked(MdParser.parseFile).mockResolvedValue(createMockParseResult(mockCards));
            await manager['handleFileChange'](mockUri);
            updateEvents = []; // Clear initial events

            // Then delete the file
            manager['handleFileDelete'](mockUri);

            expect(manager.getCardsFromFile(mockUri)).toBeUndefined();
            expect(updateEvents).toHaveLength(1);
            expect(updateEvents[0]).toEqual({
                type: 'delete',
                uri: mockUri
            });
        });

        it('should handle parse errors by removing cards', async () => {
            // First add some cards
            vi.mocked(MdParser.parseFile).mockResolvedValue(createMockParseResult(mockCards));
            await manager['handleFileChange'](mockUri);
            updateEvents = []; // Clear initial events

            // Then simulate a parse error
            vi.mocked(MdParser.parseFile).mockRejectedValue(new Error('Parse error'));
            await manager['handleFileChange'](mockUri);

            expect(manager.getCardsFromFile(mockUri)).toBeUndefined();
            expect(updateEvents).toHaveLength(1);
            expect(updateEvents[0]).toEqual({
                type: 'delete',
                uri: mockUri
            });
        });
    });

    describe('card retrieval', () => {
        const mockUri1 = vscode.Uri.file('test1.md');
        const mockUri2 = vscode.Uri.file('test2.md');
        const mockCards1: MdCard[] = [{
            front: 'Test1 front',
            back: 'Test1 back',
            tags: [],
            type: 'basic'
        }];
        const mockCards2: MdCard[] = [{
            front: 'Test2 front',
            back: 'Test2 back',
            tags: [],
            type: 'basic'
        }];

        beforeEach(async () => {
            vi.mocked(MdParser.parseWorkspace).mockResolvedValue(new Map([
                [mockUri1, createMockParseResult(mockCards1)],
                [mockUri2, createMockParseResult(mockCards2)]
            ]));
            await manager.initialize();
        });

        it('should get cards from specific file', () => {
            expect(manager.getCardsFromFile(mockUri1)).toEqual([expect.objectContaining({
                front: 'Test1 front',
                back: 'Test1 back',
                tags: [],
                type: 'basic'
            })]);
            expect(manager.getCardsFromFile(mockUri2)).toEqual([expect.objectContaining({
                front: 'Test2 front',
                back: 'Test2 back',
                tags: [],
                type: 'basic'
            })]);
        });

        it('should get all cards', () => {
            expect(manager.getAllCards()).toEqual([
                expect.objectContaining({
                    front: 'Test1 front',
                    back: 'Test1 back',
                    tags: [],
                    type: 'basic'
                }),
                expect.objectContaining({
                    front: 'Test2 front',
                    back: 'Test2 back',
                    tags: [],
                    type: 'basic'
                })
            ]);
        });

        it('should get all files with cards', () => {
            const files = manager.getFilesWithCards();
            expect(files).toHaveLength(2);
            expect(files.map(uri => uri.toString())).toEqual([
                mockUri1.toString(),
                mockUri2.toString()
            ]);
        });
    });

    describe('file disable/enable functionality', () => {
        let mockActiveEditor: any;
        let mockDocument: any;
        let mockWorkspaceEditInstance: any;

        beforeEach(() => {
            mockDocument = {
                uri: vscode.Uri.file('test.md'),
                fileName: 'test.md',
                getText: vi.fn()
            };

            mockActiveEditor = {
                document: mockDocument,
                edit: vi.fn(),
                selection: {
                    active: new vscode.Position(0, 0)
                }
            };

            mockWorkspaceEditInstance = {
                insert: vi.fn(),
                delete: vi.fn()
            };

            // Reset mocks
            vi.mocked(vscode.WorkspaceEdit).mockClear();
            vi.mocked(vscode.WorkspaceEdit).mockReturnValue(mockWorkspaceEditInstance);
            vi.mocked(vscode.window.showInformationMessage).mockClear();
            vi.mocked(vscode.window.showWarningMessage).mockClear();
            vi.mocked(vscode.workspace.applyEdit).mockClear();
        });

        describe('disableCurrentFile', () => {
            it('should add disabled marker to file', async () => {
                const fileContent = '# Test File\n\n:::card\nfront: Test\nback: Test back\ntype: basic\n:::';

                mockDocument.getText.mockReturnValue(fileContent);
                Object.defineProperty(vscode.window, 'activeTextEditor', {
                    get: vi.fn().mockReturnValue(mockActiveEditor),
                    configurable: true
                });

                await manager.disableCurrentFile();

                expect(vscode.WorkspaceEdit).toHaveBeenCalled();
                expect(mockWorkspaceEditInstance.insert).toHaveBeenCalledWith(
                    mockDocument.uri,
                    new vscode.Position(0, 0),
                    '<!-- lattice:disabled -->\n'
                );
                expect(vscode.workspace.applyEdit).toHaveBeenCalledWith(mockWorkspaceEditInstance);
                expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                    'File disabled. Cards from this file will no longer appear in reviews.'
                );
            });

            it('should show warning for non-markdown file', async () => {
                mockDocument.fileName = 'test.txt';
                Object.defineProperty(vscode.window, 'activeTextEditor', {
                    get: vi.fn().mockReturnValue(mockActiveEditor),
                    configurable: true
                });

                await manager.disableCurrentFile();

                expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
                    'Current file is not a markdown file'
                );
                expect(vscode.WorkspaceEdit).not.toHaveBeenCalled();
            });

            it('should show message if file is already disabled', async () => {
                const fileContent = '<!-- lattice:disabled -->\n# Test File\n\n:::card\nfront: Test\nback: Test back\ntype: basic\n:::';

                mockDocument.getText.mockReturnValue(fileContent);
                Object.defineProperty(vscode.window, 'activeTextEditor', {
                    get: vi.fn().mockReturnValue(mockActiveEditor),
                    configurable: true
                });

                await manager.disableCurrentFile();

                expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                    'File is already disabled'
                );
                expect(vscode.WorkspaceEdit).not.toHaveBeenCalled();
            });

            it('should show message when no active editor', async () => {
                Object.defineProperty(vscode.window, 'activeTextEditor', {
                    get: vi.fn().mockReturnValue(undefined),
                    configurable: true
                });

                await manager.disableCurrentFile();

                expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                    'No active text editor'
                );
            });
        });

        describe('enableCurrentFile', () => {
            it('should remove disabled marker from file', async () => {
                const fileContent = '<!-- lattice:disabled -->\n# Test File\n\n:::card\nfront: Test\nback: Test back\ntype: basic\n:::';

                mockDocument.getText.mockReturnValue(fileContent);
                Object.defineProperty(vscode.window, 'activeTextEditor', {
                    get: vi.fn().mockReturnValue(mockActiveEditor),
                    configurable: true
                });

                await manager.enableCurrentFile();

                expect(vscode.WorkspaceEdit).toHaveBeenCalled();
                expect(mockWorkspaceEditInstance.delete).toHaveBeenCalledWith(
                    mockDocument.uri,
                    new vscode.Range(
                        new vscode.Position(0, 0),
                        new vscode.Position(1, 0)
                    )
                );
                expect(vscode.workspace.applyEdit).toHaveBeenCalledWith(mockWorkspaceEditInstance);
                expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                    'File enabled. Cards from this file will now appear in reviews.'
                );
            });

            it('should handle disabled marker in different positions', async () => {
                const fileContent = '# Test File\n<!-- lattice:disabled -->\n\n:::card\nfront: Test\nback: Test back\ntype: basic\n:::';

                mockDocument.getText.mockReturnValue(fileContent);
                Object.defineProperty(vscode.window, 'activeTextEditor', {
                    get: vi.fn().mockReturnValue(mockActiveEditor),
                    configurable: true
                });

                await manager.enableCurrentFile();

                expect(mockWorkspaceEditInstance.delete).toHaveBeenCalledWith(
                    mockDocument.uri,
                    new vscode.Range(
                        new vscode.Position(1, 0),
                        new vscode.Position(2, 0)
                    )
                );
            });

            it('should show message if file is not disabled', async () => {
                const fileContent = '# Test File\n\n:::card\nfront: Test\nback: Test back\ntype: basic\n:::';

                mockDocument.getText.mockReturnValue(fileContent);
                Object.defineProperty(vscode.window, 'activeTextEditor', {
                    get: vi.fn().mockReturnValue(mockActiveEditor),
                    configurable: true
                });

                await manager.enableCurrentFile();

                expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                    'File is not disabled'
                );
                expect(vscode.WorkspaceEdit).not.toHaveBeenCalled();
            });

            it('should show warning for non-markdown file', async () => {
                mockDocument.fileName = 'test.txt';
                Object.defineProperty(vscode.window, 'activeTextEditor', {
                    get: vi.fn().mockReturnValue(mockActiveEditor),
                    configurable: true
                });

                await manager.enableCurrentFile();

                expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
                    'Current file is not a markdown file'
                );
            });

            it('should show message when no active editor', async () => {
                Object.defineProperty(vscode.window, 'activeTextEditor', {
                    get: vi.fn().mockReturnValue(undefined),
                    configurable: true
                });

                await manager.enableCurrentFile();

                expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                    'No active text editor'
                );
            });
        });
    });
}); 