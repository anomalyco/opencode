import { Show } from "solid-js"
import { PromptInput, type PromptInputProps } from "./prompt-input"
import { PromptProjectSelector, type PromptProjectController } from "./prompt-project-selector"

export function NewSessionComposer(props: {
  input: () => Omit<PromptInputProps, "toolbar" | "variant">
  project: PromptProjectController
}) {
  return (
    <div class="flex flex-col gap-3">
      <PromptInput
        {...props.input()}
        variant="new-session"
        toolbar={
          <Show when={!props.project.selected()}>
            <PromptProjectSelector controller={props.project} empty />
          </Show>
        }
      />
      <Show when={props.project.selected()}>
        <div class="flex h-7 min-w-0 items-center gap-0 px-2">
          <PromptProjectSelector controller={props.project} />
        </div>
      </Show>
    </div>
  )
}
