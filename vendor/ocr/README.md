# Local OCR dependencies
- Tesseract.js 7.0.0 and Tesseract.js-core 7.0.0, bundled from the versioned npm tarballs.
- eng.traineddata and tha.traineddata from tesseract-ocr/tessdata_fast, fetched 2026-09-05.
- Licenses are stored beside their corresponding files.
- Paths are local. workerBlobURL is false; no remote scripts or language data are loaded at runtime.
- Manifest CSP adds wasm-unsafe-eval for WebAssembly only, not unsafe-eval for JavaScript.

Sources:
https://registry.npmjs.org/tesseract.js/-/tesseract.js-7.0.0.tgz
https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-7.0.0.tgz
https://github.com/tesseract-ocr/tessdata_fast
https://github.com/naptha/tesseract.js/blob/master/docs/api.md
