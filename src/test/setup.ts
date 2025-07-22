import { vi } from 'vitest';

vi.mock('vscode', () => {
    let workspaceFoldersCallback: Function;
    return {
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
            file: (path: string) => ({
                fsPath: path,
                toString: () => path,
                // Add these for proper object comparison
                scheme: 'file',
                path: path
            }),
            parse: (uri: string) => ({
                fsPath: uri,
                toString: () => uri,
                scheme: uri.startsWith('file:') ? 'file' : 'untitled',
                path: uri
            })
        },
        window: {
            createStatusBarItem: () => ({
                show: vi.fn(),
                dispose: vi.fn(),
                hide: vi.fn()
            }),
            showWarningMessage: vi.fn(),
            showErrorMessage: vi.fn(),
            showInformationMessage: vi.fn(),
            activeTextEditor: undefined
        },
        ThemeColor: class {
            constructor(public id: string) { }
        },
        WorkspaceEdit: vi.fn().mockImplementation(() => ({
            insert: vi.fn(),
            delete: vi.fn()
        })),
        StatusBarAlignment: {
            Left: 1
        },
        RelativePattern: class {
            baseUri: any;
            path: string;
            constructor(public base: any | string, public pattern: string) {
                // Initialize required properties
                if (typeof base === 'string') {
                    this.baseUri = vi.fn();
                    this.path = base;
                } else {
                    this.baseUri = base.uri;
                    this.path = base.uri.fsPath;
                }
            }
        },
        Position: class {
            constructor(public line: number, public character: number) { }
        },
        Range: class {
            constructor(public start: any, public end: any) { }
        },
        Selection: class {
            constructor(public anchor: any, public active: any) { }
        },
        workspace: {
            createFileSystemWatcher: () => ({
                onDidChange: (callback: Function) => ({ dispose: () => { } }),
                onDidCreate: (callback: Function) => ({ dispose: () => { } }),
                onDidDelete: (callback: Function) => ({ dispose: () => { } }),
                dispose: () => { }
            }),
            onDidChangeWorkspaceFolders: (callback: Function) => {
                workspaceFoldersCallback = callback;
                return { dispose: () => { } };
            },
            fireWorkspaceFoldersChange: (e: any) => workspaceFoldersCallback(e),
            findFiles: vi.fn().mockResolvedValue([]),
            fs: {
                readFile: async () => new Uint8Array()
            },
            openTextDocument: vi.fn((uri) => {
                return Promise.resolve({
                    uri: uri,
                    getText: () => ''
                });
            }),
            workspaceFolders: [{
                uri: { fsPath: '/test/workspace' },
                name: 'test',
                index: 0
            }],
            getConfiguration: () => ({
                get: (key: string, defaultValue: any) => defaultValue
            }),
            applyEdit: vi.fn().mockResolvedValue(true)
        }
    };
});
