import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Env } from "@/env"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { GitLabModelCache } from "@gitlab/gitlab-ai-provider"
import { randomBytes } from "crypto"
import z from "zod"

export namespace GitLabWorkflowModelSelect {
  const log = Log.create({ service: "gitlab-workflow-model-select" })

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
    Asked: BusEvent.define("gitlab_workflow_model_select.asked", Request),
    Replied: BusEvent.define(
      "gitlab_workflow_model_select.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        modelRef: z.string().nullable(),
      }),
    ),
  }

  function modelCache(): GitLabModelCache {
    const instanceUrl = Env.get("GITLAB_INSTANCE_URL") || "https://gitlab.com"
    return new GitLabModelCache(Instance.directory, instanceUrl)
  }

  const state = Instance.state(async () => {
    const pending: Record<
      string,
      {
        info: Request
        resolve: (modelRef: string | null) => void
      }
    > = {}

    const cached = modelCache().load()
    let lastSelectedRef: string | null = cached?.selectedModelRef ?? null
    let lastSelectedName: string | null = cached?.selectedModelName ?? null

    if (lastSelectedRef) {
      log.debug("loaded cached model selection", { ref: lastSelectedRef, name: lastSelectedName })
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

    log.debug("asking", { id, models: input.models.length })

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

    log.debug("replied", { requestID: input.requestID, modelRef: input.modelRef })

    Bus.publish(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      modelRef: input.modelRef,
    })

    if (input.modelRef) {
      s.lastSelectedRef = input.modelRef
      s.lastSelectedName = input.modelName ?? null
      modelCache().saveSelection(input.modelRef, input.modelName ?? null)
    }

    existing.resolve(input.modelRef)
  }

  export async function getLastSelection(): Promise<string | null> {
    const s = await state()
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
    modelCache().saveSelection(ref, name ?? null)
  }

  export async function list() {
    return state().then((s) => Object.values(s.pending).map((p) => p.info))
  }
}
