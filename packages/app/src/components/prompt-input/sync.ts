export function shouldRender(input: { composing: boolean; mirror: boolean; normalized: boolean; equal: boolean }) {
  if (input.composing) return false
  if (input.mirror) return !input.normalized
  if (input.normalized && input.equal) return false
  return true
}
