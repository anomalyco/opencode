import { action, useParams, useAction, useSubmission, json, query, createAsync } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { Show } from "solid-js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Database, eq, and, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { SubscriptionTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { Black } from "@opencode-ai/console-core/black.js"
import { withActor } from "~/context/auth.withActor"
import { queryBillingInfo } from "../../common"
import styles from "./black-section.module.css"

const querySubscription = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const row = await Database.use((tx) =>
      tx
        .select({
          rollingUsage: SubscriptionTable.rollingUsage,
          fixedUsage: SubscriptionTable.fixedUsage,
          timeRollingUpdated: SubscriptionTable.timeRollingUpdated,
          timeFixedUpdated: SubscriptionTable.timeFixedUpdated,
        })
        .from(SubscriptionTable)
        .where(and(eq(SubscriptionTable.workspaceID, Actor.workspace()), isNull(SubscriptionTable.timeDeleted)))
        .then((r) => r[0]),
    )
    if (!row) return null

    return {
      rollingUsage: Black.analyzeRollingUsage({
        usage: row.rollingUsage ?? 0,
        timeUpdated: row.timeRollingUpdated ?? new Date(),
      }),
      weeklyUsage: Black.analyzeWeeklyUsage({
        usage: row.fixedUsage ?? 0,
        timeUpdated: row.timeFixedUpdated ?? new Date(),
      }),
    }
  }, workspaceID)
}, "subscription.get")

function formatResetTime(seconds: number) {
  const days = Math.floor(seconds / 86400)
  if (days >= 1) {
    const hours = Math.floor((seconds % 86400) / 3600)
    return `${days} ${days === 1 ? "day" : "days"} ${hours} ${hours === 1 ? "hour" : "hours"}`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"} ${minutes} ${minutes === 1 ? "minute" : "minutes"}`
  if (minutes === 0) return "a few seconds"
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}

const createSessionUrl = action(async (workspaceID: string, returnUrl: string) => {
  "use server"
  return json(
    await withActor(
      () =>
        Billing.generateSessionUrl({ returnUrl })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({
            error: e.message as string,
            data: undefined,
          })),
      workspaceID,
    ),
    { revalidate: queryBillingInfo.key },
  )
}, "sessionUrl")

export function BlackSection() {
  const params = useParams()
  const sessionAction = useAction(createSessionUrl)
  const sessionSubmission = useSubmission(createSessionUrl)
  const subscription = createAsync(() => querySubscription(params.id!))
  const [store, setStore] = createStore({
    sessionRedirecting: false,
  })

  async function onClickSession() {
    const result = await sessionAction(params.id!, window.location.href)
    if (result.data) {
      setStore("sessionRedirecting", true)
      window.location.href = result.data
    }
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Subscription</h2>
        <div data-slot="title-row">
          <p>You are subscribed to OpenCode Black for $200 per month.</p>
          <button
            data-color="primary"
            disabled={sessionSubmission.pending || store.sessionRedirecting}
            onClick={onClickSession}
          >
            {sessionSubmission.pending || store.sessionRedirecting ? "Loading..." : "Manage Subscription"}
          </button>
        </div>
      </div>
      <Show when={subscription()}>
        {(sub) => (
          <div data-slot="usage">
            <div data-slot="usage-item">
              <div data-slot="usage-header">
                <span data-slot="usage-label">5-hour Usage</span>
                <span data-slot="usage-value">{sub().rollingUsage.usagePercent}%</span>
              </div>
              <div data-slot="progress">
                <div data-slot="progress-bar" style={{ width: `${sub().rollingUsage.usagePercent}%` }} />
              </div>
              <span data-slot="reset-time">Resets in {formatResetTime(sub().rollingUsage.resetInSec)}</span>
            </div>
            <div data-slot="usage-item">
              <div data-slot="usage-header">
                <span data-slot="usage-label">Weekly Usage</span>
                <span data-slot="usage-value">{sub().weeklyUsage.usagePercent}%</span>
              </div>
              <div data-slot="progress">
                <div data-slot="progress-bar" style={{ width: `${sub().weeklyUsage.usagePercent}%` }} />
              </div>
              <span data-slot="reset-time">Resets in {formatResetTime(sub().weeklyUsage.resetInSec)}</span>
            </div>
          </div>
        )}
      </Show>
    </section>
  )
}
