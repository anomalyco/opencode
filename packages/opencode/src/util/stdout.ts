/**
 * Write `text` to stdout and resolve once the stream has accepted all of it.
 *
 * `process.stdout.write()` returns false when the destination (typically a
 * pipe) cannot take the whole payload at once. The remainder is queued on the
 * stream, and anything still queued when the process exits is discarded, so
 * large output is silently truncated at the pipe buffer boundary while the
 * command still exits 0. Awaiting `drain` before returning keeps the write
 * intact.
 *
 * A downstream reader that goes away (`| head`) raises EPIPE and never emits
 * `drain`, so that case resolves rather than hanging forever. Any other write
 * error rejects: attaching a listener suppresses the default crash, and
 * reporting success after a failed write is the same silent-truncation trap
 * this function exists to close.
 */
export function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.stdout.write(text)) return resolve()
    const settle = (err?: NodeJS.ErrnoException) => {
      process.stdout.off("drain", onDrain)
      process.stdout.off("error", onError)
      process.stdout.off("close", onDrain)
      if (err && err.code !== "EPIPE") reject(err)
      else resolve()
    }
    const onDrain = () => settle()
    const onError = (err: NodeJS.ErrnoException) => settle(err)
    process.stdout.on("drain", onDrain)
    process.stdout.on("error", onError)
    process.stdout.on("close", onDrain)
  })
}
