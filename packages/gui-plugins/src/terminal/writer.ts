// Writes output and runs steps such as resizes in the order they were pushed. Consecutive output is written as one
// chunk, and nothing after it starts until the terminal reports that chunk done. `clear` drops everything not yet
// written and ignores later pushes and a late `done`.
export function terminalWriter(write: (data: Uint8Array, done: VoidFunction) => void) {
  const queue: (Uint8Array | VoidFunction)[] = []
  let status: "idle" | "scheduled" | "writing" | "cleared" = "idle"

  const wake = () => {
    if (status !== "idle" || queue.length === 0) return
    status = "scheduled"
    queueMicrotask(run)
  }

  // One callback for every write, so streaming output allocates none.
  const done = () => {
    if (status !== "writing") return
    status = "idle"
    wake()
  }

  const run = () => {
    if (status !== "scheduled") return
    status = "idle"

    // A step or write that throws loses only itself; the rest of the queue still runs.
    try {
      while (status === "idle") {
        const next = queue.shift()

        if (next === undefined) break

        if (!(next instanceof Uint8Array)) {
          next()

          continue
        }

        const data = take(queue, next)
        let started = false
        status = "writing"

        try {
          write(data, done)
          started = true
        } finally {
          if (!started && status === "writing") status = "idle"
        }
      }
    } finally {
      wake()
    }
  }

  return {
    push(item: Uint8Array | VoidFunction) {
      if (status === "cleared" || (item instanceof Uint8Array && !item.length)) return
      queue.push(item)
      wake()
    },
    clear() {
      status = "cleared"
      queue.length = 0
    },
  }
}

// Joins `first` with the output queued right after it. A lone chunk is written as is.
function take(queue: (Uint8Array | VoidFunction)[], first: Uint8Array) {
  const end = queue.findIndex(isStep)
  const count = end === -1 ? queue.length : end

  if (count === 0) return first
  const chunks = queue.splice(0, count).filter((item) => item instanceof Uint8Array)
  const data = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, first.length))
  data.set(first)
  chunks.reduce((offset, chunk) => {
    data.set(chunk, offset)

    return offset + chunk.length
  }, first.length)

  return data
}

function isStep(item: Uint8Array | VoidFunction) {
  return !(item instanceof Uint8Array)
}
