# lattice

A note-taking helper. PDF-viewer, links, archiving, quotations, and more.  
Supports Spaced Repetition, using [FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki/abc-of-fsrs), a library that Anki offers for use.  

Based off [vscode-pdf](https://github.com/tomoki1207/vscode-pdfviewer) and extended.

![screenshot](https://user-images.githubusercontent.com/3643499/84454816-98fcd600-ac96-11ea-822c-3ae1e1599a13.gif)

Requires [metebalci/pdftitle](https://github.com/metebalci/pdftitle/tree/master) for extracting titles from PDFs for quotations.

## Spaced Repetition
The SRS feature is very useful for reviewing your content.  
You can declare a new card anywhere in your notes! Lattice will automatically find them for you.  

```md
::card
front: What is the capital of France?
back: Paris
:::
```

When you save, Lattice will automatically add an `id` field to the card. This is to ensure that we can track the cards stats, which are stored in `.vscode/lattice.cards.json`, for future review time. Then you can simply edit the card whenever you want!  

You can also add tags to the card, which will be used to filter the cards in the SRS view.

```md
::card
front: What is the capital of France?
back: Paris
tags: geography, france
:::
```

Being able to declare a card anywhere encourages you to bring with them context. Studying electromagnetism? Add a card about the Lorentz force right under the relevant section of your notes. No separate program needed.

### Reviewing Cards

When the Lattice extension is enabled, you can review your cards by clicking the status bar item.
<!-- TODO: image -->  

Or, you can do Ctrl+Shift+P and select `Lattice: Review Cards`.

### Viewing Cards

Ctrl+Shift+P and select `Lattice: View Cards`. This will open a panel where you can view all your cards, with the last reviewed date, next due date, and more. Filter them as you please.

### Faq

#### General
- What is the intended way to use Lattice?
  - Lattice is intended to be used with a folder that you take all your notes within, it does not support collating notes from multiple folders. Though you can have separate notes folders.
  - The way that I use it it is to simply have a `Notes/` folder, with `Physics/`, `Math/`, `Philosophy/`, etc. as subfolders. Within those I have notes, pdfs, and so on.

### Web
- Web behaves weirdly!
  - There's two modes for the web view.
  - The first is the default and loads the page manually and essentially throws the html/css/js into the webview. This works decently for many pages, but not all.
  - The second uses an iframe.
  - The reason that we don't simply always use the second is that VSCode has a bug/''feature'' that makes so you can't open a context menu on the iframe. This also makes so I can't add a "Add Citation" button to the iframe.
  - I'd like to fix this, but I'm not sure how.

### Cards / SRS
- Anki import/export?
  - Not yet, but I'm planning on it. It should not be hard, the format that we use is rather simple, I just haven't yet needed it.
- SM-2?
  - For simplicity, Lattice uses the FSRS algorithm, which should be mostly an upgrade.
- Time delay is too much between card reviews!
  - You probably want to configure the "Request Retention" setting, making it higher. The default is 0.9, but a higher value will make the cards review more often and thus increase retention but also increase effort.
- I used 'Hard' a ton and now cards are behaving weirdly!
  - You should be wary of using 'Hard' too often, especially for things that do not really count as 'hard'. If you get the pronounciation of a word wrong but mostly get it, then it is probably not 'hard'. If you essentially forget the definition entirely, then it is 'Again'/'Forgot', not 'Hard'.

## Change log
See [CHANGELOG.md](CHANGELOG.md).

## License
Please see [LICENSE](./LICENSE)

