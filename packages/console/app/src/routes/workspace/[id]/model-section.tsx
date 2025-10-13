import { Model } from "@opencode-ai/console-core/model.js"
import { query, action, useParams, createAsync, json } from "@solidjs/router"
import { createMemo, For, Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { ZenModel } from "@opencode-ai/console-core/model.js"
import styles from "./model-section.module.css"
import { querySessionInfo } from "../common"

const getModelsInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return {
      all: Object.entries(ZenModel.list())
        .filter(([id, _model]) => !["claude-3-5-haiku", "qwen3-max"].includes(id))
        .sort(([_idA, modelA], [_idB, modelB]) => modelA.name.localeCompare(modelB.name))
        .map(([id, model]) => ({ id, name: model.name })),
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
  const userInfo = createAsync(() => querySessionInfo(params.id))
  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Models</h2>
        <p>
          Manage which models workspace members can access. Requests will fail if a member tries to use a disabled
          model.{userInfo()?.isAdmin ? "" : " To use a disabled model, contact your workspace’s admin."}
        </p>
      </div>
      <div data-slot="models-list">
        <Show when={modelsInfo()}>
          <div data-slot="models-table">
            <table data-slot="models-table-element">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Enabled</th>
                </tr>
              </thead>
              <tbody>
                <For each={modelsInfo()!.all}>
                  {({ id, name }) => {
                    const isEnabled = createMemo(() => !modelsInfo()!.disabled.includes(id))
                    return (
                      <tr data-slot="model-row" data-disabled={!isEnabled()}>
                        <td data-slot="model-name">{name}</td>
                        <td data-slot="model-toggle">
                          <form action={updateModel} method="post">
                            <input type="hidden" name="model" value={id} />
                            <input type="hidden" name="workspaceID" value={params.id} />
                            <input type="hidden" name="enabled" value={isEnabled().toString()} />
                            <label data-slot="model-toggle-label">
                              <input
                                type="checkbox"
                                checked={isEnabled()}
                                disabled={!userInfo()?.isAdmin}
                                onChange={(e) => {
                                  const form = e.currentTarget.closest("form")
                                  if (form) form.requestSubmit()
                                }}
                              />
                              <span></span>
                            </label>
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
