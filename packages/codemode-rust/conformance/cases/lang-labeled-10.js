const visited = []
breakWins: for (const item of [1, 2, 3]) {
  try {
    continue breakWins
  } finally {
    visited.push(item)
    break breakWins
  }
}

continueWins: for (const item of [4, 5, 6]) {
  try {
    break continueWins
  } finally {
    visited.push(item)
    continue continueWins
  }
}
return visited
