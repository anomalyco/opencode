const visited = []
outer: {
  inner: {
    visited.push(1)
    break outer
  }
  visited.push(2)
}
visited.push(3)
return visited
