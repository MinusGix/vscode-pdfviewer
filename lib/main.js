"use strict";

import * as pdfjsLib from './build/pdf.mjs';
import { PDFViewerApplication } from './web/viewer.mjs';

// pdf.js changed notes:
// We should avoid changing the pdf.js code as much as possible so that it can be easily updated with new versions.
// However, we can't always avoid this due to private functions and the like.
//
// - `ColorPicker.#getDropdownRoot`: commented out the `signal` parameter to the click listener. This was for some reason making so the callback was never executed.
// - Commented out the keydown for the print key. It was interfering with VSCode's command palette.
// - Added the `CommandManager` class below.

const vscode = acquireVsCodeApi();

(function () {
  // hand | select | zoom
  let cursorMode = 'select';

  function loadConfig() {
    const elem = document.getElementById('pdf-preview-config')
    if (elem) {
      return JSON.parse(elem.getAttribute('data-config'))
    }
    throw new Error('Could not load configuration.')
  }
  function cursorTools(name) {
    if (name === 'hand') {
      return 1
    } else if (name === 'select') {
      return 0
    } else if (name === 'zoom') {
      return 2
    } else {
      // throw new Error(`Unknown cursor tool: ${name}`)
      console.error(`Unknown cursor tool: ${name}`)
    }
  }
  function setCursorMode(name) {
    if (name === 'select' || name === 'hand') {
      PDFViewerApplication.pdfCursorTools.switchTool(cursorTools(name))
    } else if (name === 'highlight') {
      PDFViewerApplication.pdfCursorTools.switchTool(cursorTools('select'))
    } else {
      // throw new Error(`Unknown cursor mode: ${name}`)
      console.error(`Unknown cursor mode: ${name}`);
      return;
    }

    cursorMode = name;
  }
  function scrollMode(name) {
    switch (name) {
      case 'vertical':
        return 0
      case 'horizontal':
        return 1
      case 'wrapped':
        return 2
      default:
        return -1
    }
  }
  function spreadMode(name) {
    switch (name) {
      case 'none':
        return 0
      case 'odd':
        return 1
      case 'even':
        return 2
      default:
        return -1
    }
  }

  function computePageOffset() {
    // let pageId = "page" + pdfViewer.currentPageNumber
    let pg = document.querySelector(`.page[data-page-number="${PDFViewerApplication.pdfViewer.currentPageNumber}"]`)

    var rect = pg.getBoundingClientRect(), bodyElt = document.body;
    return {
      top: rect.top + bodyElt.scrollTop,
      left: rect.left + bodyElt.scrollLeft
    }
  }

  function selectionCoords() {
    let rec = window.getSelection().getRangeAt(0).getBoundingClientRect()
    let ost = computePageOffset()
    let x_1 = rec.x - ost.left
    let y_1 = rec.y - ost.top
    let x_2 = x_1 + rec.width
    let y_2 = y_1 + rec.height

    let x_1_y_1 = PDFViewerApplication.pdfViewer._pages[PDFViewerApplication.pdfViewer.currentPageNumber - 1].viewport.convertToPdfPoint(x_1, y_1)
    x_1 = x_1_y_1[0]
    y_1 = x_1_y_1[1]
    let x_2_y_2 = PDFViewerApplication.pdfViewer._pages[PDFViewerApplication.pdfViewer.currentPageNumber - 1].viewport.convertToPdfPoint(x_2, y_2)
    x_2 = x_2_y_2[0]
    y_2 = x_2_y_2[1]
    return [x_1, y_1, x_2, y_2]
  }

  function appConfig() {
    return PDFViewerApplication.appConfig;
  }

  function viewerContainer() {
    return appConfig().viewerContainer;
  }

  function toolbar() {
    return appConfig().toolbar;
  }

  function hideHighlightDropdown() {
    toolbar().editorHighlightButton.setAttribute("aria-expanded", "false");
    toolbar().editorHighlightParamsToolbar.classList.add("hidden");
  }

  function hideFreeTextDropdown() {
    toolbar().editorFreeTextButton.setAttribute("aria-expanded", "false");
    toolbar().editorFreeTextParamsToolbar.classList.add("hidden");
  }

  function hideInkDropdown() {
    toolbar().editorInkButton.setAttribute("aria-expanded", "false");
    toolbar().editorInkParamsToolbar.classList.add("hidden");
  }

  function hideStampDropdown() {
    toolbar().editorStampButton.setAttribute("aria-expanded", "false");
    toolbar().editorStampParamsToolbar.classList.add("hidden");
  }

  function hideAllDropdowns() {
    hideHighlightDropdown();
    hideFreeTextDropdown();
    hideInkDropdown();
    hideStampDropdown();
  }

  function improvePDFViewer() {
    // Ensure highlight dropdown auto-hides when you select text.
    viewerContainer().addEventListener("click", function () {
      if (toolbar().editorHighlightButton.getAttribute("aria-expanded") === "true") {
        hideHighlightDropdown();
      }
    });

    // We don't make free text or ink or image dropdown auto-hide because they don't help as much, nor do I use them as much.

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hideAllDropdowns();
      } else if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'y')) {
        if (event.key === 'y' || (event.key === 'z' && event.shiftKey)) {
          PDFViewerApplication.eventBus.dispatch("editingaction", { name: "redo" });
        } else {
          PDFViewerApplication.eventBus.dispatch("editingaction", { name: "undo" });
        }
      }
    });

    // Prevent PDF drag and drop by capturing and stopping the events
    appConfig().mainContainer.addEventListener("dragover", (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
    }, { capture: true });

    appConfig().mainContainer.addEventListener("drop", (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
    }, { capture: true });
  }

  // from pdf.js
  const InvisibleCharsRegExp = /[\x00-\x1F]/g;
  function removeNullCharacters(str, replaceInvisible = false) {
    if (!InvisibleCharsRegExp.test(str)) {
      return str;
    }
    if (replaceInvisible) {
      return str.replaceAll(InvisibleCharsRegExp, m => m === "\x00" ? "" : " ");
    }
    return str.replaceAll("\x00", "");
  }

  function getSelectedPdfText() {
    let selection = document.getSelection();
    return removeNullCharacters(pdfjsLib.normalizeUnicode(selection.toString()));
  }

  function getPdfTextForNote() {
    let text = getSelectedPdfText();
    if (!text) {
      return '';
    }

    // Format the text with quote markers
    let formattedText = '> ' + text
      .split('\n')
      .map(line => {
        if (line.endsWith('-')) {
          // Continues onto next line presumably.
          return line.slice(0, -1);
        }
        return line + ' ';
      })
      .join('')
      .trim();

    // If after all processing we just have an empty quote, return empty string
    if (formattedText === '>' || formattedText === '> ') {
      return '';
    }

    return formattedText;
  }

  PDFViewerApplication.save = async function save(destination) {
    // We have a custom save implementation as we can't just use the integrated pdf.js one.  
    // VSCode doesn't support downloading inside a webview it seems, and anyway, we have to support backups and such.
    // Unfortunately, inside a webview, we can't just write to a file directly! 
    // We have to go through JSON stringify and friends. I sure do love serializing potentially quite large binary files (pdfs) to base64.
    //
    // I ignore the pdf scripting and stalling if there's already a save in progress that the pdf.js impl has.

    try {
      const data = await PDFViewerApplication.pdfDocument.saveDocument();
      vscode.postMessage({
        type: 'save',
        data,
        destination,
      });
    } catch (e) {
      console.error("Error when saving the document: ", e);
    }
  }

  PDFViewerApplication.eventBus.on("annotationeditorstateschanged", (data) => {
    let isDirty = !!data.details.dirty;
    if (isDirty) {
      vscode.postMessage({
        type: 'documentDirty'
      });
    } else {
      // See comment in src/pdfPreview.ts
      // vscode.postMessage({
      //   type: 'documentClean'
      // });
    }
  });

  window.addEventListener('load', async function () {
    const config = loadConfig()
    PDFViewerApplicationOptions.set('cMapUrl', config.cMapUrl)
    PDFViewerApplicationOptions.set('standardFontDataUrl', config.standardFontDataUrl)
    const loadOpts = {
      url: config.path,
      useWorkerFetch: false,
      cMapUrl: config.cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: config.standardFontDataUrl
    }
    PDFViewerApplication.initializedPromise.then(() => {
      const defaults = config.defaults
      const optsOnLoad = () => {
        setCursorMode(defaults.cursor)
        PDFViewerApplication.pdfViewer.currentScaleValue = defaults.scale
        PDFViewerApplication.pdfViewer.scrollMode = scrollMode(defaults.scrollMode)
        PDFViewerApplication.pdfViewer.spreadMode = spreadMode(defaults.spreadMode)
        if (defaults.sidebar) {
          PDFViewerApplication.pdfSidebar.open()
        } else {
          PDFViewerApplication.pdfSidebar.close()
        }
        PDFViewerApplication.eventBus.off('documentloaded', optsOnLoad)
      }
      PDFViewerApplication.eventBus.on('documentloaded', optsOnLoad)

      // load() cannot be called before pdf.js is initialized
      // open() makes sure pdf.js is initialized before load()
      PDFViewerApplication.open({ url: config.path }).then(async function () {
        let doc = await pdfjsLib.getDocument(loadOpts).promise
        doc._pdfInfo.fingerprints = [config.path]

        PDFViewerApplication.load(doc)
      })
      // TODO: show error to user if loading fails
    })

    window.addEventListener('message', async function (event) {
      let data = event.data;
      if (data.type === 'reload') {
        // TODO: Fix this logic, I think it is broken for newer versions of pdf.js
        // Prevents flickering of page when PDF is reloaded
        // const oldResetView = PDFViewerApplication.pdfViewer._resetView
        // PDFViewerApplication.pdfViewer._resetView = function () {
        //   this._firstPageCapability = (0, pdfjsLib.createPromiseCapability)()
        //   this._onePageRenderedCapability = (0, pdfjsLib.createPromiseCapability)()
        //   this._pagesCapability = (0, pdfjsLib.createPromiseCapability)()

        //   this.viewer.textContent = ""
        // }

        // // Changing the fingerprint fools pdf.js into keeping scroll position
        // const doc = await pdfjsLib.getDocument(loadOpts).promise
        // doc._pdfInfo.fingerprints = [config.path]
        // PDFViewerApplication.load(doc)

        // PDFViewerApplication.pdfViewer._resetView = oldResetView
      } else if (data.type === 'save') {
        // Editor has requested a save
        PDFViewerApplication.save(data.destination);
      } else if (data.type === 'copy-note') {
        // Add debouncing to prevent multiple rapid-fire events
        if (window.copyNoteTimeout) {
          clearTimeout(window.copyNoteTimeout);
        }

        window.copyNoteTimeout = setTimeout(() => {
          const text = getPdfTextForNote();
          const pageNumber = PDFViewerApplication.pdfViewer.currentPageNumber;

          vscode.postMessage({
            type: 'copy-note',
            text,
            pageNumber: typeof pageNumber === 'number' ? pageNumber : 1,
          });

          window.copyNoteTimeout = null;
        }, 100); // Small delay to debounce
      } else if (data.type === 'highlight') {
        PDFViewerApplication.eventBus.dispatch("editingaction", { name: "highlightSelection" });
      } else if (data.type === 'get-current-page') {
        vscode.postMessage({
          type: 'current-page',
          pageNumber: PDFViewerApplication.pdfViewer.currentPageNumber
        });
      }
    });

    improvePDFViewer();


  }, { once: true });

  window.onerror = function () {
    const msg = document.createElement('body')
    msg.innerText = 'An error occurred while loading the file. Please open it again.'
    document.body = msg
  }
}());


// NOTE: This is the modified version of the CommandManager class from pdf.js.
// It is declared here just to be clear that it is not part of the pdf.js library.
// When updating pdf.js, copy this code into the pdf.js library.
class CommandManager {
  #commands = [];
  #locked = false;
  #maxSize;
  #position = -1;
  #savedPosition = -1;  // Track the last saved position

  constructor(maxSize = 128) {
    this.#maxSize = maxSize;
  }

  get isDirty() {
    return this.#position !== this.#savedPosition;
  }

  save() {
    this.#savedPosition = this.#position;
  }

  add({
    cmd,
    undo,
    post,
    mustExec,
    type = NaN,
    overwriteIfSameType = false,
    keepUndo = false
  }) {
    if (mustExec) {
      cmd();
    }
    if (this.#locked) {
      return;
    }
    const save = {
      cmd,
      undo,
      post,
      type
    };
    if (this.#position === -1) {
      if (this.#commands.length > 0) {
        this.#commands.length = 0;
      }
      this.#position = 0;
      this.#commands.push(save);
      return;
    }
    if (overwriteIfSameType && this.#commands[this.#position].type === type) {
      if (keepUndo) {
        save.undo = this.#commands[this.#position].undo;
      }
      this.#commands[this.#position] = save;
      return;
    }
    const next = this.#position + 1;
    if (next === this.#maxSize) {
      this.#commands.splice(0, 1);
      if (this.#savedPosition > -1) {
        this.#savedPosition--;
      }
    } else {
      this.#position = next;
      if (next < this.#commands.length) {
        this.#commands.splice(next);
      }
    }
    this.#commands.push(save);
  }

  undo() {
    if (this.#position === -1) {
      return;
    }
    this.#locked = true;
    const {
      undo,
      post
    } = this.#commands[this.#position];
    undo();
    post?.();
    this.#locked = false;
    this.#position -= 1;
  }
  redo() {
    if (this.#position < this.#commands.length - 1) {
      this.#position += 1;
      this.#locked = true;
      const {
        cmd,
        post
      } = this.#commands[this.#position];
      cmd();
      post?.();
      this.#locked = false;
    }
  }
  hasSomethingToUndo() {
    return this.#position !== -1;
  }
  hasSomethingToRedo() {
    return this.#position < this.#commands.length - 1;
  }
  destroy() {
    this.#commands = null;
    this.#savedPosition = -1;
  }
}