const found = []
outer: for (let i = 0; i < 4; i++) {
  inner: for (let j = 0; j < 4; j++) {
    if (j === 2) continue outer
    if (i === 3) break outer
    found.push(i + "" + j)
  }
}
block: { found.push("in"); break block; found.push("never") }
return found
