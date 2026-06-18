import { Button } from "@opencode-ai/ui/button"
import { Keybind } from "@opencode-ai/ui/keybind"
import { createMemo, Show } from "solid-js"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

export interface FileSearchButtonProps {
  /** placeholder 치환용 프로젝트 이름. 없으면 "파일 검색" 라벨을 쓴다. */
  projectName?: string
  /** 단축키 배지 노출 여부. (기본: true) */
  showKeybind?: boolean
  /** 클릭 동작 재정의. 미지정 시 `file.open` 커맨드(전체 검색 모달)를 연다. */
  onClick?: () => void
  class?: string
}

/**
 * 겉모습은 input 이지만 클릭하면 파일 검색 모달(`DialogSelectFile`)을 여는 버튼.
 * 타이틀바(`SessionHeader`)와 운영 레이아웃의 파일 탐색기 상단에서 공유한다.
 */
export function FileSearchButton(props: FileSearchButtonProps) {
  const command = useCommand()
  const language = useLanguage()
  const hotkey = createMemo(() => command.keybind("file.open"))
  const showKeybind = () => props.showKeybind !== false

  return (
    <Button
      type="button"
      variant="ghost"
      size="small"
      class={`items-center gap-2 justify-between rounded-md border border-border-weak-base bg-surface-panel shadow-none cursor-default ${props.class ?? "flex w-full max-w-full min-w-0"}`}
      onClick={() => (props.onClick ? props.onClick() : command.trigger("file.open"))}
      aria-label={language.t("session.header.searchFiles")}
    >
      <div class="flex min-w-0 flex-1 items-center overflow-visible">
        <span class="flex-1 min-w-0 text-12-regular text-text-weak truncate text-left">
          {props.projectName
            ? language.t("session.header.search.placeholder", { project: props.projectName })
            : language.t("session.header.searchFiles")}
        </span>
      </div>

      <Show when={showKeybind() && hotkey()}>
        {(keybind) => (
          <Keybind class="shrink-0 !border-0 !bg-transparent !shadow-none px-0 text-text-weaker">{keybind()}</Keybind>
        )}
      </Show>
    </Button>
  )
}
