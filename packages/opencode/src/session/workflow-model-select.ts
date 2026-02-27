import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { GitLabModelCache } from "@gitlab/gitlab-ai-provider"
import { randomBytes } from "crypto"
import z from "zod"

export namespace WorkflowModelSelect {
  const log = Log.create({ service: "workflow-model-select" })

  export const Model = z.object({
    name: z.string(),
    ref: z.string(),
    isDefault: z.boolean().optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Request = z.object({
    id: z.string(),
    sessionID: z.string(),
    models: z.array(Model),
  })
  export type Request = z.infer<typeof Request>

  export const Event = {
    Asked: BusEvent.define("workflow_model_select.asked", Request),
    Replied: BusEvent.define(
      "workflow_model_select.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        modelRef: z.string().nullable(),
      }),
    ),
  }

  function getModelCache(): GitLabModelCache {
    return new GitLabModelCache(Instance.directory)
  }

  const state = Instance.state(async () => {
    const pending: Record<
      string,
      {
        info: Request
        resolve: (modelRef: string | null) => void
      }
    > = {}

    const cache = getModelCache()
    const cached = cache.load()
    let lastSelectedRef: string | null = cached?.selectedModelRef ?? null
    let lastSelectedName: string | null = cached?.selectedModelName ?? null

    if (lastSelectedRef) {
      log.info("loaded cached model selection", { ref: lastSelectedRef, name: lastSelectedName })
    }

    return {
      pending,
      get lastSelectedRef() {
        return lastSelectedRef
      },
      set lastSelectedRef(v) {
        lastSelectedRef = v
      },
      get lastSelectedName() {
        return lastSelectedName
      },
      set lastSelectedName(v) {
        lastSelectedName = v
      },
    }
  })

  export async function ask(input: { sessionID: string; models: Model[] }): Promise<string | null> {
    const s = await state()
    const id = `wfm_${randomBytes(12).toString("hex")}`

    log.info("asking", { id, models: input.models.length })

    return new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        if (s.pending[id]) {
          log.warn("timed out waiting for model selection", { id })
          delete s.pending[id]
          resolve(null)
        }
      }, 60_000)

      const info: Request = {
        id,
        sessionID: input.sessionID,
        models: input.models,
      }
      s.pending[id] = {
        info,
        resolve: (modelRef) => {
          clearTimeout(timeout)
          resolve(modelRef)
        },
      }
      Bus.publish(Event.Asked, info)
    })
  }

  export async function reply(input: {
    requestID: string
    modelRef: string | null
    modelName?: string | null
  }): Promise<void> {
    const s = await state()
    const existing = s.pending[input.requestID]
    if (!existing) {
      log.warn("reply for unknown request", { requestID: input.requestID })
      return
    }
    delete s.pending[input.requestID]

    log.info("replied", { requestID: input.requestID, modelRef: input.modelRef })

    Bus.publish(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      modelRef: input.modelRef,
    })

    if (input.modelRef) {
      s.lastSelectedRef = input.modelRef
      s.lastSelectedName = input.modelName ?? null
      const cache = getModelCache()
      cache.saveSelection(input.modelRef, input.modelName ?? null)
      log.info("set lastSelectedRef", { ref: input.modelRef, verify: s.lastSelectedRef })
    }

    existing.resolve(input.modelRef)
  }

  export async function getLastSelection(): Promise<string | null> {
    const s = await state()
    log.info("getLastSelection", { ref: s.lastSelectedRef })
    return s.lastSelectedRef
  }

  export async function getLastSelectionName(): Promise<string | null> {
    const s = await state()
    return s.lastSelectedName
  }

  export async function setLastSelection(ref: string | null, name?: string | null): Promise<void> {
    const s = await state()
    s.lastSelectedRef = ref
    s.lastSelectedName = name ?? null
    const cache = getModelCache()
    cache.saveSelection(ref, name ?? null)
  }

  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }
}
