import { Icon } from "@opencode-ai/ui/icon"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import { useClientEnv } from "@/context/client-env"
import type { DocSubmitActor, DocSubmitState } from "../prompt-input/doc-submit"
import { MatchAcceptRing } from "./match-accept-ring"
import { MoreIndicator } from "./more-indicator"
import { OutcomeAvatar } from "./outcome-avatar"
import { PendingRow } from "./pending-row"
import { useCountdown } from "./use-countdown"
import "./doc-submit.css"

type Props = {
  state: Accessor<DocSubmitState | undefined>
  actorID: string
  approve: () => void
  cancel: () => void
  close: () => void
}

function role(
  actor: DocSubmitActor,
  state: DocSubmitState,
): "requester" | "agreed" | "rejected" | "timeout" | "pending" | "left" {
  if (state.status === "cancelled" && actor.actorID === state.cancelledBy?.actorID) return "rejected"
  if (state.status === "left" && actor.actorID === state.cancelledBy?.actorID) return "left"
  if (actor.actorID === state.actorID) return "requester"
  if (actor.status === "approved") return "agreed"
  if (state.status === "expired") return "timeout"
  return "pending"
}

function IconBolt() {
  return (
    <svg class="ds-bolt" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.5 1.5 3.5 9h4l-1 5.5 6-7.5h-4z" />
    </svg>
  )
}

function VotingBody(props: {
  state: DocSubmitState
  approve: () => void
  cancel: () => void
}) {
  const remaining = useCountdown(() => props.state.expiresAt)
  const total = () => props.state.timeoutMs / 1000
  const requester = () => props.state.actors.find((item) => item.actorID === props.state.actorID)
  const pending = createMemo(() => props.state.actors.filter((item) => item.status === "pending"))
  const display = createMemo(() => {
    const left = remaining()
    return left <= 0 ? 0 : Math.ceil(left)
  })

  return (
    <>
      <div class="ds-ring-stage">
        <MatchAcceptRing remaining={remaining()} total={total()} />
        <div class="ds-ring-inner">
          <div class="ds-eyebrow">자동 거절까지 · {String(display()).padStart(2, "0")}s</div>
          <h2 class="ds-headline">이 프롬프트, 보낼까요?</h2>
          <div class="ds-sub">
            <strong>{requester()?.name ?? "참여자"}</strong>님이 전송을 요청했어요
          </div>
          <Show when={pending().length > 0}>
            <div class="ds-pending-list">
              <div class="ds-pending-label">응답 대기 · {pending().length}명</div>
              <PendingRow items={pending()} />
            </div>
          </Show>
        </div>
        <div class="ds-ring-action ds-ring-action--critical">
          <button
            type="button"
            class="ds-btn-critical"
            data-action="doc-submit-approve"
            onClick={props.approve}
          >
            <IconBolt />
            수락
          </button>
        </div>
      </div>
      <div class="ds-ring-footer">
        <button type="button" class="ds-btn-reject" data-action="doc-submit-reject" onClick={props.cancel}>
          <Icon name="close" size="small" />
          거절
        </button>
      </div>
    </>
  )
}

function WaitingBody(props: { state: DocSubmitState }) {
  const pending = createMemo(() => props.state.actors.filter((item) => item.status === "pending"))

  return (
    <>
      <div class="ds-ring-stage">
        <MatchAcceptRing full total={props.state.timeoutMs / 1000} />
        <div class="ds-ring-inner">
          <div class="ds-eyebrow ds-eyebrow--helmet">응답 전송됨</div>
          <h2 class="ds-headline ds-headline--waiting">팀원 응답을 기다리고 있어요</h2>
          <div class="ds-sub">모두 동의하면 AI에 자동으로 전송됩니다</div>
          <Show when={pending().length > 0}>
            <div class="ds-pending-list">
              <div class="ds-pending-label">응답 대기 · {pending().length}명</div>
              <PendingRow items={pending()} />
            </div>
          </Show>
        </div>
        <div class="ds-ring-action ds-ring-action--success">
          <button type="button" class="ds-btn-success-static" disabled>
            <Icon name="check" size="small" />
            수락했어요
          </button>
        </div>
      </div>
      <div class="ds-ring-footer">
        <div class="ds-ring-caption">응답 취소 불가 · 타이머 종료 대기</div>
      </div>
    </>
  )
}

function loserRole(actor: DocSubmitActor, state: DocSubmitState): "rejected" | "timeout" | "left" {
  if (state.status === "left" && actor.actorID === state.cancelledBy?.actorID) return "left"
  if (state.status === "cancelled" && actor.actorID === state.cancelledBy?.actorID) return "rejected"
  return "timeout"
}

function FailureBody(props: { state: DocSubmitState; close: () => void }) {
  const env = useClientEnv()
  const leaver = createMemo(() => (props.state.status === "left" ? props.state.cancelledBy : undefined))
  const losers = createMemo(() =>
    props.state.actors
      .filter((item) => {
        const r = role(item, props.state)
        return r === "rejected" || r === "timeout" || r === "left"
      })
      .map((item) => ({ item, role: loserRole(item, props.state) })),
  )
  const large = createMemo(() => losers().length > 4)
  const more = createMemo(() => losers().length > 5)
  const slots = createMemo(() => (more() ? losers().slice(0, 4) : losers()))
  const hidden = createMemo(() => losers().length - slots().length)
  const size = createMemo(() => (large() ? 32 : 40))

  const [auto, setAuto] = createSignal(env.submitFailureCloseSec())
  createEffect(() => {
    if (auto() <= 0) {
      props.close()
      return
    }
    const timer = setTimeout(() => setAuto((value) => value - 1), 1000)
    onCleanup(() => clearTimeout(timer))
  })

  return (
    <>
      <div class="ds-ring-stage">
        <MatchAcceptRing full palette="safety" animate={false} />
        <div class="ds-ring-inner ds-ring-inner--failure">
          <div class="ds-failure__icon">
            <Icon name="close" size="large" />
          </div>
          <h2 class="ds-headline ds-headline--failure">{leaver() ? "전송에 실패했어요" : "합의가 무산됐어요"}</h2>
          <div class="ds-sub">
            <Show
              when={leaver()}
              fallback={<>캔버스를 수정한 뒤 다시 시도하세요</>}
            >
              {(actor) => (
                <>
                  <strong>{actor().name}</strong>님이 나가서 전송하지 못했어요
                </>
              )}
            </Show>
          </div>
          <Show when={losers().length > 0}>
            <div class="ds-pending-list">
              <div class="ds-pending-row ds-pending-row--outcome" classList={{ "ds-pending-row--large": large() }}>
                <For each={slots()}>
                  {(entry) => (
                    <OutcomeAvatar name={entry.item.name} role={entry.role} compact={large()} />
                  )}
                </For>
                <Show when={more()}>
                  <MoreIndicator size={size()} hidden={hidden()} dashed={false} />
                </Show>
              </div>
            </div>
          </Show>
        </div>
        <div class="ds-ring-action ds-ring-action--critical">
          <button
            type="button"
            class="ds-btn-critical"
            data-action="doc-submit-close"
            onClick={props.close}
          >
            <Icon name="arrow-left" size="small" />
            돌아가기
            <span class="ds-btn-critical__timer">({auto()}s)</span>
          </button>
        </div>
      </div>
      <div class="ds-ring-footer ds-ring-footer--spacer" aria-hidden="true" />
    </>
  )
}

export function DialogDocSubmit(props: Props) {
  const state = () => props.state()
  const actor = () => state()?.actors.find((item) => item.actorID === props.actorID)
  const pending = () => state()?.status === "pending"
  const approved = () => actor()?.status === "approved"
  const failed = () => {
    const value = state()?.status
    return value === "cancelled" || value === "expired" || value === "left"
  }

  return (
    <div
      data-component="doc-submit-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-label={failed() ? "합의 무산" : "팀 합의 투표"}
    >
      <div data-slot="doc-submit-backdrop" />
      <div data-slot="doc-submit-body">
        <Show when={state()}>
          {(current) => (
            <Show
              when={failed()}
              fallback={
                <Show
                  when={pending() && approved()}
                  fallback={
                    <Show when={pending() && !approved()}>
                      <VotingBody state={current()} approve={props.approve} cancel={props.cancel} />
                    </Show>
                  }
                >
                  <WaitingBody state={current()} />
                </Show>
              }
            >
              <FailureBody state={current()} close={props.close} />
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}
