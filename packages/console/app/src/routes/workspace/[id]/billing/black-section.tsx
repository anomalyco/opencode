import { action, useParams, useAction, useSubmission, json, query, createAsync } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { Show } from "solid-js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Database, eq, and, isNull, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable, SubscriptionTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { Black } from "@opencode-ai/console-core/black.js"
import { withActor } from "~/context/auth.withActor"
import { queryBillingInfo } from "../../common"
import styles from "./black-section.module.css"
import waitlistStyles from "./black-waitlist-section.module.css"

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
          subscription: BillingTable.subscription,
        })
        .from(BillingTable)
        .innerJoin(SubscriptionTable, eq(SubscriptionTable.workspaceID, BillingTable.workspaceID))
        .where(and(eq(SubscriptionTable.workspaceID, Actor.workspace()), isNull(SubscriptionTable.timeDeleted)))
        .then((r) => r[0]),
    )
    if (!row?.subscription) return null

    return {
      plan: row.subscription.plan,
      useBalance: row.subscription.useBalance ?? false,
      rollingUsage: Black.analyzeRollingUsage({
        plan: row.subscription.plan,
        usage: row.rollingUsage ?? 0,
        timeUpdated: row.timeRollingUpdated ?? new Date(),
      }),
      weeklyUsage: Black.analyzeWeeklyUsage({
        plan: row.subscription.plan,
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

const cancelWaitlist = action(async (workspaceID: string) => {
  "use server"
  return json(
    await withActor(async () => {
      await Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            subscriptionPlan: null,
            timeSubscriptionBooked: null,
            timeSubscriptionSelected: null,
          })
          .where(eq(BillingTable.workspaceID, workspaceID)),
      )
      return { error: undefined }
    }, workspaceID).catch((e) => ({ error: e.message as string })),
    { revalidate: [queryBillingInfo.key, querySubscription.key] },
  )
}, "cancelWaitlist")

const enroll = action(async (workspaceID: string) => {
  "use server"
  return json(
    await withActor(async () => {
      await Billing.subscribe({ seats: 1 })
      return { error: undefined }
    }, workspaceID).catch((e) => ({ error: e.message as string })),
    { revalidate: [queryBillingInfo.key, querySubscription.key] },
  )
}, "enroll")

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
    { revalidate: [queryBillingInfo.key, querySubscription.key] },
  )
}, "sessionUrl")

const setUseBalance = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  const useBalance = form.get("useBalance")?.toString() === "true"

  return json(
    await withActor(async () => {
      await Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            subscription: useBalance
              ? sql`JSON_SET(subscription, '$.useBalance', true)`
              : sql`JSON_REMOVE(subscription, '$.useBalance')`,
          })
          .where(eq(BillingTable.workspaceID, workspaceID)),
      )
      return { error: undefined }
    }, workspaceID).catch((e) => ({ error: e.message as string })),
    { revalidate: [queryBillingInfo.key, querySubscription.key] },
  )
}, "setUseBalance")

export function BlackSection() {
  const params = useParams()
  const billing = createAsync(() => queryBillingInfo(params.id!))
  const subscription = createAsync(() => querySubscription(params.id!))
  const sessionAction = useAction(createSessionUrl)
  const sessionSubmission = useSubmission(createSessionUrl)
  const cancelAction = useAction(cancelWaitlist)
  const cancelSubmission = useSubmission(cancelWaitlist)
  const enrollAction = useAction(enroll)
  const enrollSubmission = useSubmission(enroll)
  const useBalanceSubmission = useSubmission(setUseBalance)
  const [store, setStore] = createStore({
    sessionRedirecting: false,
    cancelled: false,
    enrolled: false,
  })

  async function onClickSession() {
    const result = await sessionAction(params.id!, window.location.href)
    if (result.data) {
      setStore("sessionRedirecting", true)
      window.location.href = result.data
    }
  }

  async function onClickCancel() {
    const result = await cancelAction(params.id!)
    if (!result.error) {
      setStore("cancelled", true)
    }
  }

  async function onClickEnroll() {
    const result = await enrollAction(params.id!)
    if (!result.error) {
      setStore("enrolled", true)
    }
  }

  return (
    <>
      <Show when={subscription()}>
        {(sub) => (
          <section class={styles.root}>
            <div data-slot="section-title">
              <h2>Subscription</h2>
              <div data-slot="title-row">
                <p>You are subscribed to OpenCode Black for ${sub().plan} per month.</p>
                <button
                  data-color="primary"
                  disabled={sessionSubmission.pending || store.sessionRedirecting}
                  onClick={onClickSession}
                >
                  {sessionSubmission.pending || store.sessionRedirecting ? "Loading..." : "Manage Subscription"}
                </button>
              </div>
            </div>
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
            <form action={setUseBalance} method="post" data-slot="setting-row">
              <p>Use your available balance after reaching the usage limits</p>
              <input type="hidden" name="workspaceID" value={params.id} />
              <input type="hidden" name="useBalance" value={sub().useBalance ? "false" : "true"} />
              <label data-slot="toggle-label">
                <input
                  type="checkbox"
                  checked={sub().useBalance}
                  disabled={useBalanceSubmission.pending}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                />
                <span></span>
              </label>
            </form>
          </section>
        )}
      </Show>
      <Show when={billing()?.timeSubscriptionBooked}>
        <section class={waitlistStyles.root}>
          <div data-slot="section-title">
            <h2>Waitlist</h2>
            <div data-slot="title-row">
              <p>
                {billing()?.timeSubscriptionSelected
                  ? `We're ready to enroll you into the $${billing()?.subscriptionPlan} per month OpenCode Black plan.`
                  : `You are on the waitlist for the $${billing()?.subscriptionPlan} per month OpenCode Black plan.`}
              </p>
              <button
                data-color="danger"
                disabled={cancelSubmission.pending || store.cancelled}
                onClick={onClickCancel}
              >
                {cancelSubmission.pending ? "Leaving..." : store.cancelled ? "Left" : "Leave Waitlist"}
              </button>
            </div>
          </div>
          <Show when={billing()?.timeSubscriptionSelected}>
            <div data-slot="enroll-section">
              <button
                data-slot="enroll-button"
                data-color="primary"
                disabled={enrollSubmission.pending || store.enrolled}
                onClick={onClickEnroll}
              >
                {enrollSubmission.pending ? "Enrolling..." : store.enrolled ? "Enrolled" : "Enroll"}
              </button>
              <p data-slot="enroll-note">
                When you click Enroll, your subscription starts immediately and your card will be charged.
              </p>
            </div>
          </Show>
        </section>
      </Show>
    </>
  )
}
