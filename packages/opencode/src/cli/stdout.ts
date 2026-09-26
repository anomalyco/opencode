import { Effect } from "effect"
import { CliError } from "./effect-cmd"

// stdout is asynchronous when it is a pipe, and src/index.ts terminates
// as soon as a command returns, so anything still queued on the stream is lost
// (#29330). Wait for the write callback like generate.ts does. EPIPE means the
// reader went away (`| head`) and counts as done; the 'error' event that follows a
// failed write keeps its listener so it cannot crash the process.
export const writeStdout = (text: string) =>
  Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        const settle = (err?: Error | null) => {
          const code = (err as NodeJS.ErrnoException | null | undefined)?.code
          return !err || code === "EPIPE" ? resolve() : reject(err)
        }
        process.stdout.once("error", settle)
        process.stdout.write(text, settle)
      }),
    catch: (cause) => new CliError({ message: `failed to write to stdout: ${String(cause)}` }),
  })
