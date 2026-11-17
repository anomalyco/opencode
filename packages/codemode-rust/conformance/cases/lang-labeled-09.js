const classic = []
classicLabel: for (let index = 0; index < 3; index++) {
  classic.push(() => index)
  continue classicLabel
}

const nested = []
nestedLabel: for (let outer = 0; outer < 3; outer++) {
  for (let inner = 0; inner < 2; inner++) {
    nested.push(() => outer)
    continue nestedLabel
  }
}

const forOf = []
forOfLabel: for (const item of [1, 2, 3]) {
  forOf.push(() => item)
  continue forOfLabel
}
return [classic.map((read) => read()), nested.map((read) => read()), forOf.map((read) => read())]
