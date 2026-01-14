import { createSimpleContext } from "./helper"
import { createSignal } from "solid-js"

export type StartServerResult = {
  url: string
  password: string
  passwordFromEnv: boolean
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (props: {
    password?: string
    onStartServer?: () => Promise<StartServerResult>
    onStopServer?: () => Promise<void>
  }) => {
    const [password, setPassword] = createSignal(props.password)
    const [starting, setStarting] = createSignal(false)

    return {
      get password() {
        return password()
      },
      get starting() {
        return starting()
      },
      async start() {
        if (!props.onStartServer) return undefined
        if (starting()) return undefined
        setStarting(true)
        try {
          const result = await props.onStartServer()
          setPassword(result.password)
          return result
        } finally {
          setStarting(false)
        }
      },
      async stop() {
        if (!props.onStopServer) return
        await props.onStopServer()
        setPassword(undefined)
      },
    }
  },
})
