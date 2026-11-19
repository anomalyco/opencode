const counts = { while: 0, doWhile: 0, forOf: 0, forIn: 0 }
let index = 0
whileLabel: while (index++ < 2) {
  counts.while++
  continue whileLabel
}

index = 0
doLabel: do {
  counts.doWhile++
  if (index++ < 1) continue doLabel
} while (index < 2)

forOfLabel: for (const item of [1, 2]) {
  counts.forOf += item
  continue forOfLabel
}

forInLabel: for (const key in { a: 1, b: 2 }) {
  counts.forIn++
  continue forInLabel
}
return counts
