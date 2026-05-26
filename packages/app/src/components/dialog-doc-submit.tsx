import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { For, Show, type Accessor } from "solid-js"
import type { DocSubmitState } from "./prompt-input/doc-submit"

type Props = {
  state: Accessor<DocSubmitState | undefined>
  actorID: string
  approve: () => void
  cancel: () => void
  close: () => void
}

export function DialogDocSubmit(props: Props) {
  const actor = () => props.state()?.actors.find((item) => item.actorID === props.actorID)
  const pending = () => props.state()?.status === "pending"
  const approved = () => actor()?.status === "approved"
  const title = () => {
    const state = props.state()
    if (state?.status === "cancelled" || state?.status === "expired") return "전송 동의가 취소되었습니다"
    return "전송 동의 필요"
  }
  const description = () => {
    const state = props.state()
    if (state?.status === "cancelled") return `${state.cancelledBy?.name ?? "참여자"}의 비동의로 전송이 취소되었습니다.`
    if (state?.status === "expired") return "대기 시간이 지나 전송이 취소되었습니다."
    return "모든 참여자의 동의가 완료되면 전송됩니다."
  }

  return (
    <Dialog title={title()} description={description()} action={pending() ? <span /> : undefined} fit>
      <div class="min-w-[320px] max-w-[420px] space-y-4">
        <div class="space-y-2">
          <For each={props.state()?.actors ?? []}>
            {(item) => (
              <div class="flex items-center justify-between gap-3 rounded-md border border-border-weak-base px-3 py-2 text-sm">
                <span class="min-w-0 truncate">{item.name}</span>
                <span class={item.status === "approved" ? "text-text-strong" : "text-text-weak"}>
                  {item.status === "approved" ? "동의 완료" : "대기 중"}
                </span>
              </div>
            )}
          </For>
        </div>
        <Show
          when={pending()}
          fallback={
            <div class="flex justify-end">
              <Button variant="primary" onClick={props.close}>
                닫기
              </Button>
            </div>
          }
        >
          <div class="flex justify-end gap-2">
            <Button variant="secondary" onClick={props.cancel}>
              취소
            </Button>
            <Button variant="primary" onClick={props.approve} disabled={approved()}>
              {approved() ? "동의 완료" : "전송"}
            </Button>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
