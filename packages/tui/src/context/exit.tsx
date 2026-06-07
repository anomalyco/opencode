import { createSimpleContext } from "./helper"

export type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
}

export function createExit(run: (reason: unknown | undefined, message: () => string | undefined) => Promise<void>) {
  let message: string | undefined
  let task: Promise<void> | undefined
  const store = {
    set: (value?: string) => {
      const prev = message
      message = value
      return () => {
        message = prev
      }
    },
    clear: () => {
      message = undefined
    },
    get: () => message,
  }

  return Object.assign(
    (reason?: unknown) => {
      task ??= run(reason, store.get)
      return task
    },
    {
      message: store,
    },
  ) satisfies Exit
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { exit: Exit }) => input.exit,
})
