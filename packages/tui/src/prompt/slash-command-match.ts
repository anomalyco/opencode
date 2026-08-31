export function slashCommandMatches<T>(input: {
  query: string
  options: readonly T[]
  matches: readonly T[]
  names: (option: T) => readonly string[]
}) {
  const query = normalize(input.query)
  if (query.length < 3) return [...input.matches]
  if (input.options.some((option) => input.names(option).some((name) => normalize(name).startsWith(query)))) {
    return [...input.matches]
  }

  const typos = input.options
    .map((option, index) => ({
      option,
      index,
      distance: Math.min(...input.names(option).map((name) => damerauLevenshtein(query, normalize(name)))),
    }))
    .filter((item) => item.distance <= 1)
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map((item) => item.option)

  if (typos.length === 0) return [...input.matches]
  const added = new Set(typos)
  return [...typos, ...input.matches.filter((option) => !added.has(option))]
}

function normalize(value: string) {
  return value.trim().replace(/^\//, "").toLowerCase()
}

function damerauLevenshtein(source: string, target: string) {
  const rows = Array.from({ length: source.length + 1 }, (_, row) =>
    Array.from({ length: target.length + 1 }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)),
  )

  for (let row = 1; row <= source.length; row++) {
    for (let column = 1; column <= target.length; column++) {
      const substitution = source[row - 1] === target[column - 1] ? 0 : 1
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + substitution,
      )

      if (row > 1 && column > 1 && source[row - 1] === target[column - 2] && source[row - 2] === target[column - 1]) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1)
      }
    }
  }

  return rows[source.length][target.length]
}
