const visited = []
outer: for (const item of [1, 2, 3]) {
  switch (item) {
    case 2:
      break outer
    default:
      visited.push(item)
  }
}
return visited
