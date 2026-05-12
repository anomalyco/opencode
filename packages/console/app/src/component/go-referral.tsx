import { A, action, json, query, useAction, useSubmission } from "@solidjs/router"
import { createMemo, createSignal, For, Show } from "solid-js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { withActor } from "~/context/auth.withActor"
import { config } from "~/config"
import { Modal } from "~/component/modal"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import "./go-referral.css"

type CreditStatus = "pending" | "available" | "used" | "expired" | "revoked"

export type GoReferralCredit = {
  id: string
  amount: number
  remaining: number
  status: CreditStatus
  source: "referral" | "invitee"
  issuedAt: string
  availableAt: string
  expiresAt: string
  usedAt?: string
}

export type GoReferralMilestone = {
  inviteCount: number
  amount: number
  status: "unlocked" | "locked"
}

export type GoReferralSummary = {
  inviteCode: string
  inviteUrl: string
  validInviteCount: number
  maxInviteCount: number
  nextInviteCount?: number
  nextReward?: number
  invitedUserReward: number
  maxReward: number
  creditAvailable: number
  creditPending: number
  creditUsed: number
  workspaceMonthlyUsage: number
  milestones: GoReferralMilestone[]
  credits: GoReferralCredit[]
}

export const queryGoReferral = query(async (workspaceID: string) => {
  "use server"
  return withActor(() => {
    const account = Actor.account()
    const code = account.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const credits: GoReferralCredit[] = [
      {
        id: "demo-referral-1",
        amount: 1000,
        remaining: 1000,
        status: "available",
        source: "referral",
        issuedAt: new Date(now - 8 * day).toISOString(),
        availableAt: new Date(now - 7 * day).toISOString(),
        expiresAt: new Date(now + 82 * day).toISOString(),
      },
      {
        id: "demo-invitee-1",
        amount: 1000,
        remaining: 1000,
        status: "pending",
        source: "invitee",
        issuedAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
        availableAt: new Date(now + 18 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(now + 90 * day).toISOString(),
      },
      {
        id: "demo-referral-used",
        amount: 500,
        remaining: 0,
        status: "used",
        source: "referral",
        issuedAt: new Date(now - 30 * day).toISOString(),
        availableAt: new Date(now - 29 * day).toISOString(),
        expiresAt: new Date(now + 60 * day).toISOString(),
        usedAt: new Date(now - 3 * day).toISOString(),
      },
    ]

    return {
      inviteCode: code,
      inviteUrl: `${config.baseUrl}/go?invite=${code}`,
      validInviteCount: 2,
      maxInviteCount: 5,
      nextInviteCount: 3,
      nextReward: 2000,
      invitedUserReward: 1000,
      maxReward: 6000,
      creditAvailable: credits
        .filter((credit) => credit.status === "available")
        .reduce((total, credit) => total + credit.remaining, 0),
      creditPending: credits
        .filter((credit) => credit.status === "pending")
        .reduce((total, credit) => total + credit.remaining, 0),
      creditUsed: credits.filter((credit) => credit.status === "used").reduce((total, credit) => total + credit.amount, 0),
      workspaceMonthlyUsage: 1240,
      milestones: [
        { inviteCount: 1, amount: 1000, status: "unlocked" },
        { inviteCount: 3, amount: 2000, status: "locked" },
        { inviteCount: 5, amount: 3000, status: "locked" },
      ],
      credits,
    } satisfies GoReferralSummary
  }, workspaceID)
}, "go.referral.get")

export const applyGoReferralCredit = action(async (workspaceID: string, amount: number, creditID?: string) => {
  "use server"
  return json(
    await withActor(
      () => ({
        error: undefined,
        data: { amount, creditID },
      }),
      workspaceID,
    ),
    { revalidate: [queryGoReferral.key] },
  )
}, "go.referral.credit.apply")

function formatCurrency(amount: number) {
  if (amount % 100 === 0) return `$${amount / 100}`
  return `$${(amount / 100).toFixed(2)}`
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

function creditStatusKey(status: CreditStatus) {
  if (status === "pending") return "workspace.referral.credit.status.pending" as const
  if (status === "available") return "workspace.referral.credit.status.available" as const
  if (status === "used") return "workspace.referral.credit.status.used" as const
  if (status === "expired") return "workspace.referral.credit.status.expired" as const
  return "workspace.referral.credit.status.revoked" as const
}

function creditSourceKey(source: GoReferralCredit["source"]) {
  if (source === "invitee") return "workspace.referral.credit.source.invitee" as const
  return "workspace.referral.credit.source.referral" as const
}

function milestoneLabel(inviteCount: number, i18n: ReturnType<typeof useI18n>) {
  if (inviteCount === 1) return i18n.t("workspace.referral.milestone.one")
  if (inviteCount === 3) return i18n.t("workspace.referral.milestone.three")
  return i18n.t("workspace.referral.milestone.five")
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
        <code>{props.summary.inviteUrl}</code>
        <button type="button" data-color="primary" onClick={copy}>
          {copied() ? i18n.t("workspace.referral.copied") : i18n.t("workspace.referral.copyLink")}
        </button>
      </div>
    </div>
  )
}

function ReferralProgress(props: { summary: GoReferralSummary }) {
  const i18n = useI18n()
  const progress = createMemo(() => Math.min(100, (props.summary.validInviteCount / props.summary.maxInviteCount) * 100))

  return (
    <div data-slot="referral-progress">
      <div data-slot="progress-header">
        <strong>{i18n.t("workspace.referral.progress.title")}</strong>
        <span>
          {i18n.t("workspace.referral.progress.value", {
            count: props.summary.validInviteCount,
            total: props.summary.maxInviteCount,
          })}
        </span>
      </div>
      <div data-slot="progress-track">
        <div data-slot="progress-fill" style={{ width: `${progress()}%` }} />
      </div>
      <div data-slot="milestones">
        <For each={props.summary.milestones}>
          {(milestone) => (
            <div data-slot="milestone" data-status={milestone.status}>
              <span>{milestoneLabel(milestone.inviteCount, i18n)}</span>
              <strong>{formatCurrency(milestone.amount)}</strong>
            </div>
          )}
        </For>
      </div>
      <p data-slot="next-reward">
        <Show
          when={props.summary.nextInviteCount && props.summary.nextReward}
          fallback={i18n.t("workspace.referral.progress.complete")}
        >
          {i18n.t("workspace.referral.progress.next", {
            count: Math.max(0, props.summary.nextInviteCount! - props.summary.validInviteCount),
            amount: formatCurrency(props.summary.nextReward!),
          })}
        </Show>
      </p>
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

export function GoCreditApplyCard(props: { workspaceID: string; summary?: GoReferralSummary }) {
  const i18n = useI18n()
  const apply = useAction(applyGoReferralCredit)
  const submission = useSubmission(applyGoReferralCredit)
  const [confirming, setConfirming] = createSignal(false)
  const [applied, setApplied] = createSignal(0)
  const available = createMemo(() => Math.max(0, (props.summary?.creditAvailable ?? 0) - applied()))
  const applyAmount = createMemo(() => Math.min(available(), props.summary?.workspaceMonthlyUsage ?? 0))

  async function onApply() {
    const amount = applyAmount()
    if (!amount) return
    const result = await apply(props.workspaceID, amount)
    if (result.data) {
      setApplied((value) => value + amount)
      setConfirming(false)
    }
  }

  return (
    <div data-component="go-credit-apply-card">
      <div>
        <strong>
          {i18n.t("workspace.referral.apply.title", { amount: formatCurrency(available()) })}
        </strong>
        <p>
          <Show when={applyAmount() > 0} fallback={i18n.t("workspace.referral.apply.noUsage")}>
            {i18n.t("workspace.referral.apply.body")}
          </Show>
        </p>
      </div>
      <button type="button" disabled={!applyAmount()} onClick={() => setConfirming(true)}>
        {i18n.t("workspace.referral.apply.action")}
      </button>
      <Modal open={confirming()} onClose={() => setConfirming(false)} title={i18n.t("workspace.referral.apply.confirmTitle")}>
        <div data-component="go-credit-confirm">
          <p>
            {i18n.t("workspace.referral.apply.confirmBody", {
              amount: formatCurrency(applyAmount()),
              usage: formatCurrency(props.summary?.workspaceMonthlyUsage ?? 0),
              usageAfter: formatCurrency(Math.max(0, (props.summary?.workspaceMonthlyUsage ?? 0) - applyAmount())),
            })}
          </p>
          <div data-slot="modal-actions">
            <button type="button" onClick={() => setConfirming(false)}>
              {i18n.t("common.cancel")}
            </button>
            <button type="button" data-color="primary" disabled={submission.pending} onClick={onApply}>
              {submission.pending ? i18n.t("workspace.lite.loading") : i18n.t("workspace.referral.apply.confirmAction")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export function GoReferralCredits(props: { workspaceID: string; summary: GoReferralSummary }) {
  const i18n = useI18n()
  const language = useLanguage()
  const apply = useAction(applyGoReferralCredit)
  const submission = useSubmission(applyGoReferralCredit)
  const [selected, setSelected] = createSignal<GoReferralCredit>()
  const [appliedCredits, setAppliedCredits] = createSignal<Record<string, number>>({})

  const creditRemaining = (credit: GoReferralCredit) => Math.max(0, credit.remaining - (appliedCredits()[credit.id] ?? 0))
  const selectedAmount = createMemo(() => {
    const credit = selected()
    if (!credit) return 0
    return Math.min(creditRemaining(credit), props.summary.workspaceMonthlyUsage)
  })

  async function onApply() {
    const credit = selected()
    const amount = selectedAmount()
    if (!credit || !amount) return
    const result = await apply(props.workspaceID, amount, credit.id)
    if (result.data) {
      setAppliedCredits((value) => ({ ...value, [credit.id]: (value[credit.id] ?? 0) + amount }))
      setSelected(undefined)
    }
  }

  return (
    <section data-component="go-referral-section">
      <div data-slot="section-title">
        <h2>{i18n.t("workspace.referral.credits.title")}</h2>
        <p>{i18n.t("workspace.referral.credits.subtitle")}</p>
      </div>
      <div data-slot="credit-list">
        <For each={props.summary.credits}>
          {(credit) => (
            <div data-slot="credit-row" data-status={credit.status}>
              <div data-slot="credit-main">
                <strong>{formatCurrency(creditRemaining(credit) || credit.amount)}</strong>
                <span>{i18n.t(creditSourceKey(credit.source))}</span>
              </div>
              <div data-slot="credit-meta">
                <span>{i18n.t(creditStatusKey(credit.status))}</span>
                <span>
                  {credit.status === "pending"
                    ? i18n.t("workspace.referral.credit.availableOn", {
                        date: formatDate(credit.availableAt, language.tag(language.locale())),
                      })
                    : i18n.t("workspace.referral.credit.expiresOn", {
                        date: formatDate(credit.expiresAt, language.tag(language.locale())),
                      })}
                </span>
              </div>
              <button
                type="button"
                disabled={credit.status !== "available" || creditRemaining(credit) <= 0 || props.summary.workspaceMonthlyUsage <= 0}
                onClick={() => setSelected(credit)}
              >
                {i18n.t("workspace.referral.apply.action")}
              </button>
            </div>
          )}
        </For>
      </div>
      <Modal open={!!selected()} onClose={() => setSelected(undefined)} title={i18n.t("workspace.referral.apply.confirmTitle")}>
        <div data-component="go-credit-confirm">
          <p>
            <Show when={selectedAmount() > 0} fallback={i18n.t("workspace.referral.apply.noUsage")}>
              {i18n.t("workspace.referral.apply.confirmBody", {
                amount: formatCurrency(selectedAmount()),
                usage: formatCurrency(props.summary.workspaceMonthlyUsage),
                usageAfter: formatCurrency(Math.max(0, props.summary.workspaceMonthlyUsage - selectedAmount())),
              })}
            </Show>
          </p>
          <div data-slot="modal-actions">
            <button type="button" onClick={() => setSelected(undefined)}>
              {i18n.t("common.cancel")}
            </button>
            <button type="button" data-color="primary" disabled={submission.pending || !selectedAmount()} onClick={onApply}>
              {submission.pending ? i18n.t("workspace.lite.loading") : i18n.t("workspace.referral.apply.confirmAction")}
            </button>
          </div>
        </div>
      </Modal>
    </section>
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
            max: formatCurrency(props.summary.maxReward),
            reward: formatCurrency(props.summary.invitedUserReward),
          })}
        </p>
      </div>
      <InvitationInstructions />
      <CopyInviteLink summary={props.summary} />
      <ReferralProgress summary={props.summary} />
    </section>
  )
}

export function InvitationInstructions() {
  const i18n = useI18n()

  return (
    <div data-slot="instructions">
      <strong>{i18n.t("workspace.referral.instructions.title")}</strong>
      <ol>
        <li>{i18n.t("workspace.referral.instructions.share")}</li>
        <li>{i18n.t("workspace.referral.instructions.subscribe")}</li>
        <li>{i18n.t("workspace.referral.instructions.unlock")}</li>
      </ol>
    </div>
  )
}
