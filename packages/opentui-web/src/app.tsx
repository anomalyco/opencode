import type { Component } from "solid-js"
import { onMount } from "solid-js"
import { createOpencodeClient } from "@opencode-ai/sdk/client"
import { SessionView } from "./components/session-view"
import { SDKProvider } from "./context/sdk"
import { SyncProvider } from "./context/sync"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
})

export const App: Component = () => {
  onMount(() => {
    console.log("OpenTUI Web initialized")
  })

  return (
    <SDKProvider client={client}>
      <SyncProvider>
        <div
          style={{
            width: "100vw",
            height: "100vh",
            display: "flex",
            "flex-direction": "column",
            "font-family": "monospace",
            background: "#1e1e1e",
            color: "#d4d4d4",
          }}
        >
          <SessionView />
        </div>
      </SyncProvider>
    </SDKProvider>
  )
}
