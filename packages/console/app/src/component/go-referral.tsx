import { A, action, json, query, useAction, useSubmission } from "@solidjs/router"
import { createMemo, createSignal, For, Show } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import { Referral } from "@opencode-ai/console-core/referral.js"
import { withActor } from "~/context/auth.withActor"
import { Modal } from "~/component/modal"
import { IconCheck, IconCopy } from "~/component/icon"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import "./go-referral.css"

export type GoReferralReward = {
  id: string
  amount: number
  source: "inviter" | "invitee"
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

export const applyGoReferralReward = action(async (workspaceID: string, rewardID: string) => {
  "use server"
  return json(
    await withActor(
      () =>
        Referral.applyReward({ rewardID })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string, data: undefined })),
      workspaceID,
    ),
    { revalidate: [queryGoReferral.key] },
  )
}, "go.referral.reward.apply")

function formatCurrency(amount: number) {
  if (amount % 100 === 0) return `$${amount / 100}`
  return `$${(amount / 100).toFixed(2)}`
}

function formatDate(value: string | Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

function rewardSourceKey(source: GoReferralReward["source"]) {
  if (source === "invitee") return "workspace.referral.reward.source.invitee" as const
  return "workspace.referral.reward.source.inviter" as const
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
      <label>{i18n.t("workspace.referral.inviteLink")}</label>
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

export function GoReferralBanner(props: { href: string }) {
  const i18n = useI18n()

  return (
    <div data-component="go-referral-banner">
      <div>
        <strong>{i18n.t("workspace.referral.banner.title")}</strong>
        <p>{i18n.t("workspace.referral.banner.body")}</p>
      </div>
      <A href={props.href} data-color="primary">
        {i18n.t("workspace.referral.banner.action")}
      </A>
    </div>
  )
}

export function GoReferralOverview(props: { summary: GoReferralSummary }) {
  const i18n = useI18n()

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
      <div data-slot="referral-stats">
        <div>
          <span>{i18n.t("workspace.referral.stats.validInvites")}</span>
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
      <InvitationInstructions rewardAmount={props.summary.rewardAmount} />
      <CopyInviteLink summary={props.summary} />
    </section>
  )
}

export function GoReferralRewards(props: { workspaceID: string; summary: GoReferralSummary }) {
  const i18n = useI18n()
  const language = useLanguage()
  const apply = useAction(applyGoReferralReward)
  const submission = useSubmission(applyGoReferralReward)
  const [selected, setSelected] = createSignal<GoReferralReward>()
  const appliedCount = createMemo(() => props.summary.rewards.filter((reward) => reward.timeApplied).length)

  async function onApply() {
    const reward = selected()
    if (!reward) return
    const result = await apply(props.workspaceID, reward.id)
    if (result.data) setSelected(undefined)
  }

  return (
    <section data-component="go-referral-section">
      <div data-slot="section-title">
        <h2>{i18n.t("workspace.referral.rewards.title")}</h2>
        <p>
          {i18n.t("workspace.referral.rewards.subtitle", {
            applied: appliedCount(),
            total: props.summary.rewards.length,
          })}
        </p>
      </div>
      <Show
        when={props.summary.rewards.length > 0}
        fallback={<div data-component="empty-state">{i18n.t("workspace.referral.rewards.empty")}</div>}
      >
        <div data-slot="reward-list">
          <For each={props.summary.rewards}>
            {(reward) => {
              const applied = createMemo(() => !!reward.timeApplied)
              return (
                <div data-slot="reward-row" data-status={applied() ? "applied" : "available"}>
                  <div data-slot="reward-main">
                    <strong>{formatCurrency(reward.amount)}</strong>
                    <span>{i18n.t(rewardSourceKey(reward.source))}</span>
                  </div>
                  <div data-slot="reward-meta">
                    <span>
                      {applied()
                        ? i18n.t("workspace.referral.reward.status.applied")
                        : i18n.t("workspace.referral.reward.status.available")}
                    </span>
                    <span>
                      {applied() && reward.timeApplied
                        ? i18n.t("workspace.referral.reward.appliedOn", {
                            date: formatDate(reward.timeApplied, language.tag(language.locale())),
                          })
                        : i18n.t("workspace.referral.reward.earnedOn", {
                            date: formatDate(reward.timeCreated, language.tag(language.locale())),
                          })}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={applied() || !props.summary.hasActiveGo || submission.pending}
                    onClick={() => setSelected(reward)}
                  >
                    <Show
                      when={!applied()}
                      fallback={i18n.t("workspace.referral.reward.status.applied")}
                    >
                      {props.summary.hasActiveGo
                        ? i18n.t("workspace.referral.apply.action")
                        : i18n.t("workspace.referral.apply.noGo")}
                    </Show>
                  </button>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
      <Modal open={!!selected()} onClose={() => setSelected(undefined)} title={i18n.t("workspace.referral.apply.confirmTitle")}>
        <div data-component="go-credit-confirm">
          <p>
            {i18n.t("workspace.referral.apply.confirmBody", {
              amount: formatCurrency(selected()?.amount ?? 0),
            })}
          </p>
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

export function InvitationInstructions(props: { rewardAmount: number }) {
  const i18n = useI18n()

  return (
    <div data-slot="instructions">
      <strong>{i18n.t("workspace.referral.instructions.title")}</strong>
      <ol>
        <li>{i18n.t("workspace.referral.instructions.share")}</li>
        <li>{i18n.t("workspace.referral.instructions.subscribe")}</li>
        <li>{i18n.t("workspace.referral.instructions.apply", { amount: formatCurrency(props.rewardAmount) })}</li>
      </ol>
    </div>
  )
}
