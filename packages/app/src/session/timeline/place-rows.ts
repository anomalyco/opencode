/**
 * Puts a layer's rows in order without taking a row that stays out of the document.
 *
 * Solid places a list's nodes in one pass. When new nodes come before a run of kept nodes that is no longer than
 * they are, and the node after the run changed too, the pass replaces a kept node with a new one and inserts the
 * kept node again later. A landing page of history does that to a row, and so does the end of a turn. A row that
 * leaves the document, even within one task, loses focus, a text selection, the offset of anything scrolled inside
 * it and its running animations, and is laid out again.
 *
 * Here the rows that left are removed first. The rest is walked from the end: a new row goes in before the row after
 * it, and a kept row is moved only when it no longer comes before that row, which is when the kept rows themselves
 * changed order. For rows that keep their order this is one DOM operation for each row that left or came.
 */
export function placeRows(layer: Element, rows: Node[]) {
  const staying = new Set(rows)
  Array.from(layer.childNodes)
    .filter((node) => !staying.has(node))
    .forEach((node) => node.remove())
  rows.reduceRight<Node | null>((after, row) => {
    if (row.parentNode !== layer || row.nextSibling !== after) layer.insertBefore(row, after)

    return row
  }, null)
}
