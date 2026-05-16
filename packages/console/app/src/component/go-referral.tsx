import { action, createAsync, json, query, useAction, useSubmission } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import { Referral } from "@opencode-ai/console-core/referral.js"
import { Database, and, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { LiteTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { ReferralRewardTable } from "@opencode-ai/console-core/schema/referral.sql.js"
import { Subscription } from "@opencode-ai/console-core/subscription.js"
import { withActor } from "~/context/auth.withActor"
import { Modal } from "~/component/modal"
import { IconCheck, IconCopy } from "~/component/icon"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { formatResetTime, queryLiteSubscription } from "~/routes/workspace/[id]/go/lite-section"
import "./go-referral.css"

export type GoReferralReward = {
  id: string
  amount: number
  email: string
  source: "inviter" | "invitee"
  status: "pending" | "available" | "applied"
  timeCreated: string | Date
  timeApplied: string | Date | null
}

export type GoReferralSummary = {
  inviteCode: string
  inviteUrl: string
  validInviteCount: number
  hasActiveGo: boolean
  rewardAmount: number
  totalEarned: number
  totalApplied: number
  rewards: GoReferralReward[]
}

type AnalyzedUsage = {
  status: "ok" | "rate-limited"
  resetInSec: number
  usagePercent: number
}

type GoReferralUsagePreview = {
  rollingUsage: GoReferralUsagePreviewItem
  weeklyUsage: GoReferralUsagePreviewItem
  monthlyUsage: GoReferralUsagePreviewItem
}

type GoReferralUsagePreviewItem = {
  beforePercent: number
  afterPercent: number
  resetInSec: number
}

const emptyUsagePreview = {
  rollingUsage: { beforePercent: 0, afterPercent: 0, resetInSec: 0 },
  weeklyUsage: { beforePercent: 0, afterPercent: 0, resetInSec: 0 },
  monthlyUsage: { beforePercent: 0, afterPercent: 0, resetInSec: 0 },
} satisfies GoReferralUsagePreview

export const queryGoReferral = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const summary = await Referral.summary()
    return {
      ...summary,
      inviteUrl: new URL(`/go?invite=${summary.inviteCode}`, getRequestEvent()!.request.url).toString(),
    } satisfies GoReferralSummary
  }, workspaceID)
}, "go.referral.get")

export const queryGoReferralUsagePreview = query(async (workspaceID: string, referralID?: string) => {
  "use server"
  if (!referralID) return null
  return withActor(async () => {
    const row = await Database.use((tx) =>
      tx
        .select({
          rewardAmount: ReferralRewardTable.amount,
          rollingUsage: LiteTable.rollingUsage,
          weeklyUsage: LiteTable.weeklyUsage,
          monthlyUsage: LiteTable.monthlyUsage,
          timeRollingUpdated: LiteTable.timeRollingUpdated,
          timeWeeklyUpdated: LiteTable.timeWeeklyUpdated,
          timeMonthlyUpdated: LiteTable.timeMonthlyUpdated,
          timeCreated: LiteTable.timeCreated,
        })
        .from(ReferralRewardTable)
        .innerJoin(LiteTable, eq(LiteTable.workspaceID, ReferralRewardTable.workspaceID))
        .where(
          and(
            eq(ReferralRewardTable.workspaceID, workspaceID),
            eq(ReferralRewardTable.referralID, referralID),
            isNull(ReferralRewardTable.timeApplied),
            isNull(ReferralRewardTable.timeDeleted),
            isNull(LiteTable.timeDeleted),
          ),
        )
        .then((rows) => rows[0]),
    )
    if (!row) return null

    const limits = LiteData.getLimits()
    const rollingBefore = Subscription.analyzeRollingUsage({
      limit: limits.rollingLimit,
      window: limits.rollingWindow,
      usage: row.rollingUsage ?? 0,
      timeUpdated: row.timeRollingUpdated ?? new Date(),
    })
    const rollingAfter = Subscription.analyzeRollingUsage({
      limit: limits.rollingLimit,
      window: limits.rollingWindow,
      usage: Math.max(0, (row.rollingUsage ?? 0) - row.rewardAmount),
      timeUpdated: row.timeRollingUpdated ?? new Date(),
    })
    const weeklyBefore = Subscription.analyzeWeeklyUsage({
      limit: limits.weeklyLimit,
      usage: row.weeklyUsage ?? 0,
      timeUpdated: row.timeWeeklyUpdated ?? new Date(),
    })
    const weeklyAfter = Subscription.analyzeWeeklyUsage({
      limit: limits.weeklyLimit,
      usage: Math.max(0, (row.weeklyUsage ?? 0) - row.rewardAmount),
      timeUpdated: row.timeWeeklyUpdated ?? new Date(),
    })
    const monthlyBefore = Subscription.analyzeMonthlyUsage({
      limit: limits.monthlyLimit,
      usage: row.monthlyUsage ?? 0,
      timeUpdated: row.timeMonthlyUpdated ?? new Date(),
      timeSubscribed: row.timeCreated,
    })
    const monthlyAfter = Subscription.analyzeMonthlyUsage({
      limit: limits.monthlyLimit,
      usage: Math.max(0, (row.monthlyUsage ?? 0) - row.rewardAmount),
      timeUpdated: row.timeMonthlyUpdated ?? new Date(),
      timeSubscribed: row.timeCreated,
    })

    return {
      rollingUsage: usagePreview(rollingBefore, rollingAfter),
      weeklyUsage: usagePreview(weeklyBefore, weeklyAfter),
      monthlyUsage: usagePreview(monthlyBefore, monthlyAfter),
    } satisfies GoReferralUsagePreview
  }, workspaceID)
}, "go.referral.usagePreview")

export const applyGoReferralReward = action(async (workspaceID: string, referralID: string) => {
  "use server"
  return json(
    await withActor(
      () =>
        Referral.applyReward({ referralID })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string, data: undefined })),
      workspaceID,
    ),
    { revalidate: [queryGoReferral.key, queryGoReferralUsagePreview.key, queryLiteSubscription.key] },
  )
}, "go.referral.reward.apply")

function usagePreview(before: AnalyzedUsage, after: AnalyzedUsage) {
  return {
    beforePercent: before.usagePercent,
    afterPercent: after.usagePercent,
    resetInSec: after.resetInSec,
  }
}

function currentUsagePreview(usage: AnalyzedUsage) {
  return usagePreview(usage, usage)
}

function formatCurrency(amount: number) {
  if (amount % 100 === 0) return `$${amount / 100}`
  return `$${(amount / 100).toFixed(2)}`
}

function formatDate(value: string | Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

function rewardTitleKey(reward: GoReferralReward) {
  if (reward.status === "pending" && reward.source === "invitee")
    return "workspace.referral.reward.source.pendingInvitee" as const
  if (reward.status === "pending") return "workspace.referral.reward.source.pendingInviter" as const
  if (reward.status === "applied") return "workspace.referral.reward.source.applied" as const
  return "workspace.referral.reward.source.available" as const
}

function rewardPendingStatusKey(source: GoReferralReward["source"]) {
  if (source === "invitee") return "workspace.referral.reward.status.pendingInvitee" as const
  return "workspace.referral.reward.status.pendingInviter" as const
}

function CopyInviteLink(props: { summary: GoReferralSummary }) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)

  async function copy() {
    if (typeof navigator !== "object") return
    await navigator.clipboard.writeText(props.summary.inviteUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div data-slot="invite-link-box">
      <div>
        <code title={props.summary.inviteUrl}>{props.summary.inviteUrl}</code>
        <button type="button" data-color="primary" onClick={copy}>
          <Show
            when={copied()}
            fallback={
              <>
                <IconCopy style={{ width: "16px", height: "16px" }} /> {i18n.t("workspace.referral.copyLink")}
              </>
            }
          >
            <IconCheck style={{ width: "16px", height: "16px" }} /> {i18n.t("workspace.referral.copied")}
          </Show>
        </button>
      </div>
    </div>
  )
}

export function GoReferralSection(props: { workspaceID: string; summary: GoReferralSummary }) {
  const i18n = useI18n()
  const language = useLanguage()
  const apply = useAction(applyGoReferralReward)
  const submission = useSubmission(applyGoReferralReward)
  const [selected, setSelected] = createSignal<GoReferralReward>()
  const [preview, setPreview] = createSignal<GoReferralUsagePreview | null>()
  const lite = createAsync(() => queryLiteSubscription(props.workspaceID))
  const displayPreview = createMemo(() => {
    const loaded = preview()
    if (loaded) return loaded
    const current = lite()
    if (!current) return emptyUsagePreview
    return {
      rollingUsage: currentUsagePreview(current.rollingUsage),
      weeklyUsage: currentUsagePreview(current.weeklyUsage),
      monthlyUsage: currentUsagePreview(current.monthlyUsage),
    } satisfies GoReferralUsagePreview
  })
  const appliedCount = createMemo(() => props.summary.rewards.filter((reward) => reward.timeApplied).length)
  const earnedCount = createMemo(() => props.summary.rewards.filter((reward) => reward.status !== "pending").length)

  createEffect(() => {
    const reward = selected()
    if (!reward) {
      setPreview(undefined)
      return
    }

    const request = { cancelled: false }
    setPreview(undefined)
    queryGoReferralUsagePreview(props.workspaceID, reward.id).then((result) => {
      if (request.cancelled) return
      setPreview(result)
    })
    onCleanup(() => {
      request.cancelled = true
    })
  })

  async function onApply() {
    const reward = selected()
    if (!reward) return
    const result = await apply(props.workspaceID, reward.id)
    if (result.data) setSelected(undefined)
  }

  return (
    <section data-component="go-referral-section">
      <div data-slot="section-title">
        <h2>{i18n.t("workspace.referral.overview.title")}</h2>
        <p>
          {i18n.t("workspace.referral.overview.subtitle", {
            reward: formatCurrency(props.summary.rewardAmount),
          })}
        </p>
      </div>
      <div data-component="go-referral-overview">
        <div data-slot="referral-stats">
          <div>
            <span>{i18n.t("workspace.referral.stats.invites")}</span>
            <strong>{props.summary.validInviteCount}</strong>
          </div>
          <div>
            <span>{i18n.t("workspace.referral.stats.earned")}</span>
            <strong>{formatCurrency(props.summary.totalEarned)}</strong>
          </div>
          <div>
            <span>{i18n.t("workspace.referral.stats.applied")}</span>
            <strong>{formatCurrency(props.summary.totalApplied)}</strong>
          </div>
        </div>
        <CopyInviteLink summary={props.summary} />
        <InvitationInstructions rewardAmount={props.summary.rewardAmount} />
      </div>
      <div data-slot="rewards-title">
        <h2>{i18n.t("workspace.referral.rewards.title")}</h2>
        <p>
          {i18n.t("workspace.referral.rewards.subtitle", {
            applied: appliedCount(),
            total: earnedCount(),
          })}
        </p>
      </div>
      <Show
        when={props.summary.rewards.length > 0}
        fallback={<div data-component="empty-state">{i18n.t("workspace.referral.rewards.empty")}</div>}
      >
        <div data-slot="referrals-table">
          <table data-slot="referrals-table-element">
            <thead>
              <tr>
                <th>{i18n.t("workspace.referral.table.reward")}</th>
                <th>{i18n.t("workspace.referral.table.referral")}</th>
                <th>{i18n.t("workspace.referral.table.date")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={props.summary.rewards}>
                {(reward) => {
                  const applied = createMemo(() => reward.status === "applied")
                  const pending = createMemo(() => reward.status === "pending")
                  const earnedAt = createMemo(() => formatDate(reward.timeCreated, language.tag(language.locale())))
                  return (
                    <tr data-status={reward.status} data-source={reward.source}>
                      <td data-slot="referral-amount">{formatCurrency(reward.amount)}</td>
                      <td data-slot="referral-source">
                        <span>{i18n.t(rewardTitleKey(reward))}</span>
                        <span data-slot="referral-email">{reward.email}</span>
                      </td>
                      <td data-slot="referral-date" title={earnedAt()}>
                        {earnedAt()}
                      </td>
                      <td data-slot="referral-action">
                        <button
                          type="button"
                          disabled={reward.status !== "available" || !props.summary.hasActiveGo || submission.pending}
                          onClick={() => setSelected(reward)}
                        >
                          <Show when={!applied()} fallback={i18n.t("workspace.referral.reward.status.applied")}>
                            {pending()
                              ? i18n.t(rewardPendingStatusKey(reward.source))
                              : props.summary.hasActiveGo
                                ? i18n.t("workspace.referral.apply.action")
                                : i18n.t("workspace.referral.apply.noGo")}
                          </Show>
                        </button>
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
      <Modal open={!!selected()} onClose={() => setSelected(undefined)} title={i18n.t("workspace.referral.apply.confirmTitle")}>
        <div data-component="go-credit-confirm">
          <p>
            {i18n.t("workspace.referral.apply.confirmBody", {
              amount: formatCurrency(selected()?.amount ?? 0),
            })}
          </p>
          <GoReferralUsagePreview preview={displayPreview()} />
          <div data-slot="modal-actions">
            <button type="button" onClick={() => setSelected(undefined)}>
              {i18n.t("common.cancel")}
            </button>
            <button type="button" data-color="primary" disabled={submission.pending} onClick={onApply}>
              {submission.pending ? i18n.t("workspace.lite.loading") : i18n.t("workspace.referral.apply.confirmAction")}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
}

function GoReferralUsagePreview(props: { preview: GoReferralUsagePreview }) {
  const i18n = useI18n()

  return (
    <div data-slot="usage-preview">
      <GoReferralUsagePreviewRow
        label={i18n.t("workspace.lite.subscription.rollingUsage")}
        usage={props.preview.rollingUsage}
      />
      <GoReferralUsagePreviewRow
        label={i18n.t("workspace.lite.subscription.weeklyUsage")}
        usage={props.preview.weeklyUsage}
      />
      <GoReferralUsagePreviewRow
        label={i18n.t("workspace.lite.subscription.monthlyUsage")}
        usage={props.preview.monthlyUsage}
      />
    </div>
  )
}

function GoReferralUsagePreviewRow(props: { label: string; usage: GoReferralUsagePreviewItem }) {
  const i18n = useI18n()

  return (
    <div data-slot="usage-preview-item">
      <div data-slot="usage-preview-header">
        <span data-slot="usage-preview-label">{props.label}</span>
        <span data-slot="usage-preview-value">
          <span>{props.usage.beforePercent}%</span>
          <span aria-hidden="true">-&gt;</span>
          <span data-slot="usage-preview-after-value">{props.usage.afterPercent}%</span>
        </span>
      </div>
      <div data-slot="usage-preview-progress">
        <div data-slot="usage-preview-before" style={{ width: `${props.usage.beforePercent}%` }} />
        <div data-slot="usage-preview-after" style={{ width: `${props.usage.afterPercent}%` }} />
      </div>
      <span data-slot="usage-preview-reset">
        {i18n.t("workspace.lite.subscription.resetsIn")} {formatResetTime(props.usage.resetInSec, i18n)}
      </span>
    </div>
  )
}

function InvitationInstructions(props: { rewardAmount: number }) {
  const i18n = useI18n()

  return (
    <div data-slot="instructions">
      <ol>
        <li>{i18n.t("workspace.referral.instructions.share")}</li>
        <li>{i18n.t("workspace.referral.instructions.subscribe")}</li>
        <li>{i18n.t("workspace.referral.instructions.claim")}</li>
        <li>{i18n.t("workspace.referral.instructions.apply", { amount: formatCurrency(props.rewardAmount) })}</li>
      </ol>
    </div>
  )
}
