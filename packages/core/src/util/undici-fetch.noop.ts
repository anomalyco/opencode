// Bun and workerd keep their own fetch, so undici is never loaded there.
export function create(): undefined {
  return undefined
}
