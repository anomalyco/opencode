/** Text that ends in CJK script or CJK punctuation. */
const cjk = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff]$/

/** No space before a link that continues a CJK sentence, a space elsewhere. */
export function gap(text: string) {
  return cjk.test(text) ? "" : " "
}

/** The sentence stop the text's script uses: 。 after CJK, . elsewhere. */
export function stop(text: string) {
  return cjk.test(text) ? "。" : "."
}
