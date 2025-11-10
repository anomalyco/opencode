import type { Component } from "solid-js"
import { onMount } from "solid-js"
import { createOpencodeClient } from "@opencode-ai/sdk/client"
import { TerminalView } from "./components/TerminalView"
import { SDKProvider } from "./context/sdk"
import { SyncProvider } from "./context/sync"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
})

export const App: Component = () => {
  onMount(() => {
    console.log("OpenTUI Web - Terminal Mode with SDK")
  })

  return (
    <SDKProvider client={client}>
      <SyncProvider>
        <TerminalView />
      </SyncProvider>
    </SDKProvider>
  )
}
