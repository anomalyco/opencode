// Writes output and runs steps such as resizes in the order they were pushed. Consecutive output is written as one
// chunk, and nothing after it starts until the terminal reports that chunk done.
export function terminalWriter(write: (data: Uint8Array, done: VoidFunction) => void) {
  const queue: (Uint8Array | VoidFunction)[] = []
  let scheduled = false
  let writing = false

  const wake = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(run)
  }

  const run = () => {
    scheduled = false

    while (!writing && queue.length) {
      const next = queue[0]

      if (!(next instanceof Uint8Array)) {
        queue.shift()
        next()

        continue
      }

      const end = queue.findIndex((item) => !(item instanceof Uint8Array))

      const chunks = queue
        .splice(0, end === -1 ? queue.length : end)
        .filter((item): item is Uint8Array => item instanceof Uint8Array)

      writing = true
      write(concat(chunks), () => {
        writing = false

        if (queue.length) wake()
      })
    }
  }

  const push = (item: Uint8Array | VoidFunction) => {
    if (item instanceof Uint8Array && !item.length) return
    queue.push(item)

    if (!writing) wake()
  }

  return { push }
}

function concat(chunks: Uint8Array[]) {
  if (chunks.length === 1) return chunks[0]
  const data = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  chunks.reduce((offset, chunk) => {
    data.set(chunk, offset)

    return offset + chunk.length
  }, 0)

  return data
}
