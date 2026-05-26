export type FlushableWriteStream = {
  destroyed?: boolean
  writableEnded?: boolean
  write(chunk: string, callback: () => void): boolean
}

export function flushWriteStream(stream: FlushableWriteStream) {
  if (stream.destroyed || stream.writableEnded) return Promise.resolve()
  return new Promise<void>((resolve) => {
    stream.write("", () => resolve())
  })
}
