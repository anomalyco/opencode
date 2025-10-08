import { Model } from "@opencode-ai/console-core/model.js"
import { query, action, useParams, createAsync, json } from "@solidjs/router"
import { createMemo, For, Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { ZenModel } from "@opencode-ai/console-core/model.js"
import styles from "./model-section.module.css"

const getModelsInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return {
      all: Object.keys(ZenModel.list())
        .filter((model) => !["claude-3-5-haiku", "glm-4.6", "qwen3-max"].includes(model))
        .sort(([a], [b]) => a.localeCompare(b)),
      disabled: await Model.listDisabled(),
    }
  }, workspaceID)
}, "model.info")

const updateModel = action(async (form: FormData) => {
  "use server"
  const model = form.get("model")?.toString()
  if (!model) return { error: "Model is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  const enabled = form.get("enabled")?.toString() === "true"
  return json(
    withActor(async () => {
      if (enabled) {
        await Model.disable({ model })
      } else {
        await Model.enable({ model })
      }
    }, workspaceID),
    { revalidate: getModelsInfo.key },
  )
}, "model.toggle")

export function ModelSection() {
  const params = useParams()
  const modelsInfo = createAsync(() => getModelsInfo(params.id))
  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Models</h2>
        <p>Manage models for your workspace.</p>
      </div>
      <div data-slot="models-list">
        <Show
          when={modelsInfo()}
          fallback={
            <div data-component="empty-state">
              <p>Loading models...</p>
            </div>
          }
        >
          <div data-slot="models-table">
            <table data-slot="models-table-element">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <For each={modelsInfo()!.all}>
                  {(modelId) => {
                    const isEnabled = createMemo(() => !modelsInfo()!.disabled.includes(modelId))
                    return (
                      <tr data-slot="model-row" data-enabled={isEnabled()}>
                        <td data-slot="model-name">{modelId}</td>
                        <td data-slot="model-status">{isEnabled() ? "Enabled" : "Disabled"}</td>
                        <td data-slot="model-toggle">
                          <form action={updateModel} method="post">
                            <input type="hidden" name="model" value={modelId} />
                            <input type="hidden" name="workspaceID" value={params.id} />
                            <input type="hidden" name="enabled" value={isEnabled().toString()} />
                            <button data-color="ghost">{isEnabled() ? "Disable" : "Enable"}</button>
                          </form>
                        </td>
                      </tr>
                    )
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </section>
  )
}
