import { query, useParams, createAsync } from "@solidjs/router"
import { createMemo, createSignal, Show } from "solid-js"
import { IconCopy, IconCheck } from "~/component/icon"
import { Key } from "@opencode-ai/console-core/key.js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { withActor } from "~/context/auth.withActor"
import styles from "./new-user-section.module.css"
import { useI18n } from "~/context/i18n"

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
  const i18n = useI18n()
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
            <h3>{i18n.t("workspace.newUser.feature.tested.title")}</h3>
            <p>{i18n.t("workspace.newUser.feature.tested.body")}</p>
          </div>
          <div data-slot="feature">
            <h3>{i18n.t("workspace.newUser.feature.quality.title")}</h3>
            <p>{i18n.t("workspace.newUser.feature.quality.body")}</p>
          </div>
          <div data-slot="feature">
            <h3>{i18n.t("workspace.newUser.feature.lockin.title")}</h3>
            <p>{i18n.t("workspace.newUser.feature.lockin.body")}</p>
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
                  title={i18n.t("workspace.newUser.copyApiKey")}
                >
                  <Show
                    when={copiedKey()}
                    fallback={
                      <>
                        <IconCopy style={{ width: "16px", height: "16px" }} /> {i18n.t("workspace.newUser.copyKey")}
                      </>
                    }
                  >
                    <IconCheck style={{ width: "16px", height: "16px" }} /> {i18n.t("workspace.newUser.copied")}
                  </Show>
                </button>
              </div>
            </div>
          </Show>
        </div>

        <div data-component="next-steps">
          <ol>
            <li>{i18n.t("workspace.newUser.step.enableBilling")}</li>
            <li>
              {i18n.t("workspace.newUser.step.login.before")} <code>opencode auth login</code>{" "}
              {i18n.t("workspace.newUser.step.login.after")}
            </li>
            <li>{i18n.t("workspace.newUser.step.pasteKey")}</li>
            <li>
              {i18n.t("workspace.newUser.step.models.before")} <code>/models</code>{" "}
              {i18n.t("workspace.newUser.step.models.after")}
            </li>
          </ol>
        </div>
      </div>
    </Show>
  )
}
