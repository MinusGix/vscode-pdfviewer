import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { CardManager, CardUpdateEvent } from './cardManager';
import { MdParser } from './mdParser';
import { MdCard } from './card';

// Mock VSCode APIs
vi.mock('vscode', () => ({
    EventEmitter: class {
        private listeners: Function[] = [];
        public event = (listener: Function) => {
            this.listeners.push(listener);
            return { dispose: () => { } };
        };
        public fire(event: any) {
            this.listeners.forEach(listener => listener(event));
        }
        public dispose() { }
    },
    Uri: {
        file: (path: string) => ({ fsPath: path, toString: () => path }),
        parse: (uri: string) => ({ fsPath: uri, toString: () => uri })
    },
    workspace: {
        createFileSystemWatcher: () => ({
            onDidChange: (callback: Function) => ({ dispose: () => { } }),
            onDidCreate: (callback: Function) => ({ dispose: () => { } }),
            onDidDelete: (callback: Function) => ({ dispose: () => { } }),
            dispose: () => { }
        }),
        fs: {
            readFile: async () => new Uint8Array()
        }
    }
}));

// Mock MdParser
vi.mock('./mdParser', () => ({
    MdParser: {
        parseFile: vi.fn(),
        parseWorkspace: vi.fn()
    }
}));

describe('CardManager', () => {
    let manager: CardManager;
    let updateEvents: CardUpdateEvent[] = [];

    beforeEach(() => {
        manager = CardManager.getInstance();
        updateEvents = [];
        manager.onDidUpdateCards(event => updateEvents.push(event));
    });

    afterEach(() => {
        manager.dispose();
        vi.clearAllMocks();
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
                [vscode.Uri.parse('file1.md'), mockCards]
            ]);

            vi.mocked(MdParser.parseWorkspace).mockResolvedValue(mockResults);

            await manager.initialize();

            expect(MdParser.parseWorkspace).toHaveBeenCalled();
            expect(manager.getAllCards()).toEqual(mockCards);
            expect(updateEvents).toHaveLength(1);
            expect({
                ...updateEvents[0],
                uri: updateEvents[0].uri.toString()
            }).toEqual({
                type: 'add',
                uri: 'file1.md',
                cards: mockCards
            });
        });

        it('should not initialize twice', async () => {
            vi.mocked(MdParser.parseWorkspace).mockResolvedValue(new Map());

            await manager.initialize();
            await manager.initialize();

            expect(MdParser.parseWorkspace).toHaveBeenCalledTimes(1);
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
            vi.mocked(MdParser.parseFile).mockResolvedValue(mockCards);

            await manager['handleFileChange'](mockUri);

            expect(manager.getCardsFromFile(mockUri)).toEqual(mockCards);
            expect(updateEvents).toHaveLength(1);
            expect({
                ...updateEvents[0],
                uri: updateEvents[0].uri.toString()
            }).toEqual({
                type: 'add',
                uri: mockUri.toString(),
                cards: mockCards
            });
        });

        it('should handle file changes that remove cards', async () => {
            // First add some cards
            vi.mocked(MdParser.parseFile).mockResolvedValue(mockCards);
            await manager['handleFileChange'](mockUri);
            updateEvents = []; // Clear initial events

            // Then remove them
            vi.mocked(MdParser.parseFile).mockResolvedValue([]);
            await manager['handleFileChange'](mockUri);

            expect(manager.getCardsFromFile(mockUri)).toBeUndefined();
            expect(updateEvents).toHaveLength(1);
            expect({
                ...updateEvents[0],
                uri: updateEvents[0].uri.toString()
            }).toEqual({
                type: 'delete',
                uri: mockUri.toString()
            });
        });

        it('should handle file deletion', async () => {
            // First add some cards
            vi.mocked(MdParser.parseFile).mockResolvedValue(mockCards);
            await manager['handleFileChange'](mockUri);
            updateEvents = []; // Clear initial events

            // Then delete the file
            manager['handleFileDelete'](mockUri);

            expect(manager.getCardsFromFile(mockUri)).toBeUndefined();
            expect(updateEvents).toHaveLength(1);
            expect({
                ...updateEvents[0],
                uri: updateEvents[0].uri.toString()
            }).toEqual({
                type: 'delete',
                uri: mockUri.toString()
            });
        });

        it('should handle parse errors by removing cards', async () => {
            // First add some cards
            vi.mocked(MdParser.parseFile).mockResolvedValue(mockCards);
            await manager['handleFileChange'](mockUri);
            updateEvents = []; // Clear initial events

            // Then simulate a parse error
            vi.mocked(MdParser.parseFile).mockRejectedValue(new Error('Parse error'));
            await manager['handleFileChange'](mockUri);

            expect(manager.getCardsFromFile(mockUri)).toBeUndefined();
            expect(updateEvents).toHaveLength(1);
            expect({
                ...updateEvents[0],
                uri: updateEvents[0].uri.toString()
            }).toEqual({
                type: 'delete',
                uri: mockUri.toString()
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
                [mockUri1, mockCards1],
                [mockUri2, mockCards2]
            ]));
            await manager.initialize();
        });

        it('should get cards from specific file', () => {
            expect(manager.getCardsFromFile(mockUri1)).toEqual(mockCards1);
            expect(manager.getCardsFromFile(mockUri2)).toEqual(mockCards2);
        });

        it('should get all cards', () => {
            expect(manager.getAllCards()).toEqual([...mockCards1, ...mockCards2]);
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
}); 