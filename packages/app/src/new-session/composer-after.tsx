import { Show, createSignal, onMount } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import type { NewSessionComposer, SlotMap } from "@opencode/plugin/gui"
import { createComposerEditorActions } from "@/composer/editor/actions"
import type { ComposerModel } from "@/composer/model"
import { useComposerState } from "@/composer/persistence"
import { usePluginAttachment } from "@/runtime/plugin/host-apis"
import { PluginSlot } from "@/runtime/plugin/render"
import { useServer } from "@/runtime/server/current"
import type { NewSessionWorkspaceController } from "./workspace/controller"

// Room the slot leaves at the bottom of the panel, for the tip pinned there.
const BOTTOM_INSET = 56

/** Plugin content below the new session composer, for the draft the screen shows. */
export function NewSessionComposerAfter(props: { composer: ComposerModel; workspace: NewSessionWorkspaceController }) {
  const server = useServer()
  const attachment = usePluginAttachment()
  // The draft's own prompt: the screen suspends until it loads, so writes never replace a stored draft.
  const draft = useComposerState().capture()
  const edit = () => createComposerEditorActions(draft.store)

  const composer: NewSessionComposer = {
    text: () =>
      draft
        .current()
        .map((part) => ("content" in part ? part.content : ""))
        .join(""),
    insert(text) {
      const value = text.replace(/\r\n?/g, "\n")

      if (value) edit().addText(value)
    },
    setText: (text) => edit().setText(text.replace(/\r\n?/g, "\n")),
    focus: () => props.composer.restoreFocus(),
  }

  return (
    <Show when={attachment.server(server.key)}>
      {(ref) => (
        <NewSessionComposerSlot
          input={{
            get server() {
              return ref()
            },
            get project() {
              return server.ctx.projects.forDirectory(props.workspace.project.root())
            },
            get directory() {
              const worktree = props.workspace.selection.value()

              if (worktree === "create") return

              return worktree === "main" ? props.workspace.project.root() : worktree
            },
            composer,
          }}
        />
      )}
    </Show>
  )
}

/**
 * The `new-session.composer.after` slot in the new session panel's content column. It takes no room while nothing
 * renders, and scrolls once it reaches the bottom of the panel, so the composer above it never moves.
 */
export function NewSessionComposerSlot(props: { input: SlotMap["new-session.composer.after"] }) {
  const [height, setHeight] = createSignal<number>()
  let area!: HTMLDivElement

  onMount(() => {
    const panel = area.closest<HTMLElement>('[data-component="new-session"]')

    if (!panel || !area.parentElement) return

    // The composer growing moves the area down, and the panel resizing moves its bottom.
    createResizeObserver([panel, area.parentElement], () =>
      setHeight(
        Math.max(0, Math.floor(panel.getBoundingClientRect().bottom - area.getBoundingClientRect().top - BOTTOM_INSET)),
      ),
    )
  })

  return (
    <div
      ref={area}
      data-slot="new-session-composer-after"
      data-scrollable
      class="flex min-h-0 flex-col gap-3 overflow-y-auto empty:hidden *:shrink-0"
      style={{ "max-height": height() === undefined ? undefined : `${height()}px` }}
    >
      <PluginSlot at="new-session.composer.after" input={props.input} />
    </div>
  )
}
