import { createSignal, onMount, onCleanup, createEffect } from "solid-js"
import { LeftSidebar } from "./routes/session/left-sidebar"
import { Rpc } from "@/util/rpc"
import { useSDK } from "./context/sdk"
import type { rpc as LeftSidebarRpc } from "./workers/left-sidebar.worker"

interface WorkerState {
  sessions: Array<{
    id: string
    title: string
    createdAt: number
    updatedAt: number
    parentID?: string
  }>
  categorized: {
    today: any[]
    yesterday: any[]
    thisWeek: any[]
    lastWeek: any[]
    older: any[]
  }
  searchResults: any[]
  lastUpdated: number
}

export default function LeftSidebarWorker(props: {
  sessionID: string
  onToggle: () => void
  onSelect: (sessionID: string) => void
  onNewSession: () => void
  openTabs: string[]
  onClose: (sessionID: string) => void | Promise<void>
  width: number
  minWidth: number
  maxWidth: number
  widthStep: number
  onResize: (delta: number) => void
}) {
  const sdk = useSDK()
  const [workerReady, setWorkerReady] = createSignal(false)
  const [workerState, setWorkerState] = createSignal<WorkerState | null>(null)
  const [useWorker] = createSignal(true) // Enable worker mode

  let worker: Worker | null = null
  let client: ReturnType<typeof Rpc.client<typeof LeftSidebarRpc>> | null = null

  onMount(async () => {
    if (!useWorker()) return

    try {
      worker = new Worker(new URL("./workers/left-sidebar.worker.ts", import.meta.url))

      worker.onerror = (err) => {
        console.error("Left sidebar worker error:", err)
        setWorkerReady(false)
      }

      worker.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.type === "state.update") {
            setWorkerState(msg.state)
          }
        } catch {
          // Not our message format
        }
      }

      client = Rpc.client<typeof LeftSidebarRpc>(worker)

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Worker init timeout")), 3000),
      )

      const result = (await Promise.race([
        client.call("init", {
          serverUrl: sdk.url,
          currentSessionID: props.sessionID,
        }),
        timeoutPromise,
      ])) as unknown as { ready: boolean; state: WorkerState }

      setWorkerState(result.state)
      setWorkerReady(true)
    } catch (err) {
      console.error("Failed to init left sidebar worker:", err)
      worker?.terminate()
      worker = null
      client = null
    }
  })

  onCleanup(() => {
    if (client) {
      client.call("shutdown", undefined)
    }
    worker?.terminate()
  })

  // Refresh sessions periodically
  createEffect(() => {
    if (!workerReady() || !client) return

    const interval = setInterval(() => {
      client!.call("refreshSessions", undefined)
    }, 30000) // Every 30 seconds

    onCleanup(() => clearInterval(interval))
  })

  // Render left sidebar - worker computes in background
  return (
    <LeftSidebar
      sessionID={props.sessionID}
      onToggle={props.onToggle}
      onSelect={props.onSelect}
      onNewSession={props.onNewSession}
      openTabs={props.openTabs}
      onClose={props.onClose}
      width={props.width}
      minWidth={props.minWidth}
      maxWidth={props.maxWidth}
      widthStep={props.widthStep}
      onResize={props.onResize}
    />
  )
}
