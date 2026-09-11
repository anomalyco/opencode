import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { For, Show, Switch, Match, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { DocumentBody, DocumentPreview, DocumentPreviewPanel, type DocumentKind } from "./document-preview"
import { Markdown } from "./markdown"

export * from "./office-preview-model"
import {
  type OfficeComment,
  type OfficeCommentAction,
  type OfficePreviewResult,
  anchorParagraphIndex,
  availableCommentActions,
  markdownBlockIndex,
} from "./office-preview-model"

const ACTION_KEYS: Record<OfficeCommentAction, string> = {
  resolve: "ui.officePreview.action.resolve",
  deny: "ui.officePreview.action.deny",
  approve: "ui.officePreview.action.approve",
  edit: "ui.officePreview.action.edit",
  delete: "ui.officePreview.action.delete",
}

const STATUS_KEYS: Record<OfficeComment["status"], string> = {
  open: "ui.officePreview.status.open",
  resolved: "ui.officePreview.status.resolved",
  denied: "ui.officePreview.status.denied",
}

const bubbleStyle = {
  position: "fixed",
  "z-index": "100",
  "border-radius": "9999px",
  "background-color": "var(--icon-interactive-base, #333333)",
  color: "var(--white, #ffffff)",
} as const

export interface OfficePreviewProps {
  result: OfficePreviewResult
  invoke: <T = unknown>(name: string, input?: Record<string, unknown>) => Promise<T | undefined>
  openInApp?: () => void
  download?: () => void
  embedded?: boolean
  onClose?: () => void
}

export function OfficePreview(props: OfficePreviewProps) {
  const i18n = useI18n()
  const dialog = useDialog()
  const [store, setStore] = createStore({
    result: props.result,
    editing: false,
    editingComment: undefined as string | undefined,
    busy: false,
    error: "",
  })

  const draft = createMemo(() => store.result.source === "draft")
  const docxDraft = createMemo(() => draft() && /\.docx$/i.test(store.result.filename))
  const fileKind = createMemo<DocumentKind>(() => {
    if (store.result.source === "file" && !store.result.fileUrl) return "fallback"
    const name = store.result.filename.toLowerCase()
    if (name.endsWith(".pdf")) return "pdf"
    if (name.endsWith(".docx")) return "docx"
    if (name.endsWith(".xlsx")) return "xlsx"
    if (name.endsWith(".pptx")) return "pptx"
    return "fallback"
  })

  let body: HTMLDivElement | undefined
  let editRoot: HTMLDivElement | undefined
  let commentInput: HTMLTextAreaElement | undefined
  const [pick, setPick] = createSignal<{ x: number; y: number; index: number } | undefined>()
  const [chip, setChip] = createSignal<{ x: number; y: number; author: string } | undefined>()
  const [commentDraft, setCommentDraft] = createSignal("")
  const [commentEditDraft, setCommentEditDraft] = createSignal("")
  const [pendingRange, setPendingRange] = createSignal<number | undefined>()

  const refresh = async () => {
    const next = await props.invoke<OfficePreviewResult>("office.preview", {})
    if (next && typeof next === "object") {
      setStore({ result: next })
      setPendingRange(undefined)
    }
  }

  const act = async (name: string, input?: Record<string, unknown>) => {
    if (store.busy) return false
    setStore({ busy: true, error: "" })
    try {
      await props.invoke(name, input)
      await refresh()
      return true
    } catch (err) {
      setStore({ error: err instanceof Error ? err.message : String(err) })
      return false
    } finally {
      setStore({ busy: false })
    }
  }

  const commentAction = (comment: OfficeComment, action: OfficeCommentAction) => {
    if (action === "edit") {
      setCommentEditDraft(comment.text)
      setStore({ editingComment: comment.id })
      return
    }
    void act(`office.comment.${action}`, { commentId: comment.id })
  }

  const createComment = async () => {
    const text = commentDraft().trim()
    if (store.busy || !text) return
    const range = pendingRange()
    setPendingRange(undefined)
    setCommentDraft("")
    // ponytail: no user identity is exposed to this component; "user" is the display fallback
    await act("office.comment.create", {
      commentId: crypto.randomUUID(),
      author: "user",
      commentText: text,
      ...(range !== undefined ? { rangeStartParagraph: range, rangeEndParagraph: range } : {}),
    })
  }

  const saveCommentEdit = async (comment: OfficeComment) => {
    const text = commentEditDraft().trim()
    if (!text) return
    if (await act("office.comment.edit", { commentId: comment.id, text })) setStore({ editingComment: undefined })
  }

  const startEdit = () => setStore({ editing: true, editingComment: undefined })
  const cancelEdit = () => setStore({ editing: false })
  const saveEdit = async () => {
    const content = editRoot ? editRoot.innerText : ""
    if (content === (store.result.content ?? "")) {
      setStore({ editing: false })
      return
    }
    if (await act("office.edit.save", { content })) setStore({ editing: false })
  }

  const accept = () => {
    void dialog.push(() => (
      <ConfirmPanel
        title={i18n.t("ui.officePreview.acceptTitle")}
        description={i18n.t("ui.officePreview.acceptDescription")}
        confirmLabel={i18n.t("ui.officePreview.accept")}
        cancelLabel={i18n.t("ui.officePreview.cancel")}
        onCancel={() => dialog.close()}
        onConfirm={() => {
          dialog.close()
          void act("office.accept", {}).then((ok) => {
            if (ok) setStore({ editing: false })
          })
        }}
      />
    ))
  }

  const syncPick = () => {
    const sel = document.getSelection()
    if (!body || !sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.anchorNode || !body.contains(sel.anchorNode)) {
      setPick(undefined)
      return
    }
    const index = markdownBlockIndex(body, sel.anchorNode)
    if (index === undefined) {
      setPick(undefined)
      return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    setPick({ x: rect.left + rect.width / 2, y: rect.top, index })
  }

  createEffect(() => {
    if (!docxDraft() || store.editing) {
      setPick(undefined)
      setChip(undefined)
      return
    }
    document.addEventListener("selectionchange", syncPick)
    onCleanup(() => document.removeEventListener("selectionchange", syncPick))
  })

  createEffect(() => {
    const root = body
    const content = store.result.content
    const comments = store.result.comments
    const docx = docxDraft()
    const editing = store.editing
    if (!root) return
    root.querySelectorAll("[data-office-anchor]").forEach((el) => {
      el.removeAttribute("data-office-anchor")
      if (el instanceof HTMLElement) el.style.backgroundColor = ""
    })
    if (!docx || editing || !content) return
    const mdRoot = root.querySelector('[data-component="markdown"]')
    if (!mdRoot) return
    const anchored = new Map<number, string>()
    for (const comment of comments) {
      const index = anchorParagraphIndex(comment.anchor)
      if (index !== undefined) anchored.set(index, comment.author)
    }
    anchored.forEach((author, index) => {
      // ponytail: block wrappers are display:contents, so the background goes on the inner block element
      const target = mdRoot.children[index]?.firstElementChild
      if (!(target instanceof HTMLElement)) return
      target.setAttribute("data-office-anchor", author)
      target.style.backgroundColor = "color-mix(in oklab, currentColor 8%, transparent)"
    })
  })

  const onHover = (event: PointerEvent) => {
    if (!(event.target instanceof HTMLElement)) return
    const el = event.target.closest("[data-office-anchor]")
    if (!el) {
      setChip(undefined)
      return
    }
    const rect = el.getBoundingClientRect()
    setChip({ x: rect.right, y: rect.top, author: el.getAttribute("data-office-anchor") ?? "" })
  }

  const commentCard = (comment: OfficeComment) => (
    <div data-slot="office-preview-comment" class="border-b border-border-weak-base p-3">
      <div class="flex items-center justify-between gap-2">
        <span class="truncate text-12-semibold text-text-strong">{comment.author}</span>
        <span class="shrink-0 rounded-full bg-background-weak px-2 py-0.5 text-12-regular text-text-weak">
          {i18n.t(STATUS_KEYS[comment.status])}
        </span>
      </div>
      <Show
        when={store.editingComment === comment.id}
        fallback={
          <p
            class={comment.status === "open" ? "mt-1 text-14-regular text-text" : "mt-1 text-14-regular text-text-weak"}
          >
            {comment.text}
          </p>
        }
      >
        <textarea
          rows={2}
          ref={(el) => {
            if (el && el.value !== commentEditDraft()) el.value = commentEditDraft()
          }}
          onInput={(event) => setCommentEditDraft(event.currentTarget.value)}
          class="mt-1 w-full resize-none rounded-md border border-border-weak-base bg-background p-2 text-14-regular text-text"
        />
        <div class="mt-2 flex justify-end gap-1">
          <Button variant="ghost" disabled={store.busy} onClick={() => setStore({ editingComment: undefined })}>
            {i18n.t("ui.officePreview.cancel")}
          </Button>
          <Button variant="primary" disabled={store.busy} onClick={() => void saveCommentEdit(comment)}>
            {i18n.t("ui.officePreview.save")}
          </Button>
        </div>
      </Show>
      <Show when={comment.suggestedText}>
        <div class="mt-2 rounded-md bg-background-weak p-2">
          <p class="text-12-semibold text-text-weak">{i18n.t("ui.officePreview.suggested")}</p>
          <p class="text-14-regular text-text">{comment.suggestedText}</p>
        </div>
      </Show>
      <div class="mt-2 flex flex-wrap gap-1">
        <For each={availableCommentActions(comment)}>
          {(action) => (
            <Button
              variant={action === "delete" ? "ghost" : "secondary"}
              disabled={store.busy}
              onClick={() => commentAction(comment, action)}
            >
              {i18n.t(ACTION_KEYS[action])}
            </Button>
          )}
        </For>
      </div>
    </div>
  )

  const headerActions = (
    <>
      <Show when={draft()}>
        <Show
          when={store.editing}
          fallback={
            <Button variant="ghost" disabled={store.busy} onClick={startEdit}>
              {i18n.t("ui.officePreview.edit")}
            </Button>
          }
        >
          <Button variant="ghost" disabled={store.busy} onClick={cancelEdit}>
            {i18n.t("ui.officePreview.cancel")}
          </Button>
          <Button variant="primary" disabled={store.busy} onClick={saveEdit}>
            {i18n.t("ui.officePreview.save")}
          </Button>
        </Show>
      </Show>
      <Button variant="ghost" disabled={store.busy} onClick={accept}>
        {i18n.t("ui.officePreview.accept")}
      </Button>
      <Show when={props.openInApp}>
        <Button variant="ghost" onClick={() => props.openInApp?.()}>
          {i18n.t("ui.officePreview.openInApp")}
        </Button>
      </Show>
      <Show when={props.download}>
        <Button variant="primary" onClick={() => props.download?.()}>
          {i18n.t("ui.officePreview.download")}
        </Button>
      </Show>
    </>
  )

  const previewBody = (
    <div class="flex h-full w-full min-h-0">
      <div
        ref={(el) => {
          body = el
        }}
        class="relative min-w-0 flex-1"
        onPointerOver={onHover}
        onPointerOut={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest("[data-office-anchor]")) setChip(undefined)
        }}
      >
        <Switch>
          <Match when={draft() && !store.editing}>
            <Markdown
              text={store.result.content ?? ""}
              data-slot="office-preview-draft"
              class="h-full w-full overflow-auto p-4"
              onScroll={() => {
                setPick(undefined)
                setChip(undefined)
              }}
            />
          </Match>
          <Match when={draft() && store.editing}>
            <div
              contentEditable
              data-slot="office-preview-edit"
              class="h-full w-full overflow-auto whitespace-pre-wrap p-4 text-14-regular text-text outline-none"
              onScroll={() => {
                setPick(undefined)
                setChip(undefined)
              }}
              ref={(el) => {
                editRoot = el
                if (el && !el.textContent) el.textContent = store.result.content ?? ""
              }}
            />
          </Match>
          <Match when={true}>
            <DocumentBody kind={fileKind()} url={store.result.fileUrl ?? ""} filename={store.result.filename} />
          </Match>
        </Switch>
        <Show when={pick()}>
          {(value) => (
            <button
              type="button"
              data-slot="office-preview-add-comment"
              style={{
                ...bubbleStyle,
                left: `${value().x}px`,
                top: `${value().y - 36}px`,
                transform: "translateX(-50%)",
                padding: "4px 10px",
                border: "none",
                "font-size": "12px",
                cursor: "pointer",
              }}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                setPendingRange(value().index)
                setPick(undefined)
                commentInput?.focus()
              }}
            >
              {i18n.t("ui.officePreview.addComment")}
            </button>
          )}
        </Show>
        <Show when={chip()}>
          {(value) => (
            <div
              data-slot="office-preview-chip"
              style={{
                ...bubbleStyle,
                left: `${value().x + 8}px`,
                top: `${value().y - 4}px`,
                "pointer-events": "none",
                padding: "2px 8px",
                "font-size": "11px",
              }}
            >
              {value().author}
            </div>
          )}
        </Show>
      </div>
      <aside data-slot="office-preview-panel" class="flex w-[300px] shrink-0 flex-col border-l border-border-weak-base">
        <div class="border-b border-border-weak-base p-3">
          <span class="text-14-semibold text-text-strong">{i18n.t("ui.officePreview.comments")}</span>
        </div>
        <div class="flex flex-col gap-2 p-3">
          <textarea
            rows={2}
            placeholder={i18n.t("ui.officePreview.commentPlaceholder")}
            ref={(el) => {
              commentInput = el
              if (el && el.value !== commentDraft()) el.value = commentDraft()
            }}
            onInput={(event) => setCommentDraft(event.currentTarget.value)}
            class="w-full resize-none rounded-md border border-border-weak-base bg-background p-2 text-14-regular text-text"
          />
          <div class="flex justify-end">
            <Button variant="primary" disabled={store.busy || !commentDraft().trim()} onClick={createComment}>
              {i18n.t("ui.officePreview.commentSubmit")}
            </Button>
          </div>
        </div>
        <Show when={store.error}>
          <div
            data-slot="office-preview-error"
            class="mx-3 mb-2 rounded-md bg-background-weak px-2 py-1.5 text-12-regular text-text-weak"
          >
            {i18n.t("ui.officePreview.error")}: {store.error}
          </div>
        </Show>
        <div class="min-h-0 flex-1 overflow-auto">
          <Show
            when={store.result.comments.length === 0}
            fallback={<For each={store.result.comments}>{(comment) => commentCard(comment)}</For>}
          >
            <p class="p-4 text-12-regular text-text-weak">{i18n.t("ui.officePreview.commentsEmpty")}</p>
          </Show>
        </div>
      </aside>
    </div>
  )

  if (props.embedded)
    return (
      <DocumentPreviewPanel
        filename={store.result.filename}
        kind={draft() ? "markdown" : fileKind()}
        url={store.result.fileUrl ?? ""}
        actions={headerActions}
        onClose={props.onClose}
      >
        {previewBody}
      </DocumentPreviewPanel>
    )
  return (
    <DocumentPreview
      filename={store.result.filename}
      kind={draft() ? "markdown" : fileKind()}
      url={store.result.fileUrl ?? ""}
      actions={headerActions}
    >
      {previewBody}
    </DocumentPreview>
  )
}

function ConfirmPanel(props: {
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      data-slot="office-preview-confirm"
      class="flex w-[400px] max-w-[90vw] flex-col gap-3 rounded-lg bg-background-stronger p-5 shadow-2xl"
    >
      <p class="text-16-medium text-text-strong">{props.title}</p>
      <p class="text-14-regular text-text-weak">{props.description}</p>
      <div class="flex justify-end gap-2">
        <Button variant="ghost" onClick={props.onCancel}>
          {props.cancelLabel}
        </Button>
        <Button variant="primary" onClick={props.onConfirm}>
          {props.confirmLabel}
        </Button>
      </div>
    </div>
  )
}
