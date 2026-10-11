// Moved and reordered blocks: the same code appears as deletion here and addition elsewhere.
export function first() {
  return "first"
}

export function second() {
  const values = [1, 2, 3]
  return values.map((value) => value * 2)
}

export function third() {
  return "third"
}

export function fourth() {
  return "fourth"
}

export const order = ["first", "second", "third", "fourth"]
