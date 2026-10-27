import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
  lazy,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createMediaQuery } from "@solid-primitives/media"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { ProviderModelIcon } from "@/providers/models/provider-group"
import { useI18n } from "@opencode/ui/context/i18n"
import { Button } from "@opencode/ui/button"
import { Keybind } from "@opencode/ui/keybind"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { AttachmentCard } from "@opencode/session-ui/attachment-card"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import type { Upload } from "../attachments/uploads"
import { CommentCard, commentCardTarget, quoteTooltip } from "@opencode/session-ui/comment-card"
import { typeLabel } from "@opencode/session-ui/message-file"
import { getFilename } from "@opencode/util/path"
import { Skill } from "@opencode/schema/skill"
import type {
  ComposerAgentPart,
  ComposerAttachment,
  ComposerComment,
  ComposerFilePart,
  ComposerOption,
  ComposerPrompt,
  ComposerSkillPart,
  ComposerSuggestion,
} from "../types"
import type { ComposerEditorModel, ComposerSelectControl } from "./interaction"
import { isAttachment } from "../prompt-parts"
import { QuoteCommentEditor } from "./quote-comment"
import { formatKeybindParts } from "@/shell/commands/command"
import "../attachments/attachments.css"
import "./editor.css"
import "@/shell/palette-menu.css"

const MobilePanelDrawer = lazy(async () => {
  const { MobilePanelDrawer } = await import("@/shell/mobile-panel-drawer")

  return { default: MobilePanelDrawer }
})

type ComposerMode = "normal" | "shell"

const COMPOSER_SUGGESTION_MAX_HEIGHT = 320

const COMPOSER_SUGGESTION_ROW_HEIGHT = 28

const COMPOSER_SUGGESTION_ROW_PEEK = 18

const COMPOSER_SUGGESTION_TOP_PADDING = 6

const COMPOSER_SUGGESTION_SEARCH_HEIGHT = 28

const COMPOSER_SUGGESTION_CONTEXT_RESERVE = 80

export type ComposerEditorProps = {
  controller: ComposerEditorModel
  disabled?: boolean
  readOnly?: boolean
  borderUnderlay?: boolean
  class?: string
  modelControl?: JSX.Element
  modelControlsVisible?: boolean
  attachKeybind?: string[]
  attachShortcut?: string
  alternateKeybind?: string[]
  exitShellKeybind?: string[]
  suggestionBoundary?: () => HTMLElement | undefined
}

export function ComposerEditor(props: ComposerEditorProps) {
  const i18n = useI18n()
  const state = props.controller.state
  const view = props.controller.view
  const suggestionsID = createUniqueId()
  let composer: HTMLFormElement | undefined
  let content: HTMLDivElement | undefined
  let editor: HTMLDivElement | undefined
  let viewport: HTMLDivElement | undefined
  let controlsViewport!: HTMLDivElement
  let controlsContent!: HTMLDivElement
  const [overflow, setOverflow] = createStore({ start: false, end: false })
  const [historyLayout, setHistoryLayout] = createStore<{ height?: number }>({})

  createEffect(() => {
    if (state.popover.type !== "history") setHistoryLayout("height", undefined)
  })

  createEffect(() => {
    const preview = historyLayout.height !== undefined

    if (preview) props.controller.parts()

    // Show the beginning of each prompt; attachments remain accessible above it in the same viewport.
    const frame = requestAnimationFrame(() => {
      if (preview && content && editor)
        content.scrollTop += editor.getBoundingClientRect().top - content.getBoundingClientRect().top

      updateScroll()
    })

    onCleanup(() => cancelAnimationFrame(frame))
  })

  const updateOverflow = () => {
    const offset = Math.abs(controlsViewport.scrollLeft)
    setOverflow({
      start: offset > 1,
      end: controlsViewport.scrollWidth - controlsViewport.clientWidth - offset > 1,
    })
  }

  // The bottom fade shrinks with the remaining scroll so the last line ends clear of it.
  const [fadeBottom, setFadeBottom] = createSignal(0)

  const updateScroll = () => {
    const scroller = historyLayout.height !== undefined ? content : viewport

    if (!scroller) return
    setFadeBottom(Math.min(16, Math.max(0, scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop)))
  }

  onMount(() => {
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(controlsViewport)
    observer.observe(controlsContent)
    updateOverflow()
    // Typing and width changes both resize the editor, so it is the only element that needs watching.
    const scrollObserver = new ResizeObserver(updateScroll)

    if (editor) scrollObserver.observe(editor)
    onCleanup(() => {
      observer.disconnect()
      scrollObserver.disconnect()
    })
  })
  let localInput = false

  const updateCursor = () => {
    if (!editor || !window.getSelection()?.isCollapsed) return
    props.controller.onCursor(composerCursor(editor))
  }

  const mode = createMemo(() => state.mode)

  const buttons = createMemo(() => ({
    opacity: mode() === "normal" ? 1 : 0,
    "pointer-events": mode() === "normal" ? ("auto" as const) : ("none" as const),
    transition: "opacity 200ms ease",
  }))

  createEffect(() => {
    const parts = props.controller.parts()

    if (!editor) return

    if (localInput) {
      localInput = false

      return
    }

    renderComposerEditor(editor, parts)
  })

  // Kept out of JSX: an inline ternary prop compiles to a memo created on every read, and the popover reads
  // search from a ResizeObserver callback, where that memo has no owner and is never disposed.
  const search = () => {
    if (state.popover.type !== "history" && state.popover.type !== "command-menu") return

    if (state.popover.type === "history" && !state.popover.searching) return

    return {
      value: state.popover.query,
      label: i18n.t(state.popover.type === "history" ? "ui.promptInput.history" : "ui.promptInput.commands"),
      placeholder: state.popover.type === "history" ? i18n.t("ui.promptInput.history.search") : "/",
      onValueChange: props.controller.setQuery,
      onKeyDown: props.controller.onKeyDown,
    }
  }

  return (
    <div class={`relative size-full flex flex-col gap-0 ${props.class ?? ""}`}>
      <input
        ref={props.controller.setFileInput}
        type="file"
        multiple
        class="hidden"
        onChange={(event) => {
          const list = event.currentTarget.files

          if (list) props.controller.addAttachments(Array.from(list))
          event.currentTarget.value = ""
        }}
      />
      <Show when={!view.draftOnly && state.popover.type !== "closed"}>
        <ComposerEditorPopover
          id={suggestionsID}
          emptyLabel={i18n.t("ui.promptInput.noMatchingItems")}
          items={props.controller.suggestions()}
          boundary={props.suggestionBoundary}
          activeID={state.popover.type === "closed" ? undefined : state.popover.activeID}
          search={search()}
          history={state.popover.type === "history" ? state.mode : undefined}
          historyBrowsing={state.popover.type === "history" && !state.popover.searching}
          editor={() => editor}
          onSearch={() => props.controller.dispatch({ type: "history.search" })}
          onClose={() => props.controller.dispatch({ type: "popover.close" })}
          onActiveChange={(item) => props.controller.dispatch({ type: "popover.active", id: item.id })}
          onSelect={(item) => props.controller.dispatch({ type: "popover.select", item })}
        />
      </Show>
      <form
        ref={composer}
        data-component="composer"
        data-dock-border-underlay={props.borderUnderlay ? "true" : undefined}
        class="group/composer relative w-full overflow-clip rounded-xl bg-v2-background-bg-base"
        style={{ height: historyLayout.height === undefined ? undefined : `${historyLayout.height}px` }}
        classList={{
          "shadow-[var(--v2-elevation-raised)]": !props.borderUnderlay,
          "flex flex-col": historyLayout.height !== undefined,
        }}
        onSubmit={(event) => {
          event.preventDefault()

          if (!props.disabled) props.controller.submit()
        }}
        onDragEnter={props.controller.onDragEnter}
        onDragOver={props.controller.onDragOver}
        onDragLeave={props.controller.onDragLeave}
        onDrop={props.controller.onDrop}
      >
        <div
          ref={content}
          data-slot="composer-content"
          data-history-preview={historyLayout.height !== undefined ? "" : undefined}
          class="min-h-0"
          classList={{ "flex-1 overflow-y-auto no-scrollbar": historyLayout.height !== undefined }}
          style={{ "--composer-fade-bottom": `${fadeBottom()}px` }}
          onScroll={updateScroll}
        >
          <Show when={state.mode === "normal"}>
            <ComposerAttachments
              attachments={props.controller.attachments()}
              uploads={props.controller.uploads()}
              comments={props.controller.comments()}
              files={props.controller.files()}
              activeCommentID={state.activeContextID}
              removeLabel={i18n.t("ui.promptInput.removeAttachment")}
              onAttachmentClick={props.controller.openAttachment}
              preview={props.controller.previewAttachment}
              onAttachmentRemove={(attachment) => props.controller.removeAttachment(attachment.id)}
              onUploadCancel={(upload) => props.controller.cancelUpload(upload.id)}
              onCommentClick={(comment) => props.controller.toggleContext(comment.key)}
              onCommentRemove={(comment) => props.controller.removeContext(comment.key)}
              onFileRemove={(file) => props.controller.removeContext(file.key)}
              editingQuote={props.controller.editingQuote()}
              onEditQuote={props.controller.editQuote}
              quoteSource={props.controller.quoteSource}
              onQuoteComment={(quote, comment) => props.controller.commentQuote(quote.key, comment)}
              searchPaths={props.controller.searchPaths}
            />
          </Show>

          <div
            data-component="composer-scroll"
            data-scrollable
            class="relative overflow-y-auto"
            classList={{ "max-h-[180px]": historyLayout.height === undefined }}
            onScroll={updateScroll}
            ref={viewport}
          >
            <div
              ref={(element) => {
                editor = element
                props.controller.setEditor(element)
              }}
              data-component="composer-editor"
              role="textbox"
              aria-multiline="true"
              aria-label={i18n.t("ui.promptInput.label")}
              aria-controls={state.popover.type === "history" ? suggestionsID : undefined}
              aria-activedescendant={
                state.popover.type === "history" && !state.popover.searching && state.popover.activeID
                  ? `${suggestionsID}-${state.popover.activeID}`
                  : undefined
              }
              dir={state.mode === "normal" ? "auto" : "ltr"}
              contenteditable={!props.disabled && !props.readOnly}
              autocapitalize={state.mode === "normal" ? "sentences" : "off"}
              autocorrect={state.mode === "normal" ? "on" : "off"}
              spellcheck={state.mode === "normal"}
              // @ts-expect-error
              autocomplete="off"
              class="relative z-10 block w-full whitespace-pre-wrap bg-transparent ps-4 pe-[var(--composer-scroll-end)] pt-4 pb-2 text-[13px] font-[440] leading-5 text-v2-text-text-base focus:outline-none [&_[data-mention=file]]:text-syntax-property [&_[data-mention=agent]]:text-syntax-type [&_[data-mention=reference]]:text-syntax-keyword"
              classList={{ "font-mono! tracking-[-0.04px]": state.mode === "shell", "opacity-50": props.disabled }}
              style={{
                "unicode-bidi": state.mode === "normal" ? "plaintext" : undefined,
                "text-align": "start",
              }}
              onInput={(event) => {
                const cursor = composerCursor(event.currentTarget)
                const prompt = parseComposerEditor(event.currentTarget)
                const attachments = props.controller.parts().filter(isAttachment)
                localInput = true
                props.controller.onInput(
                  prompt.map((part) => part.content).join(""),
                  [...prompt, ...attachments],
                  cursor,
                )
              }}
              onKeyDown={(event) => {
                // Capture the opening footprint before the controller applies its first history preview.
                const height =
                  state.popover.type === "closed" && event.shiftKey && event.key === "ArrowUp"
                    ? composer?.getBoundingClientRect().height
                    : undefined

                if (!view.draftOnly && props.controller.onKeyDown(event)) {
                  if (height !== undefined && state.popover.type === "history") setHistoryLayout("height", height)

                  return
                }

                const mod = event.metaKey || event.ctrlKey

                if (mod && event.key === "ArrowUp" && !event.shiftKey && !event.altKey) {
                  if (view.submit.queue?.editFirst()) event.preventDefault()

                  return
                }

                if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                  event.preventDefault()

                  if (event.repeat) return
                  props.controller.submit(mod ? { alternate: true } : undefined)
                }
              }}
              onKeyUp={updateCursor}
              onPointerUp={updateCursor}
              onPaste={(event) => {
                props.controller.onPaste(event)
                // Programmatic multiline insertion does not reliably reveal the caret.
                requestAnimationFrame(() => {
                  const selection = window.getSelection()

                  if (!editor || !viewport || !selection?.isCollapsed || !selection.rangeCount) return

                  if (!editor.contains(selection.anchorNode)) return
                  const caret = selection.getRangeAt(0).getBoundingClientRect()

                  if (!caret.height) return
                  const bounds = viewport.getBoundingClientRect()

                  // Matches the viewport's 16px scroll-padding, which keeps the caret clear of the fades.
                  if (caret.bottom > bounds.bottom - 16) viewport.scrollTop += caret.bottom - bounds.bottom + 16

                  if (caret.top < bounds.top + 16) viewport.scrollTop += caret.top - bounds.top - 16
                })
              }}
              onFocus={() => props.controller.dispatch({ type: "focus.editor" })}
            />
            <Show when={!props.controller.value()}>
              <div
                dir={state.mode === "normal" ? "auto" : "ltr"}
                class="pointer-events-none absolute inset-x-0 top-0 ps-4 pe-[var(--composer-scroll-end)] pt-4 text-[13px] font-[440] leading-5 text-v2-text-text-faint"
                classList={{ "font-mono! tracking-[-0.04px]": state.mode === "shell" }}
                style={{ "unicode-bidi": state.mode === "normal" ? "plaintext" : undefined, "text-align": "start" }}
              >
                {view.placeholder?.() ??
                  (state.mode === "shell"
                    ? i18n.t("ui.promptInput.placeholder.shell")
                    : i18n.t("ui.promptInput.placeholder.normal", { slash: "/", at: "@" }))}
              </div>
            </Show>
          </div>
        </div>

        <div class="flex h-11 shrink-0 items-center px-2">
          <div
            class="flex shrink-0 items-center"
            aria-hidden={state.mode === "shell"}
            inert={state.mode === "shell" ? true : undefined}
            style={buttons()}
          >
            <ComposerEditorAddMenu
              disabled={view.draftOnly || state.mode === "shell"}
              title={i18n.t("ui.promptInput.add")}
              keybind={props.attachKeybind ?? ["Mod", "U"]}
              attachLabel={i18n.t("ui.promptInput.attachments")}
              attachShortcut={props.attachShortcut ?? "Mod+U"}
              commandsLabel={i18n.t("ui.promptInput.commands")}
              contextLabel={i18n.t("ui.promptInput.context")}
              shellLabel={i18n.t("ui.promptInput.shell")}
              onAttach={props.controller.attach}
              onCommands={props.controller.openCommands}
              onContext={props.controller.openContext}
              onShell={props.controller.openShell}
            />
          </div>
          <div
            ref={controlsViewport}
            data-slot="composer-controls"
            data-overflow-start={overflow.start}
            data-overflow-end={overflow.end}
            class="ms-1 me-3 h-full min-w-0 flex-1 overflow-x-auto overscroll-x-contain no-scrollbar"
            onScroll={updateOverflow}
            // Chromium leaves a partly visible control where it is when it takes focus, cut off by the edge.
            onFocusIn={() => document.activeElement?.scrollIntoView({ block: "nearest", inline: "nearest" })}
            aria-hidden={state.mode === "shell"}
            inert={state.mode === "shell" ? true : undefined}
            style={buttons()}
          >
            <div ref={controlsContent} class="flex h-full w-max min-w-full items-center gap-0.5">
              <Show when={view.agent} keyed>
                {(control) => (
                  <ComposerEditorConfiguredSelect
                    title={i18n.t("ui.promptInput.chooseAgent")}
                    keybind={["Mod", "."]}
                    control={control}
                  />
                )}
              </Show>
              <Show when={props.modelControlsVisible ?? true}>
                {props.modelControl}
                <Show when={view.variant} keyed>
                  {(control) => (
                    <Show when={control.options().length > 1}>
                      <ComposerEditorConfiguredSelect
                        mobileDrawer
                        title={i18n.t("ui.promptInput.chooseVariant")}
                        keybind={["Shift", "Mod", "D"]}
                        control={control}
                        class={control.current() === "default" ? "composer-variant-default" : undefined}
                      />
                    </Show>
                  )}
                </Show>
              </Show>
            </div>
          </div>
          <div data-slot="composer-actions" class="flex shrink-0 items-center">
            <Show when={state.mode === "normal"}>
              <ComposerEditorAlternateDelivery
                controller={props.controller}
                keybind={props.alternateKeybind ?? ["Mod", "Enter"]}
              />
            </Show>
            <Show when={state.mode === "shell"}>
              <Button
                data-action="composer-exit-shell"
                type="button"
                variant="ghost-faint"
                size="small"
                class="me-3 gap-1.5 px-1.5"
                onClick={() => {
                  props.controller.dispatch({ type: "mode.normal" })
                  props.controller.restoreFocus()
                }}
              >
                {i18n.t("ui.promptInput.exitShell")}
                <span class="hidden sm:block">
                  <Keybind keys={props.exitShellKeybind ?? ["ESC"]} variant="neutral" />
                </span>
              </Button>
            </Show>
            <ComposerEditorSubmitButton
              mode={state.mode}
              stopping={view.submit.stopping()}
              held={view.submit.held?.() ?? false}
              disabled={!props.controller.canSubmit()}
              sendLabel={i18n.t("ui.promptInput.send")}
              stopLabel={i18n.t("ui.promptInput.stop")}
              onSubmit={() => props.controller.submit()}
              onStop={props.controller.stop}
            />
          </div>
        </div>
      </form>
    </div>
  )
}

const mentionParts = new WeakMap<HTMLElement, Exclude<ComposerPrompt[number], ComposerAttachment | { type: "text" }>>()

function renderComposerEditor(editor: HTMLDivElement, prompt: ComposerPrompt) {
  const active = document.activeElement === editor
  editor.replaceChildren(
    ...prompt.flatMap<Node>((part) => {
      if (isAttachment(part)) return []

      if (part.type === "text") return [document.createTextNode(part.content)]
      const mention = document.createElement("span")
      mentionParts.set(mention, part)
      mention.textContent = part.content
      mention.contentEditable = "false"
      mention.dir = "auto"
      mention.style.unicodeBidi = "isolate"
      mention.dataset.mention =
        part.type === "file" && part.mime === "application/x-directory" ? "reference" : part.type

      if (part.type === "session") mention.title = part.id

      if (part.type === "agent") mention.dataset.name = part.name

      if (part.type === "skill") {
        mention.dataset.id = part.id
        mention.dataset.name = part.name
      }

      if (part.type === "file") {
        mention.dataset.path = part.path

        if (part.mime) mention.dataset.mime = part.mime

        if (part.filename) mention.dataset.filename = part.filename
      }

      return [mention]
    }),
  )

  if (!active) return
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function parseComposerEditor(editor: HTMLDivElement) {
  const parts: Exclude<ComposerPrompt[number], ComposerAttachment>[] = []
  let buffer = ""
  let position = 0

  const flush = () => {
    if (!buffer) return
    parts.push({ type: "text", content: buffer, start: position, end: position + buffer.length })
    position += buffer.length
    buffer = ""
  }

  const mention = (element: HTMLElement) => {
    flush()
    const content = element.textContent ?? ""
    const original = mentionParts.get(element)

    if (original?.type === "session") {
      parts.push({ ...original, content, start: position, end: position + content.length })
      position += content.length

      return
    }

    if (element.dataset.mention === "agent") {
      const agent: ComposerAgentPart = {
        type: "agent",
        name: element.dataset.name ?? content.slice(1),
        content,
        start: position,
        end: position + content.length,
      }

      parts.push(original?.type === "agent" ? { ...original, ...agent } : agent)
      position += content.length

      return
    }

    if (element.dataset.mention === "skill") {
      const skill: ComposerSkillPart = {
        type: "skill",
        id: Skill.ID.make(element.dataset.id ?? content.slice(1)),
        name: Skill.Name.make(element.dataset.name ?? content.slice(1)),
        content,
        start: position,
        end: position + content.length,
      }

      parts.push(original?.type === "skill" ? { ...original, ...skill } : skill)
      position += content.length

      return
    }

    const parsed: ComposerFilePart = {
      type: "file",
      path: element.dataset.path ?? content.slice(1),
      content,
      start: position,
      end: position + content.length,
    }

    const file: ComposerFilePart = original?.type === "file" ? { ...original, ...parsed } : parsed

    if (element.dataset.mime) file.mime = element.dataset.mime

    if (element.dataset.filename) file.filename = element.dataset.filename
    parts.push(file)
    position += content.length
  }

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += node.textContent ?? ""

      return
    }

    if (!(node instanceof HTMLElement)) return

    if (node.dataset.mention) {
      mention(node)

      return
    }

    if (node.tagName === "BR") {
      buffer += "\n"

      return
    }

    Array.from(node.childNodes).forEach(visit)
  }

  Array.from(editor.childNodes).forEach((node, index, nodes) => {
    visit(node)

    if (node instanceof HTMLElement && ["DIV", "P"].includes(node.tagName) && index < nodes.length - 1) buffer += "\n"
  })
  flush()

  if (
    parts.every((part) => part.type === "text") &&
    parts.every((part) => part.content.replace(/[\n\u200B]/g, "") === "")
  ) {
    return [{ type: "text" as const, content: "", start: 0, end: 0 }]
  }

  if (parts.length > 0) return parts

  return [{ type: "text" as const, content: "", start: 0, end: 0 }]
}

function composerCursor(editor: HTMLDivElement) {
  const selection = window.getSelection()

  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return editor.textContent?.length ?? 0
  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(editor)
  range.setEnd(selection.anchorNode!, selection.anchorOffset)

  return range.toString().length
}

function ComposerAttachments(props: {
  attachments: ComposerAttachment[]
  uploads?: Upload[]
  comments?: ComposerComment[]
  // Files attached without a mention, such as one restored from a prompt another client sent.
  files?: Extract<ComposerComment, { type: "file" }>[]
  activeCommentID?: string
  removeLabel: string
  onAttachmentClick?: (attachment: ComposerAttachment, origin: HTMLElement) => void
  preview: (attachment: ComposerAttachment) => Promise<string | undefined>
  onAttachmentRemove: (attachment: ComposerAttachment) => void
  onUploadCancel?: (upload: Upload) => void
  onCommentClick?: (comment: ComposerComment) => void
  onCommentRemove?: (comment: ComposerComment) => void
  onFileRemove?: (file: Extract<ComposerComment, { type: "file" }>) => void
  editingQuote?: string
  onEditQuote?: (key?: string) => void
  quoteSource?: ComposerEditorModel["quoteSource"]
  onQuoteComment?: (quote: Extract<ComposerComment, { type: "quote" }>, comment: string) => void
  searchPaths?: (query: string) => Promise<string[]>
}) {
  const i18n = useI18n()
  const percent = (upload: Upload) => (upload.size === 0 ? 100 : Math.floor((upload.loaded / upload.size) * 100))
  // A quote added with its editor open renders its chip in the same update, so the anchors are reactive.
  const [anchors, setAnchors] = createStore<Record<string, HTMLElement | undefined>>({})

  // Plain functions, not inline conditionals: the tooltip reads these from event handlers, outside any owner.
  const quoteTitle = (comment: ComposerComment) => (comment.type === "quote" ? quoteTooltip(comment) : undefined)
  const quoteHint = (comment: ComposerComment) => comment.type === "quote" && props.editingQuote !== comment.key

  const commentActive = (comment: ComposerComment) =>
    comment.key === props.activeCommentID || comment.key === props.editingQuote

  const editing = createMemo(() =>
    props.comments?.find(
      (comment): comment is Extract<ComposerComment, { type: "quote" }> =>
        comment.type === "quote" && comment.key === props.editingQuote,
    ),
  )

  return (
    <Show
      when={
        props.attachments.length > 0 ||
        (props.uploads?.length ?? 0) > 0 ||
        (props.comments?.length ?? 0) > 0 ||
        (props.files?.length ?? 0) > 0
      }
    >
      <div data-component="composer-attachments" data-slot="composer-attachments" class="relative">
        <div
          data-slot="composer-attachments-scroll"
          class="flex flex-nowrap gap-2 overflow-x-auto no-scrollbar px-2 pt-2 pb-1"
        >
          <For each={props.comments ?? []}>
            {(comment) => (
              <div
                ref={(element) => {
                  setAnchors(comment.key, element)
                  onCleanup(() => setAnchors(comment.key, undefined))
                }}
                class="relative group shrink-0"
              >
                <Tooltip
                  value={comment.comment}
                  placement="top"
                  openDelay={800}
                  disabled={comment.type === "quote"}
                  contentClass="max-w-[300px] break-words"
                >
                  <CommentCard
                    comment={comment.comment ?? ""}
                    target={commentCardTarget(comment)}
                    title={quoteTitle(comment)}
                    tooltip={quoteHint(comment)}
                    active={commentActive(comment)}
                    onClick={() => {
                      if (comment.type !== "quote") return props.onCommentClick?.(comment)
                      props.quoteSource?.reveal(comment.key)
                      props.onEditQuote?.(props.editingQuote === comment.key ? undefined : comment.key)
                    }}
                  />
                </Tooltip>
                <button
                  type="button"
                  onClick={() => {
                    if (props.editingQuote === comment.key) props.onEditQuote?.()
                    props.onCommentRemove?.(comment)
                  }}
                  class="absolute -top-1 -end-1 size-4 rounded-full bg-v2-icon-icon-muted outline-solid outline-1 outline-v2-icon-icon-contrast flex items-center justify-center hover-reveal group-hover:opacity-100"
                  aria-label={props.removeLabel}
                >
                  <Icon name="outline-xmark" class="text-v2-icon-icon-contrast" />
                </button>
              </div>
            )}
          </For>
          <For each={props.files ?? []}>
            {(file) => (
              <div class="relative group shrink-0" data-slot="composer-context-file">
                <Tooltip value={file.path} placement="top" contentClass="break-all">
                  <AttachmentCard title={file.name ?? getFilename(file.path)} surface="base">
                    <FileIcon node={{ path: file.path, type: "file" }} />
                    <span>
                      {typeLabel(file.name ?? file.path, "text/plain", i18n.t("ui.common.file"))}
                      <Show when={file.selection}>
                        {(selection) =>
                          selection().startLine === selection().endLine
                            ? `:${selection().startLine}`
                            : `:${selection().startLine}-${selection().endLine}`
                        }
                      </Show>
                    </span>
                  </AttachmentCard>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => props.onFileRemove?.(file)}
                  class="absolute -top-1 -end-1 size-4 rounded-full bg-v2-icon-icon-muted outline-solid outline-1 outline-v2-icon-icon-contrast flex items-center justify-center hover-reveal group-hover:opacity-100"
                  aria-label={props.removeLabel}
                >
                  <Icon name="outline-xmark" class="text-v2-icon-icon-contrast" />
                </button>
              </div>
            )}
          </For>
          <For each={props.attachments}>
            {(attachment) => {
              const image = attachment.mime.startsWith("image/")
              // Restored drafts and history carry image ids only, and path attachments carry no bytes; both load when shown.
              const [url] = createResource(() => image && attachment, props.preview)
              // Read state rather than the resource so loading never suspends; the route boundary would detach the screen and drop editor focus.
              const src = () => (url.state === "ready" ? url() : undefined)
              const missing = () => url.state === "errored" || (url.state === "ready" && !url())

              return (
                <div class="relative group shrink-0">
                  <Tooltip
                    value={attachment.type === "path" ? attachment.path : attachment.filename}
                    placement="top"
                    contentClass="break-all"
                  >
                    <Show
                      when={image && !missing()}
                      fallback={
                        <AttachmentCard title={attachment.filename}>
                          {typeLabel(attachment.filename, attachment.mime, i18n.t("ui.common.file"))}
                        </AttachmentCard>
                      }
                    >
                      <Show when={src()} fallback={<div class="w-[58px] h-[46px]" />}>
                        {(value) => (
                          <img
                            src={value()}
                            alt={attachment.filename}
                            class="w-[58px] h-[46px] rounded-[6px] object-cover"
                            onClick={(event) => props.onAttachmentClick?.(attachment, event.currentTarget)}
                          />
                        )}
                      </Show>
                      <div class="absolute inset-0 rounded-[6px] shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)] pointer-events-none" />
                    </Show>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={() => props.onAttachmentRemove(attachment)}
                    class="absolute -top-1 -end-1 size-4 rounded-full bg-v2-icon-icon-muted outline-solid outline-1 outline-v2-icon-icon-contrast flex items-center justify-center hover-reveal group-hover:opacity-100"
                    aria-label={props.removeLabel}
                  >
                    <Icon name="outline-xmark" class="text-v2-icon-icon-contrast" />
                  </button>
                </div>
              )
            }}
          </For>
          <For each={props.uploads ?? []}>
            {(upload) => (
              <div class="relative group shrink-0" data-slot="composer-upload">
                <Tooltip value={upload.filename} placement="top" contentClass="break-all">
                  <AttachmentCard title={upload.filename}>
                    <span class="inline-flex items-center gap-1">
                      <ProgressCircle percentage={percent(upload)} />
                      {i18n.t("ui.promptInput.uploading", { percent: percent(upload) })}
                    </span>
                  </AttachmentCard>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => props.onUploadCancel?.(upload)}
                  class="absolute -top-1 -end-1 size-4 rounded-full bg-v2-icon-icon-muted outline-solid outline-1 outline-v2-icon-icon-contrast flex items-center justify-center hover-reveal group-hover:opacity-100"
                  aria-label={i18n.t("ui.promptInput.cancelUpload")}
                >
                  <Icon name="outline-xmark" class="text-v2-icon-icon-contrast" />
                </button>
              </div>
            )}
          </For>
        </div>
        <div
          data-slot="composer-attachments-fade-left"
          class="pointer-events-none absolute inset-y-0 start-0 z-10 w-6 bg-[linear-gradient(to_right,var(--v2-background-bg-base),transparent)] rtl:bg-[linear-gradient(to_left,var(--v2-background-bg-base),transparent)]"
        />
        <div
          data-slot="composer-attachments-fade-right"
          class="pointer-events-none absolute inset-y-0 end-0 z-10 w-6 bg-[linear-gradient(to_left,var(--v2-background-bg-base),transparent)] rtl:bg-[linear-gradient(to_right,var(--v2-background-bg-base),transparent)]"
        />
        <Show when={editing()} keyed>
          {(current) => (
            <Show when={anchors[current.key]}>
              {(anchor) => (
                <QuoteCommentEditor
                  anchor={anchor()}
                  text={current.text}
                  icon={current.source?.icon}
                  comment={current.comment ?? ""}
                  mention={(query) => props.searchPaths?.(query) ?? Promise.resolve([])}
                  onSubmit={(comment) => {
                    props.onQuoteComment?.(current, comment)
                    props.onEditQuote?.()
                  }}
                  onClose={() => props.onEditQuote?.()}
                />
              )}
            </Show>
          )}
        </Show>
      </div>
    </Show>
  )
}

function ComposerEditorAddMenu(props: {
  disabled?: boolean
  title: string
  keybind?: string[]
  attachLabel: string
  attachShortcut?: string
  commandsLabel: string
  contextLabel: string
  shellLabel: string
  onAttach: () => void
  onCommands: () => void
  onContext: () => void
  onShell: () => void
}) {
  const focus = pointerFocusReturn()

  return (
    <Tooltip
      placement="top"
      value={
        <>
          {props.title}
          <Keybind keys={props.keybind ?? []} variant="neutral" />
        </>
      }
    >
      <Menu gutter={6} modal={false} placement="top-start">
        <Menu.Trigger
          {...focus.trigger}
          as={IconButton}
          data-action="composer-attach"
          type="button"
          icon={<Icon name="plus" />}
          variant="ghost-muted"
          size="large"
          disabled={props.disabled}
          aria-label={props.title}
        />
        <Menu.Portal>
          <Menu.Content
            onCloseAutoFocus={focus.onCloseAutoFocus}
            class="[&_[data-slot=menu-v2-item-shortcut]]:w-5 [&_[data-slot=menu-v2-item-shortcut]]:justify-center"
            style={{ "min-width": "180px" }}
          >
            <Menu.Item onSelect={props.onAttach} shortcut={props.attachShortcut}>
              {props.attachLabel}
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item onSelect={props.onCommands} shortcut="/">
              {props.commandsLabel}
            </Menu.Item>
            <Menu.Item onSelect={props.onContext} shortcut="@">
              {props.contextLabel}
            </Menu.Item>
            <Menu.Item onSelect={props.onShell} shortcut="!">
              {props.shellLabel}
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </Tooltip>
  )
}

/**
 * A menu returns focus to its trigger when it closes. Closing with Escape counts as keyboard use, so Chromium would
 * ring a trigger the pointer opened; restore focus without the ring and keep it for keyboard opens.
 */
function pointerFocusReturn() {
  let pointer: HTMLElement | undefined

  return {
    trigger: {
      onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => {
        pointer = event.currentTarget
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key !== "Escape") pointer = undefined
      },
    },
    onCloseAutoFocus: (event: Event) => {
      if (!pointer) return
      event.preventDefault()
      const active = document.activeElement

      // An outside press already moved focus where it belongs.
      if (active && active !== document.body && !active.closest('[role="menu"]')) return
      pointer.focus({ preventScroll: true, focusVisible: false })
    },
  }
}

function ComposerEditorConfiguredSelect(props: {
  mobileDrawer?: boolean
  title: string
  keybind?: string[]
  control: ComposerSelectControl
  model?: boolean
  class?: string
}) {
  const current = () => props.control.current()
  const providerID = () => props.control.options().find((option) => option.id === current())?.providerID

  return (
    <ComposerEditorSelect
      mobileDrawer={props.mobileDrawer}
      title={props.title}
      class={props.class}
      keybind={props.control.keybind?.() ?? props.keybind}
      options={props.control.options()}
      current={current()}
      currentIcon={
        <Show when={props.model && providerID()}>
          {(id) => <ProviderModelIcon provider={{ id: id(), name: id() }} class="shrink-0 opacity-60" />}
        </Show>
      }
      onSelect={props.control.onSelect}
    />
  )
}

function ComposerEditorSelect(props: {
  mobileDrawer?: boolean
  title: string
  keybind?: string[]
  options: ComposerOption[]
  current: string
  currentIcon?: JSX.Element
  class?: string
  onOpenChange?: (open: boolean) => void
  onSelect: (id: string) => void
}) {
  const mobile = createMediaQuery("(max-width: 767px)")
  const [store, setStore] = createStore({ open: false, loaded: false })
  const focus = pointerFocusReturn()
  let trigger: HTMLButtonElement | undefined

  const setOpen = (open: boolean) => {
    setStore("open", open)

    if (open) setStore("loaded", true)
    props.onOpenChange?.(open)
  }

  createEffect(() => {
    if (!mobile() && store.open) setOpen(false)
  })

  const content = () => (
    <>
      {props.currentIcon}
      <span class="truncate capitalize leading-5">
        {props.options.find((option) => option.id === props.current)?.label ?? props.current}
      </span>
      <span class="-ms-0.5 -me-1 flex shrink-0">
        <Icon name="chevron-down" />
      </span>
    </>
  )

  return (
    <Tooltip
      inactive={props.mobileDrawer && mobile()}
      placement="top"
      value={
        <>
          {props.title}
          <Keybind keys={props.keybind ?? []} variant="neutral" />
        </>
      }
    >
      <Show
        when={props.mobileDrawer && mobile()}
        fallback={
          <Menu gutter={6} modal={false} placement="top-start" onOpenChange={props.onOpenChange}>
            <Menu.Trigger
              {...focus.trigger}
              as={Button}
              variant="ghost-muted"
              size="normal"
              class={`max-w-[220px] justify-start ![font-weight:440] ${props.class ?? ""}`}
              aria-label={props.title}
            >
              {content()}
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content onCloseAutoFocus={focus.onCloseAutoFocus}>
                <Menu.RadioGroup value={props.current} onChange={props.onSelect}>
                  <For each={props.options}>
                    {(option) => (
                      <Menu.RadioItem value={option.id} class="capitalize" closeOnSelect>
                        {option.label}
                      </Menu.RadioItem>
                    )}
                  </For>
                </Menu.RadioGroup>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        }
      >
        <Button
          ref={(element: HTMLButtonElement) => {
            trigger = element
          }}
          variant="ghost-muted"
          size="normal"
          class={`max-w-[220px] justify-start ![font-weight:440] ${props.class ?? ""}`}
          aria-label={props.title}
          aria-haspopup="dialog"
          aria-expanded={store.open}
          onClick={() => setOpen(true)}
        >
          {content()}
        </Button>
        <Show when={store.loaded}>
          <Suspense>
            <MobilePanelDrawer
              hideHeader
              title={props.title}
              open={store.open}
              onOpenChange={setOpen}
              returnFocus={() => trigger}
            >
              <div class="flex flex-col overflow-hidden rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 divide-y divide-v2-border-border-base">
                <For each={props.options}>
                  {(option) => (
                    <Button
                      variant="ghost"
                      class="w-full !h-10 !justify-start !rounded-none !px-3 !font-[440] capitalize focus-visible:!outline-offset-[-2px]"
                      aria-pressed={props.current === option.id}
                      data-state={props.current === option.id ? "pressed" : undefined}
                      onClick={() => {
                        props.onSelect(option.id)
                        setOpen(false)
                      }}
                    >
                      {option.label}
                      <Show when={props.current === option.id}>
                        <Icon name="check" class="ms-auto" />
                      </Show>
                    </Button>
                  )}
                </For>
              </div>
            </MobilePanelDrawer>
          </Suspense>
        </Show>
      </Show>
    </Tooltip>
  )
}

function ComposerEditorPopover(props: {
  id?: string
  emptyLabel: string
  items: ComposerSuggestion[]
  activeID?: string
  history?: ComposerMode
  historyBrowsing?: boolean
  editor?: () => HTMLElement | undefined
  onSearch?: () => void
  onClose?: () => void
  search?: {
    value: string
    label: string
    placeholder: string
    onValueChange: (value: string) => void
    onKeyDown: (event: KeyboardEvent) => void
  }
  boundary?: () => HTMLElement | undefined
  onActiveChange: (item: ComposerSuggestion) => void
  onSelect: (item: ComposerSuggestion) => void
}) {
  const i18n = useI18n()
  const listID = props.id ?? createUniqueId()
  let container: HTMLDivElement | undefined
  const [store, setStore] = createStore({ maxHeight: COMPOSER_SUGGESTION_MAX_HEIGHT })

  const resize = (height: number) =>
    setStore(
      "maxHeight",
      composerSuggestionMaxHeight(height, props.search !== undefined || !!props.history, !!props.history),
    )

  createEffect(() => {
    if (!props.history || !props.activeID) return

    const frame = requestAnimationFrame(() =>
      container?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" }),
    )

    onCleanup(() => cancelAnimationFrame(frame))
  })

  createEffect(() => {
    if (!props.history) return

    const dismiss = (event: Event) => {
      if (!(event.target instanceof Node) || container?.contains(event.target)) return

      if (event.type === "focusin" && props.historyBrowsing && props.editor?.()?.contains(event.target)) return
      props.onClose?.()
    }

    document.addEventListener("pointerdown", dismiss)
    document.addEventListener("focusin", dismiss)
    onCleanup(() => {
      document.removeEventListener("pointerdown", dismiss)
      document.removeEventListener("focusin", dismiss)
    })
  })

  // A detached boundary (e.g. the previous session's timeline while the next one loads) measures 0px.
  const boundary = () => {
    const element = props.boundary?.()

    return element?.isConnected ? element : undefined
  }

  createEffect(() => resize(boundary()?.clientHeight ?? COMPOSER_SUGGESTION_MAX_HEIGHT * 2))
  createResizeObserver(boundary, (rect) => resize(rect.height))

  return (
    <div
      ref={container}
      data-component="composer-suggestions"
      class="absolute inset-x-0 -top-2 z-40 flex -translate-y-full scroll-pb-[18px] flex-col rounded-xl bg-v2-background-bg-base p-1.5 shadow-[var(--v2-elevation-raised)] no-scrollbar"
      classList={{ "overflow-auto": !props.history, "overflow-hidden": !!props.history }}
      style={{ "max-height": `${store.maxHeight}px` }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <Show when={props.history}>
        <Show when={props.search}>
          {(search) => (
            <div class="shrink-0 px-2 py-1">
              <input
                ref={(element) => requestAnimationFrame(() => element.isConnected && element.focus())}
                value={search().value}
                aria-label={search().label}
                placeholder={search().placeholder}
                autocomplete="off"
                spellcheck={false}
                class="w-full bg-transparent text-[13px] leading-5 text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={listID}
                aria-activedescendant={props.activeID ? `${listID}-${props.activeID}` : undefined}
                onInput={(event) => search().onValueChange(event.currentTarget.value)}
                onKeyDown={(event) => search().onKeyDown(event)}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </div>
          )}
        </Show>
        <Show when={props.historyBrowsing}>
          <button
            type="button"
            class="flex h-7 shrink-0 items-center justify-between gap-2 rounded-md px-2 text-[13px] leading-4 text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
            onClick={props.onSearch}
          >
            <span>{i18n.t("ui.promptInput.history.searchAction")}</span>
            <Keybind keys={formatKeybindParts("mod+f")} variant="ghost" />
          </button>
        </Show>
        <div class="min-h-0 flex-1 overflow-y-auto" data-scrollable>
          <div id={listID} role="listbox" aria-label={i18n.t("ui.promptInput.history")} class="flex flex-col">
            <Show
              when={props.items.length}
              fallback={<div class="px-2 py-1 text-v2-text-text-muted">{props.emptyLabel}</div>}
            >
              <For each={props.items}>
                {(item) => (
                  <button
                    id={`${listID}-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={props.activeID === item.id}
                    tabindex={-1}
                    data-suggestion-id={item.id}
                    data-active={props.activeID === item.id ? "" : undefined}
                    class="palette-menu-row"
                    data-size="compact"
                    onPointerMove={(event) => {
                      if (event.movementX || event.movementY) props.onActiveChange(item)
                    }}
                    onClick={() => props.onSelect(item)}
                  >
                    <bdi
                      dir={props.history === "shell" ? "ltr" : "auto"}
                      class="palette-menu-title flex-1 text-start"
                      style={
                        props.history === "shell"
                          ? { "font-family": "var(--font-family-mono)", "font-weight": 440 }
                          : undefined
                      }
                    >
                      {item.label || item.description || i18n.t("ui.promptInput.history.contextOnly")}
                    </bdi>
                    <Show when={item.description}>
                      <Icon name="file-document" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={!props.history}>
        <Show when={props.search}>
          {(search) => (
            <div class="shrink-0 px-2 py-1">
              <input
                ref={(element) => requestAnimationFrame(() => element.focus())}
                value={search().value}
                aria-label={search().label}
                placeholder={search().placeholder}
                class="w-full bg-transparent text-[13px] leading-5 text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                onInput={(event) => search().onValueChange(event.currentTarget.value)}
                onKeyDown={(event) => search().onKeyDown(event)}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </div>
          )}
        </Show>
        <Show
          when={props.items.length > 0}
          fallback={<div class="px-2 py-1 text-v2-text-text-muted">{props.emptyLabel}</div>}
        >
          <For each={props.items}>
            {(item) => (
              <button
                type="button"
                data-suggestion-id={item.id}
                data-active={props.activeID === item.id ? "" : undefined}
                class="flex h-7 w-full shrink-0 items-center gap-2 rounded-md px-2 py-1 text-start hover:bg-v2-overlay-simple-overlay-hover"
                classList={{ "bg-v2-overlay-simple-overlay-hover": props.activeID === item.id }}
                onPointerMove={() => props.onActiveChange(item)}
                onClick={() => props.onSelect(item)}
              >
                <div class="flex min-w-0 flex-1 items-center gap-2">
                  <ComposerSuggestionIcon item={item} />
                  <bdi dir="auto" class="shrink-0 text-v2-text-text-base">
                    {item.label}
                  </bdi>
                  <Show when={item.description}>
                    <span class="min-w-0 truncate text-v2-text-text-muted">{item.description}</span>
                  </Show>
                </div>
                <Show when={item.keybind?.length}>
                  <span class="shrink-0 text-v2-text-text-muted">{item.keybind?.join("+")}</span>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </Show>
    </div>
  )
}

function composerSuggestionMaxHeight(boundaryHeight: number, search: boolean, history = false) {
  const reserve = Math.min(COMPOSER_SUGGESTION_CONTEXT_RESERVE, boundaryHeight / 4)
  const limit = Math.min(COMPOSER_SUGGESTION_MAX_HEIGHT, boundaryHeight - reserve)
  // History has padding on both edges and shows whole rows below the pinned search control.
  const chrome = COMPOSER_SUGGESTION_TOP_PADDING * (history ? 2 : 1) + (search ? COMPOSER_SUGGESTION_SEARCH_HEIGHT : 0)
  const row = COMPOSER_SUGGESTION_ROW_HEIGHT
  const peek = history ? 0 : COMPOSER_SUGGESTION_ROW_PEEK

  if (limit < chrome + row + peek) return limit

  return chrome + Math.floor((limit - chrome - peek) / row) * row + peek
}

// "Steer ⌘⏎" / "Queue ⌘⏎" hint next to the submit button: submits with the
// delivery opposite to what plain Enter does. Visible only while the queue
// exposes an alternate (turn running and composer holding a value), so it
// disappears on its own when the current turn ends.
function ComposerEditorAlternateDelivery(props: { controller: ComposerEditorModel; keybind: string[] }) {
  const i18n = useI18n()
  const view = props.controller.view

  const action = createMemo(() => {
    const queue = view.submit.queue

    if (!queue || !props.controller.canSubmit()) return undefined

    if (queue.editing()) return "steer" as const

    return queue.alternate()
  })

  // Appears and leaves on the same frame as the placeholder, so typing never shows a fade.
  return (
    <Show when={action()} keyed>
      {(delivery) => (
        <Tooltip placement="top" inactive={delivery !== "steer"} value={i18n.t("ui.promptInput.steerHint")}>
          <Button
            data-action="composer-alternate-delivery"
            type="button"
            variant="ghost-faint"
            size="small"
            class="me-3 gap-1.5 px-1.5 ![font-weight:530]"
            onClick={() => props.controller.submit({ alternate: true })}
          >
            {delivery === "steer" ? i18n.t("ui.promptInput.steer") : i18n.t("ui.promptInput.queue")}
            <span class="hidden sm:block">
              <Keybind keys={props.keybind} variant="neutral" />
            </span>
          </Button>
        </Tooltip>
      )}
    </Show>
  )
}

function ComposerEditorSubmitButton(props: {
  mode: ComposerMode
  stopping: boolean
  held?: boolean
  disabled: boolean
  sendLabel: string
  stopLabel: string
  onSubmit: () => void
  onStop: () => void
}) {
  return (
    <Tooltip
      placement="top"
      inactive={!props.stopping && props.disabled}
      value={props.stopping ? props.stopLabel : props.sendLabel}
    >
      <IconButton
        data-action="composer-submit"
        type="button"
        disabled={!props.stopping && props.disabled}
        tabIndex={props.mode === "normal" ? undefined : -1}
        icon={
          props.held && !props.stopping ? (
            <Loader class="size-4" />
          ) : (
            <Icon name={props.stopping ? "stop" : props.mode === "shell" ? "arrow-undo-down" : "arrow-up"} />
          )
        }
        aria-busy={props.held && !props.stopping}
        variant="submit"
        class="size-7 rounded-md p-[6px]"
        aria-label={props.stopping ? props.stopLabel : props.sendLabel}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()

          if (props.stopping) {
            props.onStop()

            return
          }

          props.onSubmit()
        }}
      />
    </Tooltip>
  )
}

function ComposerSuggestionIcon(props: { item: ComposerSuggestion }) {
  if (props.item.kind === "session") return <Icon name="speech-bubble" size="small" class="shrink-0" />

  if (props.item.kind === "agent") return <Icon name="brain" size="small" class="shrink-0 text-icon-info-active" />

  if (props.item.kind === "skill") return <Icon name="post-skill" size="small" class="shrink-0" />

  if (props.item.kind === "command") return null

  return (
    <FileIcon
      node={{ path: props.item.path ?? props.item.label, type: props.item.kind === "reference" ? "directory" : "file" }}
      class="size-4 shrink-0"
    />
  )
}
