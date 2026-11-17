let count = 0
outer: for (let x = 0; x < 10; x++) {
  let y = 0
  while (true) {
    y++
    count++
    if (y === 1) continue outer
    throw new Error("inner loop consumed the outer continue")
  }
}
return count
