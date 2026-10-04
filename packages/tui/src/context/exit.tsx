import { createSimpleContext } from "./helper"

export type Exit = (reason?: unknown) => void

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { exit: Exit }) => input.exit,
})
