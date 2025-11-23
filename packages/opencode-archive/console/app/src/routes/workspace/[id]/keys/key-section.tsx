import { json, query, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, createSignal, For, Show } from "solid-js"
import { IconCopy, IconCheck } from "~/component/icon"
import { Key } from "@opencode-ai/console-core/key.js"
import { withActor } from "~/context/auth.withActor"
import { createStore } from "solid-js/store"
import { formatDateUTC, formatDateForTable } from "../../common"
import styles from "./key-section.module.css"
import { Actor } from "@opencode-ai/console-core/actor.js"

const removeKey = action(async (form: FormData) => {
  "use server"
  const id = form.get("id")?.toString()
  if (!id) return { error: "ID is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(await withActor(() => Key.remove({ id }), workspaceID), { revalidate: listKeys.key })
}, "key.remove")

const createKey = action(async (form: FormData) => {
  "use server"
  const name = form.get("name")?.toString().trim()
  if (!name) return { error: "Name is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(
    await withActor(
      () =>
        Key.create({
          userID: Actor.assert("user").properties.userID,
          name,
        })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: listKeys.key },
  )
}, "key.create")

const listKeys = query(async (workspaceID: string) => {
  "use server"
  return withActor(() => Key.list(), workspaceID)
}, "key.list")

export function KeySection() {
  const params = useParams()
  const keys = createAsync(() => listKeys(params.id!))
  const submission = useSubmission(createKey)
  const [store, setStore] = createStore({ show: false })

  let input: HTMLInputElement

  createEffect(() => {
    if (!submission.pending && submission.result && !submission.result.error) {
      setStore("show", false)
    }
  })

  function show() {
    while (true) {
      submission.clear()
      if (!submission.result) break
    }
    setStore("show", true)
    setTimeout(() => input?.focus(), 0)
  }

  function hide() {
    setStore("show", false)
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>API Keys</h2>
        <div data-slot="title-row">
          <p>Manage your API keys for accessing opencode services.</p>
          <button data-color="primary" onClick={() => show()}>
            Create API Key
          </button>
        </div>
      </div>
      <Show when={store.show}>
        <form action={createKey} method="post" data-slot="create-form">
          <div data-slot="input-container">
            <input
              ref={(r) => (input = r)}
              data-component="input"
              name="name"
              type="text"
              placeholder="Enter key name"
            />
            <Show when={submission.result && submission.result.error}>
              {(err) => <div data-slot="form-error">{err()}</div>}
            </Show>
          </div>
          <input type="hidden" name="workspaceID" value={params.id} />
          <div data-slot="form-actions">
            <button type="reset" data-color="ghost" onClick={() => hide()}>
              Cancel
            </button>
            <button type="submit" data-color="primary" disabled={submission.pending}>
              {submission.pending ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </Show>
      <div data-slot="api-keys-table">
        <Show
          when={keys()?.length}
          fallback={
            <div data-component="empty-state">
              <p>Create an opencode Gateway API key</p>
            </div>
          }
        >
          <table data-slot="api-keys-table-element">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Created By</th>
                <th>Last Used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={keys()!}>
                {(key) => {
                  const [copied, setCopied] = createSignal(false)
                  // const submission = useSubmission(removeKey, ([fd]) => fd.get("id")?.toString() === key.id)
                  return (
                    <tr>
                      <td data-slot="key-name">{key.name}</td>
                      <td data-slot="key-value">
                        <Show when={key.key} fallback={<span>{key.keyDisplay}</span>}>
                          <button
                            data-color="ghost"
                            disabled={copied()}
                            onClick={async () => {
                              await navigator.clipboard.writeText(key.key!)
                              setCopied(true)
                              setTimeout(() => setCopied(false), 1000)
                            }}
                            title="Copy API key"
                          >
                            <span>{key.keyDisplay}</span>
                            <Show when={copied()} fallback={<IconCopy style={{ width: "14px", height: "14px" }} />}>
                              <IconCheck style={{ width: "14px", height: "14px" }} />
                            </Show>
                          </button>
                        </Show>
                      </td>
                      <td data-slot="key-user-email">{key.email}</td>
                      <td data-slot="key-last-used" title={key.timeUsed ? formatDateUTC(key.timeUsed) : undefined}>
                        {key.timeUsed ? formatDateForTable(key.timeUsed) : "-"}
                      </td>
                      <td data-slot="key-actions">
                        <form action={removeKey} method="post">
                          <input type="hidden" name="id" value={key.id} />
                          <input type="hidden" name="workspaceID" value={params.id} />
                          <button data-color="ghost">Delete</button>
                        </form>
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </section>
  )
}
