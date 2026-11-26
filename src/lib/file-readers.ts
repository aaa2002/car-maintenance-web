// Browser-side readers for imported files, loaded only when a file is dropped (pdf.js is large).
import type { ReadOptions } from './platform-files';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    return pdfjs;
  });
  return pdfjsPromise;
}

/** Text of every page, one line per text row. */
export async function readPdfText(data: Uint8Array) {
  const pdfjs = await loadPdfjs();
  // pdf.js takes ownership of the buffer it is given, so pass a copy and keep the original for upload.
  const task = pdfjs.getDocument({ data: data.slice(), verbosity: 0 });
  try {
    const document = await task.promise;
    let text = '';
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      text += content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('') + '\n';
    }
    return text;
  } finally { await task.destroy(); }
}

export async function unzipFiles(data: Uint8Array) {
  const { unzip } = await import('fflate');
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => unzip(data, (error, result) => (error ? reject(error) : resolve(result))));
  return Object.entries(entries).filter(([path]) => !path.endsWith('/')).map(([path, bytes]) => ({ path: path.normalize('NFC'), data: bytes }));
}

export const browserReaders: Omit<ReadOptions, 'onProgress'> = { readPdf: readPdfText, unzip: unzipFiles };
