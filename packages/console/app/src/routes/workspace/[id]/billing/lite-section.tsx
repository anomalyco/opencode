import { action, useParams, useAction, useSubmission, json, query, createAsync } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { Show } from "solid-js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Database, eq, and, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable, LiteTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { Subscription } from "@opencode-ai/console-core/subscription.js"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { withActor } from "~/context/auth.withActor"
import { queryBillingInfo } from "../../common"
import styles from "./lite-section.module.css"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { formError } from "~/lib/form-error"

const queryLiteSubscription = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const row = await Database.use((tx) =>
      tx
        .select({
          userID: LiteTable.userID,
          rollingUsage: LiteTable.rollingUsage,
          weeklyUsage: LiteTable.weeklyUsage,
          monthlyUsage: LiteTable.monthlyUsage,
          timeRollingUpdated: LiteTable.timeRollingUpdated,
          timeWeeklyUpdated: LiteTable.timeWeeklyUpdated,
          timeMonthlyUpdated: LiteTable.timeMonthlyUpdated,
          timeCreated: LiteTable.timeCreated,
          lite: BillingTable.lite,
        })
        .from(BillingTable)
        .innerJoin(LiteTable, eq(LiteTable.workspaceID, BillingTable.workspaceID))
        .where(and(eq(LiteTable.workspaceID, Actor.workspace()), isNull(LiteTable.timeDeleted)))
        .then((r) => r[0]),
    )
    if (!row) return null

    const limits = LiteData.getLimits()
    const mine = row.userID === Actor.userID()

    return {
      mine,
      useBalance: row.lite?.useBalance ?? false,
      rollingUsage: Subscription.analyzeRollingUsage({
        limit: limits.rollingLimit,
        window: limits.rollingWindow,
        usage: row.rollingUsage ?? 0,
        timeUpdated: row.timeRollingUpdated ?? new Date(),
      }),
      weeklyUsage: Subscription.analyzeWeeklyUsage({
        limit: limits.weeklyLimit,
        usage: row.weeklyUsage ?? 0,
        timeUpdated: row.timeWeeklyUpdated ?? new Date(),
      }),
      monthlyUsage: Subscription.analyzeMonthlyUsage({
        limit: limits.monthlyLimit,
        usage: row.monthlyUsage ?? 0,
        timeUpdated: row.timeMonthlyUpdated ?? new Date(),
        timeSubscribed: row.timeCreated,
      }),
    }
  }, workspaceID)
}, "lite.subscription.get")

function formatResetTime(seconds: number, i18n: ReturnType<typeof useI18n>) {
  const days = Math.floor(seconds / 86400)
  if (days >= 1) {
    const hours = Math.floor((seconds % 86400) / 3600)
    return `${days} ${days === 1 ? i18n.t("workspace.lite.time.day") : i18n.t("workspace.lite.time.days")} ${hours} ${hours === 1 ? i18n.t("workspace.lite.time.hour") : i18n.t("workspace.lite.time.hours")}`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours >= 1)
    return `${hours} ${hours === 1 ? i18n.t("workspace.lite.time.hour") : i18n.t("workspace.lite.time.hours")} ${minutes} ${minutes === 1 ? i18n.t("workspace.lite.time.minute") : i18n.t("workspace.lite.time.minutes")}`
  if (minutes === 0) return i18n.t("workspace.lite.time.fewSeconds")
  return `${minutes} ${minutes === 1 ? i18n.t("workspace.lite.time.minute") : i18n.t("workspace.lite.time.minutes")}`
}

const createLiteCheckoutUrl = action(async (workspaceID: string, successUrl: string, cancelUrl: string) => {
  "use server"
  return json(
    await withActor(
      () =>
        Billing.generateLiteCheckoutUrl({ successUrl, cancelUrl })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({
            error: e.message as string,
            data: undefined,
          })),
      workspaceID,
    ),
    { revalidate: [queryBillingInfo.key, queryLiteSubscription.key] },
  )
}, "liteCheckoutUrl")

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
    { revalidate: [queryBillingInfo.key, queryLiteSubscription.key] },
  )
}, "liteSessionUrl")

const setLiteUseBalance = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: formError.workspaceRequired }
  const useBalance = form.get("useBalance")?.toString() === "true"

  return json(
    await withActor(async () => {
      await Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            lite: useBalance ? { useBalance: true } : {},
          })
          .where(eq(BillingTable.workspaceID, workspaceID)),
      )
      return { error: undefined }
    }, workspaceID).catch((e) => ({ error: e.message as string })),
    { revalidate: [queryBillingInfo.key, queryLiteSubscription.key] },
  )
}, "setLiteUseBalance")

export function LiteSection() {
  const params = useParams()
  const i18n = useI18n()
  const language = useLanguage()
  const lite = createAsync(() => queryLiteSubscription(params.id!))
  const sessionAction = useAction(createSessionUrl)
  const sessionSubmission = useSubmission(createSessionUrl)
  const checkoutAction = useAction(createLiteCheckoutUrl)
  const checkoutSubmission = useSubmission(createLiteCheckoutUrl)
  const useBalanceSubmission = useSubmission(setLiteUseBalance)
  const [store, setStore] = createStore({
    redirecting: false,
  })

  async function onClickSession() {
    const result = await sessionAction(params.id!, window.location.href)
    if (result.data) {
      setStore("redirecting", true)
      window.location.href = result.data
    }
  }

  async function onClickSubscribe() {
    const result = await checkoutAction(params.id!, window.location.href, window.location.href)
    if (result.data) {
      setStore("redirecting", true)
      window.location.href = result.data
    }
  }

  return (
    <>
      <Show when={lite() && lite()!.mine && lite()!}>
        {(sub) => (
          <section class={styles.root}>
            <div data-slot="section-title">
              <h2>{i18n.t("workspace.lite.subscription.title")}</h2>
              <div data-slot="title-row">
                <p>{i18n.t("workspace.lite.subscription.message")}</p>
                <button
                  data-color="primary"
                  disabled={sessionSubmission.pending || store.redirecting}
                  onClick={onClickSession}
                >
                  {sessionSubmission.pending || store.redirecting
                    ? i18n.t("workspace.lite.loading")
                    : i18n.t("workspace.lite.subscription.manage")}
                </button>
              </div>
            </div>
            <div data-slot="beta-notice">
              {i18n.t("workspace.lite.subscription.selectProvider")}{" "}
              <a href={language.route("/docs/providers/#opencode-go")} target="_blank" rel="noopener noreferrer">
                {i18n.t("common.learnMore")}
              </a>
              .
            </div>
            <div data-slot="usage">
              <div data-slot="usage-item">
                <div data-slot="usage-header">
                  <span data-slot="usage-label">{i18n.t("workspace.lite.subscription.rollingUsage")}</span>
                  <span data-slot="usage-value">{sub().rollingUsage.usagePercent}%</span>
                </div>
                <div data-slot="progress">
                  <div data-slot="progress-bar" style={{ width: `${sub().rollingUsage.usagePercent}%` }} />
                </div>
                <span data-slot="reset-time">
                  {i18n.t("workspace.lite.subscription.resetsIn")}{" "}
                  {formatResetTime(sub().rollingUsage.resetInSec, i18n)}
                </span>
              </div>
              <div data-slot="usage-item">
                <div data-slot="usage-header">
                  <span data-slot="usage-label">{i18n.t("workspace.lite.subscription.weeklyUsage")}</span>
                  <span data-slot="usage-value">{sub().weeklyUsage.usagePercent}%</span>
                </div>
                <div data-slot="progress">
                  <div data-slot="progress-bar" style={{ width: `${sub().weeklyUsage.usagePercent}%` }} />
                </div>
                <span data-slot="reset-time">
                  {i18n.t("workspace.lite.subscription.resetsIn")} {formatResetTime(sub().weeklyUsage.resetInSec, i18n)}
                </span>
              </div>
              <div data-slot="usage-item">
                <div data-slot="usage-header">
                  <span data-slot="usage-label">{i18n.t("workspace.lite.subscription.monthlyUsage")}</span>
                  <span data-slot="usage-value">{sub().monthlyUsage.usagePercent}%</span>
                </div>
                <div data-slot="progress">
                  <div data-slot="progress-bar" style={{ width: `${sub().monthlyUsage.usagePercent}%` }} />
                </div>
                <span data-slot="reset-time">
                  {i18n.t("workspace.lite.subscription.resetsIn")}{" "}
                  {formatResetTime(sub().monthlyUsage.resetInSec, i18n)}
                </span>
              </div>
            </div>
            <form action={setLiteUseBalance} method="post" data-slot="setting-row">
              <p>{i18n.t("workspace.lite.subscription.useBalance")}</p>
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
      <Show when={lite() && !lite()!.mine}>
        <section class={styles.root}>
          <div data-slot="section-title">
            <h2>{i18n.t("workspace.lite.other.title")}</h2>
          </div>
          <p data-slot="other-message">{i18n.t("workspace.lite.other.message")}</p>
        </section>
      </Show>
      <Show when={lite() === null}>
        <section class={styles.root}>
          <div data-slot="section-title">
            <h2>{i18n.t("workspace.lite.promo.title")}</h2>
          </div>
          <p data-slot="promo-description">{i18n.t("workspace.lite.promo.description")}</p>
          <h3 data-slot="promo-models-title">{i18n.t("workspace.lite.promo.modelsTitle")}</h3>
          <ul data-slot="promo-models">
            <li>Kimi K2.5</li>
            <li>GLM-5</li>
            <li>MiniMax M2.5</li>
          </ul>
          <p data-slot="promo-description">{i18n.t("workspace.lite.promo.footer")}</p>
          <button
            data-slot="subscribe-button"
            data-color="primary"
            disabled={checkoutSubmission.pending || store.redirecting}
            onClick={onClickSubscribe}
          >
            {checkoutSubmission.pending || store.redirecting
              ? i18n.t("workspace.lite.promo.subscribing")
              : i18n.t("workspace.lite.promo.subscribe")}
          </button>
        </section>
      </Show>
    </>
  )
}
