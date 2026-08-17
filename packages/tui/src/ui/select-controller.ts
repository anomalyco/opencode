export function reconcileSelection(selected: number, count: number) {
  return Math.max(0, Math.min(count - 1, selected))
}

export function moveSelection(selected: number, input: { count: number; delta: number; policy: "clamp" | "wrap" }) {
  if (input.count <= 0) return 0
  const next = selected + input.delta
  if (input.policy === "clamp") return reconcileSelection(next, input.count)
  if (next < 0) return input.count - 1
  if (next >= input.count) return 0
  return next
}

export function revealSelectionOffset(offset: number, input: { count: number; limit: number; selected: number }) {
  const max = maxOffset(input.count, input.limit)
  if (input.selected < offset) return Math.min(max, input.selected)
  if (input.selected >= offset + input.limit) return Math.min(max, input.selected - input.limit + 1)
  return Math.max(0, Math.min(max, offset))
}

export function moveSelectionOffset(
  offset: number,
  input: { count: number; limit: number; selected: number; direction: -1 | 1 },
) {
  const max = maxOffset(input.count, input.limit)
  const margin = Math.max(0, Math.min(2, Math.floor((input.limit - 1) / 2)))
  if (input.direction < 0 && input.selected < offset + margin) {
    return Math.max(0, Math.min(max, input.selected - margin))
  }
  if (input.direction > 0 && input.selected > offset + input.limit - margin - 1) {
    return Math.min(max, input.selected - input.limit + margin + 1)
  }
  return Math.max(0, Math.min(max, offset))
}

function maxOffset(count: number, limit: number) {
  return Math.max(0, count - limit)
}
