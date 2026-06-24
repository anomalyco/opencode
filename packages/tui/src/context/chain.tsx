import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useRoute } from "./route"
import { useLocal } from "./local"
import { useProject } from "./project"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import type { FilePartInput } from "@opencode-ai/sdk/v2"

export type ChainKind = "followup" | "fresh" | "compact"

export type ChainJob = {
  id: string
  kind: ChainKind
  text: string
  parts: FilePartInput[]
  /** Session the job was enqueued from; the pump advances this for fresh chains. */
  sessionID: string
}

type SessionStatus = ReturnType<ReturnType<typeof useSync>["session"]["status"]>

const POLL_MS = 150
const WAIT_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const WAIT_WORKING_TIMEOUT_MS = 15 * 1000

export const { use: useChain, provider: ChainProvider } = createSimpleContext({
  name: "Chain",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const route = useRoute()
    const local = useLocal()
    const project = useProject()
    const toast = useToast()

    const [store, setStore] = createStore<{ jobs: ChainJob[]; running: boolean }>({
      jobs: [],
      running: false,
    })

    function status(sessionID: string): SessionStatus {
      return sync.session.status(sessionID)
    }

    function waitFor(sessionID: string, predicate: (status: SessionStatus) => boolean, timeoutMs: number) {
      return new Promise<boolean>((resolve) => {
        if (predicate(status(sessionID))) return resolve(true)
        const started = Date.now()
        const timer = setInterval(() => {
          if (predicate(status(sessionID))) {
            clearInterval(timer)
            resolve(true)
            return
          }
          if (Date.now() - started > timeoutMs) {
            clearInterval(timer)
            resolve(false)
          }
        }, POLL_MS)
      })
    }

    const waitForIdle = (sessionID: string) => waitFor(sessionID, (s) => s === "idle", WAIT_IDLE_TIMEOUT_MS)
    const waitForBusy = (sessionID: string) => waitFor(sessionID, (s) => s !== "idle", WAIT_WORKING_TIMEOUT_MS)

    function model() {
      const selected = local.model.current()
      if (!selected) return undefined
      return {
        providerID: selected.providerID,
        id: selected.modelID,
        variant: local.model.variant.current(),
      }
    }

    function prompt(sessionID: string, agentName: string, providerID: string, modelID: string, variant: string | undefined, job: ChainJob) {
      return sdk.client.session.prompt(
        {
          sessionID,
          model: { providerID, modelID },
          agent: agentName,
          variant,
          parts: [{ type: "text", text: job.text }, ...job.parts],
        },
        { throwOnError: true },
      )
    }

    // `sourceID` is the chain's current head — the session the previous job
    // ended in, NOT the session captured when the command was typed. This keeps
    // mixed permutations chaining correctly: each job waits on the live head.
    // Returns the session the job's message landed in (the next head).
    async function dispatch(job: ChainJob, sourceID: string): Promise<string | undefined> {
      const agent = local.agent.current()
      const selectedModel = model()
      if (!agent || !selectedModel) {
        toast.show({ title: "Chained message skipped", message: "No model or agent selected", variant: "error" })
        return undefined
      }

      // Make sure the source turn is fully finished before we touch the session.
      await waitForIdle(sourceID)

      if (job.kind === "followup") {
        // Plain follow-up in the same chat — like typing a normal message, but
        // only after the agent has completely finished (not mid-turn steering).
        await prompt(sourceID, agent.name, selectedModel.providerID, selectedModel.id, selectedModel.variant, job)
        return sourceID
      }

      if (job.kind === "compact") {
        // Stay in the same session. Compaction inserts a checkpoint that both
        // slices model context server-side and renders as the visible boundary,
        // then we answer the queued message right here — no jump to a new chat.
        // The summarize endpoint awaits compaction server-side before resolving
        // (see opencode httpapi handler: compactSvc.create + promptSvc.loop), so
        // the checkpoint is already written once this await returns — no extra
        // status polling needed (and a no-op summarize won't stall us).
        await sdk.client.session.summarize({
          sessionID: sourceID,
          providerID: selectedModel.providerID,
          modelID: selectedModel.id,
        })
        await prompt(sourceID, agent.name, selectedModel.providerID, selectedModel.id, selectedModel.variant, job)
        return sourceID
      }

      // fresh: open a truly standalone session (no parentID — a parentID would
      // make opencode render it as a sub-agent and hide the prompt).
      const created = await sdk.client.session.create({
        directory: project.instance.directory(),
        workspace: project.workspace.current() ?? undefined,
        agent: agent.name,
        model: { providerID: selectedModel.providerID, id: selectedModel.id, variant: selectedModel.variant },
      })
      if (created.error || !created.data) {
        toast.show({ title: "Chained message failed", message: errorMessage(created.error ?? "no response"), variant: "error" })
        return undefined
      }
      const newID = created.data.id
      route.navigate({ type: "session", sessionID: newID })
      await prompt(newID, agent.name, selectedModel.providerID, selectedModel.id, selectedModel.variant, job)
      return newID
    }

    async function pump() {
      if (store.running) return
      setStore("running", true)
      // The chain head is the session each job's message lands in. A fresh job
      // moves the head to its new session; a compact job keeps it in place. The
      // next job waits on / summarizes that head. The first job seeds the head
      // from where the command was typed.
      let head: string | undefined
      try {
        while (store.jobs.length > 0) {
          const job = store.jobs[0]
          const target = head ?? job.sessionID
          try {
            const ranIn = await dispatch(job, target)
            // Confirm the new turn actually started so the next job's waitForIdle
            // doesn't read a stale "idle" from the just-finished turn.
            if (ranIn) {
              head = ranIn
              await waitForBusy(ranIn)
            }
          } catch (error) {
            toast.show({ title: "Chained message failed", message: errorMessage(error), variant: "error" })
          }
          setStore("jobs", (jobs) => jobs.slice(1))
        }
      } finally {
        setStore("running", false)
      }
    }

    return {
      get jobs() {
        return store.jobs
      },
      get running() {
        return store.running
      },
      enqueue(input: { kind: ChainKind; text: string; parts?: FilePartInput[]; sessionID: string }) {
        const job: ChainJob = {
          id: `chain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          kind: input.kind,
          text: input.text,
          parts: input.parts ?? [],
          sessionID: input.sessionID,
        }
        setStore("jobs", produce((jobs) => jobs.push(job)))
        void pump()
      },
      remove(id: string) {
        setStore("jobs", (jobs) => jobs.filter((job) => job.id !== id))
      },
      update(id: string, text: string) {
        const index = store.jobs.findIndex((job) => job.id === id)
        if (index === -1) return false
        setStore("jobs", index, "text", text)
        return true
      },
      has(id: string) {
        return store.jobs.some((job) => job.id === id)
      },
      clear() {
        setStore("jobs", [])
      },
    }
  },
})
