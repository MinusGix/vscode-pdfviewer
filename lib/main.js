"use strict";

console.log("Loading main.js");
import * as pdfjsLib from './build/pdf.mjs';
// console.log("pdfjsLib", pdfjsLib);
// import * as PDFViewerApplication from './web/viewer.mjs';

// window.aaa = pdfjsLib;
// window.bbb = PDFViewerApplication;

(function () {
  // let pdfViewer = PDFViewerApplication.pdfViewer;
  // let pdfFactory;

  // hand | select | zoom | highlight
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
      throw new Error(`Unknown cursor tool: ${name}`)
    }
  }
  function setCursorMode(name) {
    if (name === 'select' || name === 'hand') {
      PDFViewerApplication.pdfCursorTools.switchTool(cursorTools(name))
    } else if (name === 'highlight') {
      PDFViewerApplication.pdfCursorTools.switchTool(cursorTools('select'))
    } else {
      throw new Error(`Unknown cursor mode: ${name}`)
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

  function addHighlight(coords) {
    // TODO: Creating just on the current page is not correct if currentPage is calculated based on scroll position.
    //   (if it is from focus, then it's correct)
    pdfFactory.createHighlightAnnotation(PDFViewerApplication.pdfViewer.currentPageNumber - 1, coords, "AAA", "BBB");
  }

  function addUnderline(coords) {
    pdfFactory.createUnderlineAnnotation(PDFViewerApplication.pdfViewer.currentPageNumber - 1, coords, "AAA", "BBB");
  }

  // TODO: add text content
  // TODO: add strike out
  // TODO: add squiggle

  window.addEventListener('load', async function () {
    const config = loadConfig()
    console.log("Config", config);
    console.log("PDFViewerApplicationOptions", PDFViewerApplicationOptions);
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
        console.log(PDFViewerApplication.pdfViewer);
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
      console.log("PDFViewerApplication", PDFViewerApplication);
      console.log("pdfjsLib", pdfjsLib);
      // console.log("pdfjsLib.eventBus", pdfjsLib.eventBus);
      // console.log("pdfjsLib.eventBus", pdfjsLib.on);
      // console.log("pdfjslib.viewerbus", pdfjsLib.pdfViewer.eventBus);
      // console.log("pdfjslib.viewerbus", pdfjsLib.pdfViewer.on);
      // console.log("pdfjslib.viewerbus", pdfjsLib.pdfViewer.EventBus);
      // pdfjsLib.eventBus.on('documentloaded', optsOnLoad)
      PDFViewerApplication.eventBus.on('documentloaded', optsOnLoad)

      // load() cannot be called before pdf.js is initialized
      // open() makes sure pdf.js is initialized before load()
      console.log("Opening", config.path);
      PDFViewerApplication.open({ url: config.path }).then(async function () {
        console.log("loadOpts", loadOpts);
        let doc = await pdfjsLib.getDocument(loadOpts).promise
        doc._pdfInfo.fingerprints = [config.path]
        console.log("Doc loaded", doc);
        // doc.getData().then((data) => {
        //   console.log("Doc data loaded, creating factory");
        //   pdfFactory = new pdfAnnotate.AnnotationFactory(data);
        // })

        PDFViewerApplication.load(doc)
      })
    })

    window.addEventListener('message', async function () {
      // Prevents flickering of page when PDF is reloaded
      const oldResetView = PDFViewerApplication.pdfViewer._resetView
      PDFViewerApplication.pdfViewer._resetView = function () {
        this._firstPageCapability = (0, pdfjsLib.createPromiseCapability)()
        this._onePageRenderedCapability = (0, pdfjsLib.createPromiseCapability)()
        this._pagesCapability = (0, pdfjsLib.createPromiseCapability)()

        this.viewer.textContent = ""
      }

      console.log("Load opts:", loadOpts);
      // Changing the fingerprint fools pdf.js into keeping scroll position
      const doc = await pdfjsLib.getDocument(loadOpts).promise
      doc._pdfInfo.fingerprints = [config.path]
      PDFViewerApplication.load(doc)

      PDFViewerApplication.pdfViewer._resetView = oldResetView
    });
  }, { once: true });

  window.onerror = function () {
    const msg = document.createElement('body')
    msg.innerText = 'An error occurred while loading the file. Please open it again.'
    document.body = msg
  }
}());
