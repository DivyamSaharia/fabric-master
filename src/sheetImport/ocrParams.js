// Tesseract settings per kind of cell. Shared by the browser engine and the tests.
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const OCR_PARAMS = {
  header: { tessedit_pageseg_mode: '6', tessedit_char_whitelist: `${UPPER}0123456789/.- ` },
  text: { tessedit_pageseg_mode: '7', tessedit_char_whitelist: `${UPPER}0123456789()-. ` },
  digits: { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789' },
  // a lone digit ("4", "0") is often missed as a line; read it as one character, then as one word
  digit1: { tessedit_pageseg_mode: '10', tessedit_char_whitelist: '0123456789' },
  digitW: { tessedit_pageseg_mode: '8', tessedit_char_whitelist: '0123456789' },
};

// One worker, parameters switched only when the kind of cell changes.
export function makeOcr(worker, toInput) {
  let last = null;
  const run = async (input, kind) => {
    if (kind !== last) {
      await worker.setParameters(OCR_PARAMS[kind]);
      last = kind;
    }
    const { data } = await worker.recognize(input);
    return { text: data.text, confidence: data.confidence };
  };
  return async (cellImg, kind) => {
    const input = await toInput(cellImg);
    const k = OCR_PARAMS[kind] ? kind : 'text';
    let out = await run(input, k);
    if (k === 'digits' && !/\d/.test(out.text)) {
      for (const alt of ['digit1', 'digitW']) {
        const again = await run(input, alt);
        if (/\d/.test(again.text)) return again;
      }
    }
    return out;
  };
}
