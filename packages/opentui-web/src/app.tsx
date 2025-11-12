import type { Component } from "solid-js"
import { onMount } from "solid-js"
import { TerminalView } from "./components/TerminalViewNew"
import { SDKProvider } from "./context/sdk"
import { SyncProvider } from "./context/sync"
import { BejazzleProvider } from "./context/bejazzle"
import "./theme/bejazzle.css"
import "./theme/bejazzle-progressive.css"

const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "127.0.0.1"
const port = import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"
const url = `http://${host}:${port}`

export const App: Component = () => {
  onMount(() => {
    console.log("OpenTUI Web - Terminal Mode with SDK", url)
  })

  return (
    <SDKProvider url={url}>
      <SyncProvider>
        <BejazzleProvider>
          <TerminalView />
        </BejazzleProvider>
      </SyncProvider>
    </SDKProvider>
  )
}
