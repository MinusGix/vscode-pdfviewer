# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install dependencies
npm install

# Build the extension
npm run compile

# Watch for changes during development
npm run watch

# Run tests
npm test

# Run linting
npm run lint

# Type checking only
npm run check-types

# Package for distribution (no source maps)
npm run package
```

## Architecture Overview

This VS Code extension (Lattice) provides PDF viewing, web viewing, and spaced repetition (SRS) functionality. Key architectural components:

### Core Providers
- **PDFProvider** (`src/pdfProvider.ts`): Custom editor for PDF files using PDF.js library in `lib/` directory
- **WebProvider** (`src/webProvider.ts`): Webview provider for displaying web pages with two modes (frameless/iframe)
- **LiveMdEditorProvider** (`src/markdown/liveMdEditorProvider.ts`): Enhanced markdown preview

### SRS System
The spaced repetition system uses the FSRS algorithm (not SM-2 as README states):
- Cards are parsed from markdown files using custom syntax
- Card state is stored globally and persisted
- Review scheduling uses `ts-fsrs` library
- Cards support tags, autotags, and can be disabled per file

### Extension Commands
Commands are registered in `src/extension.ts` and follow the pattern `lattice.{feature}.{action}`:
- PDF: `preview.highlight`, `preview.insertQuotation`, `preview.insertCitation`
- Web: `openUrl`, `webPreview.insertQuotation`
- Cards: `reviewCards`, `listCards`, `insertCardTemplateTesting`

### Webview Communication
PDF and web viewers communicate via message passing:
- Commands sent from extension to webview
- Events sent from webview to extension
- Shared message types defined inline in provider files

### Build System
- Uses Parcel bundler configured in `.parcelrc`
- Entry points: `src/extension.ts` and files in `lib/`
- TypeScript with strict checking
- Custom syntax highlighting for cards in `syntaxes/`

## Key Implementation Details

1. **Card Parsing**: The markdown parser (`src/SRS/mdParser.ts`) identifies cards using specific syntax patterns and generates unique IDs using nanoid
2. **Document Titles**: Custom titles for PDFs/web pages stored in global state (`src/documentTitles.ts`)
3. **PDF Integration**: PDF.js runs in webview, extension handles file operations and state
4. **Testing**: Vitest tests located alongside source files (e.g., `src/SRS/cardScheduler.test.ts`)

## Current Development State

The repository has uncommitted changes in:
- `package.json` and `src/extension.ts` (modified)
- New directories: `lib/markdown/` and `src/markdown/`

Recent commits indicate work on card features (multiline cards, parsing improvements, autotags, tag colors).