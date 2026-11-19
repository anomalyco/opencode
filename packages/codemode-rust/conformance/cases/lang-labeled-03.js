const counts = { while: 0, doWhile: 0, for: 0, forOf: 0, forIn: 0 }
whileLabel: while (true) {
  counts.while++
  break whileLabel
}
doLabel: do {
  counts.doWhile++
  break doLabel
} while (true)
forLabel: for (;;) {
  counts.for++
  break forLabel
}
forOfLabel: for (const item of [1, 2]) {
  counts.forOf++
  break forOfLabel
}
forInLabel: for (const key in { a: 1, b: 2 }) {
  counts.forIn++
  break forInLabel
}
return counts
