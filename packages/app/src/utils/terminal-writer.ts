export function terminalWriter(
  write: (data: string) => void,
  schedule: (flush: VoidFunction) => void = queueMicrotask,
) {
  let chunks: string[] | undefined
  let scheduled = false

  const flush = () => {
    scheduled = false
    const items = chunks
    if (!items?.length) return
    chunks = undefined
    write(items.join(""))
  }

  const push = (data: string) => {
    if (!data) return
    if (chunks) chunks.push(data)
    else chunks = [data]

    if (scheduled) return
    scheduled = true
    schedule(flush)
  }

  return { push, flush }
}
