// workerd exposes no kernel path for a file descriptor. Never authorize a read from its preflight path.
export function handlePath(_fd: number): string | undefined {
  return undefined
}
