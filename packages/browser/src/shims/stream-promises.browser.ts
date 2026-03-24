type PipeableStream = {
  pipe(destination: PipeableStream): PipeableStream
  on(event: string, handler: (...args: any[]) => void): void
  off?(event: string, handler: (...args: any[]) => void): void
  removeListener?(event: string, handler: (...args: any[]) => void): void
  end?(): void
}

function removeListener(stream: PipeableStream, event: string, handler: (...args: any[]) => void): void {
  if (stream.off) {
    stream.off(event, handler)
    return
  }

  stream.removeListener?.(event, handler)
}

export function pipeline<T extends PipeableStream[]>(...streams: T): Promise<T[number]> {
  if (streams.length < 2) {
    return Promise.reject(new Error("pipeline requires at least two streams"))
  }

  return new Promise((resolve, reject) => {
    const destination = streams[streams.length - 1]!
    const cleanup = () => {
      for (const stream of streams) {
        removeListener(stream, "error", onError)
      }
      removeListener(destination, "finish", onFinish)
      removeListener(destination, "close", onFinish)
    }

    const onError = (error: unknown) => {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    const onFinish = () => {
      cleanup()
      resolve(destination)
    }

    for (const stream of streams) {
      stream.on("error", onError)
    }

    destination.on("finish", onFinish)
    destination.on("close", onFinish)

    streams.reduce((current, next) => current.pipe(next))
  })
}

export default {
  pipeline,
}
