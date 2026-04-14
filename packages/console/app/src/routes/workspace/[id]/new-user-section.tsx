import { query, useParams, createAsync } from "@solidjs/router"
import { createMemo, createSignal, Show } from "solid-js"
import { IconCopy, IconCheck } from "~/component/icon"
import { Key } from "@opencode-ai/console-core/key.js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { withActor } from "~/context/auth.withActor"
import styles from "./new-user-section.module.css"

const getUsageInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.usages()
  }, workspaceID)
}, "usage.list")

const listKeys = query(async (workspaceID: string) => {
  "use server"
  return withActor(() => Key.list(), workspaceID)
}, "key.list")

export function NewUserSection() {
  const params = useParams()
  const [copiedKey, setCopiedKey] = createSignal(false)
  const keys = createAsync(() => listKeys(params.id!))
  const usage = createAsync(() => getUsageInfo(params.id!))
  const isNew = createMemo(() => {
    const keysList = keys()
    const usageList = usage()
    return keysList?.length === 1 && (!usageList || usageList.length === 0)
  })
  const defaultKey = createMemo(() => {
    const key = keys()?.at(-1)?.key
    if (!key) return undefined
    return {
      actual: key,
      masked: key.slice(0, 8) + "*".repeat(key.length - 12) + key.slice(-4),
    }
  })

  return (
    <Show when={isNew()}>
      <div class={styles.root}>
        <div data-component="feature-grid">
          <div data-slot="feature">
            <h3>Tested & Verified Models</h3>
            <p>We've benchmarked and tested models specifically for coding agents to ensure the best performance.</p>
          </div>
          <div data-slot="feature">
            <h3>Highest Quality</h3>
            <p>Access models configured for optimal performance - no downgrades or routing to cheaper providers.</p>
          </div>
          <div data-slot="feature">
            <h3>No Lock-in</h3>
            <p>Use Zen with any coding agent, and continue using other providers with opencode whenever you want.</p>
          </div>
        </div>

        <div data-component="api-key-highlight">
          <Show when={defaultKey()}>
            <div data-slot="key-display">
              <div data-slot="key-container">
                <code data-slot="key-value">{defaultKey()?.masked}</code>
                <button
                  data-color="primary"
                  disabled={copiedKey()}
                  onClick={async () => {
                    await navigator.clipboard.writeText(defaultKey()?.actual ?? "")
                    setCopiedKey(true)
                    setTimeout(() => setCopiedKey(false), 2000)
                  }}
                  title="Copy API key"
                >
                  <Show
                    when={copiedKey()}
                    fallback={
                      <>
                        <IconCopy style={{ width: "16px", height: "16px" }} /> Copy Key
                      </>
                    }
                  >
                    <IconCheck style={{ width: "16px", height: "16px" }} /> Copied!
                  </Show>
                </button>
              </div>
            </div>
          </Show>
        </div>

        <div data-component="next-steps">
          <ol>
            <li>Enable billing</li>
            <li>
              Run <code>opencode auth login</code> and select opencode
            </li>
            <li>Paste your API key</li>
            <li>
              Start opencode and run <code>/models</code> to select a model
            </li>
          </ol>
        </div>
      </div>
    </Show>
  )
}
