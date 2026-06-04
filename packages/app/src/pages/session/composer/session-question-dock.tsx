import { For, Show, createEffect, createMemo, onCleanup, onMount, type Component } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ImagePreview } from "@opencode-ai/ui/image-preview"
import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { usePlatform } from "@/context/platform"
import type { ImageAttachmentPart } from "@/context/prompt"
import { ACCEPTED_IMAGE_TYPES } from "@/constants/file-picker"
import { PromptImageAttachments } from "@/components/prompt-input/image-attachments"
import { uuid } from "@/utils/uuid"
import {
  questionAnswered,
  questionAttachments,
  questionReply,
  questionRequestNotFound,
  type QuestionImage as Image,
} from "./session-question-dock-helpers"
import { markQuestionProfileUi } from "./session-question-profile"

function textPart(part: QuestionAnswer[number]): part is string {
  return typeof part === "string"
}

export const questionCache = new Map<
  string,
  { tab: number; answers: QuestionAnswer[]; custom: string[]; customOn: boolean[]; images: ImageAttachmentPart[][] }
>()

export const SessionQuestionDock: Component<{ request: QuestionRequest; onSubmit: () => void }> = (props) => {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const dialog = useDialog()
  const platform = usePlatform()

  const questions = createMemo(() => props.request.questions)
  const total = createMemo(() => questions().length)

  const cached = questionCache.get(props.request.id)
  const [store, setStore] = createStore({
    tab: cached?.tab ?? 0,
    answers: cached?.answers ?? ([] as QuestionAnswer[]),
    custom: cached?.custom ?? ([] as string[]),
    customOn: cached?.customOn ?? ([] as boolean[]),
    images: cached?.images ?? ([] as Image[][]),
    editing: false,
    sending: false,
    focusedOption: -1, // -1 means no option focused, 0-n for options, options.length for custom
  })

  let root: HTMLDivElement | undefined
  let replied = false
  let max = ""

  const question = createMemo(() => questions()[store.tab])
  const options = createMemo(() => question()?.options ?? [])
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const images = createMemo(() => store.images[store.tab] ?? [])
  const attachments = createMemo(() => questionAttachments(images()))
  const on = createMemo(() => store.customOn[store.tab] === true)
  const multi = createMemo(() => question()?.multiple === true)

  const summary = createMemo(() => {
    const n = Math.min(store.tab + 1, total())
    return language.t("session.question.progress", { current: n, total: total() })
  })

  const last = createMemo(() => store.tab >= total() - 1)

  const customUpdate = (value: string, selected: boolean = on()) => {
    const prev = input().trim()
    const next = value.trim()

    setStore("custom", store.tab, value)
    if (!selected) return

    if (multi()) {
      setStore("answers", store.tab, (current = []) => {
        const removed = prev
          ? current.filter((item: QuestionAnswer[number]) => !textPart(item) || item.trim() !== prev)
          : current
        if (!next) return removed
        if (removed.some((item: QuestionAnswer[number]) => textPart(item) && item.trim() === next)) return removed
        return [...removed, next]
      })
      return
    }

    setStore("answers", store.tab, next ? [next] : [])
  }

  const measure = () => {
    if (!root) return

    const scroller = document.querySelector(".scroll-view__viewport")
    const head = scroller instanceof HTMLElement ? scroller.firstElementChild : undefined
    const top =
      head instanceof HTMLElement && head.classList.contains("sticky") ? head.getBoundingClientRect().bottom : 0
    if (!top) {
      if (!max) return
      max = ""
      root.style.removeProperty("--question-prompt-max-height")
      return
    }

    const dock = root.closest('[data-component="session-prompt-dock"]')
    if (!(dock instanceof HTMLElement)) return

    const dockBottom = dock.getBoundingClientRect().bottom
    const below = Math.max(0, dockBottom - root.getBoundingClientRect().bottom)
    const gap = 8
    const next = `${Math.max(240, Math.floor(dockBottom - top - gap - below))}px`
    if (next === max) return
    max = next
    root.style.setProperty("--question-prompt-max-height", next)
  }

  onMount(() => {
    const viewport = document.querySelector(".scroll-view__viewport") as HTMLElement | null
    markQuestionProfileUi("question-dock-mount", props.request, {
      questions: total(),
      options: options().length,
      cached: cached ? 1 : 0,
      dockHeight: root ? Math.round(root.getBoundingClientRect().height) : "none",
      viewportClient: viewport ? Math.round(viewport.clientHeight) : "none",
      viewportScroll: viewport ? Math.round(viewport.scrollHeight) : "none",
      viewportTop: viewport ? Math.round(viewport.scrollTop) : "none",
    })
    const mountAt = performance.now()
    requestAnimationFrame(() => {
      const nextViewport = document.querySelector(".scroll-view__viewport") as HTMLElement | null
      markQuestionProfileUi("question-dock-raf1", props.request, {
        mountToRafMs: Math.round(performance.now() - mountAt),
        height: root ? Math.round(root.getBoundingClientRect().height) : "none",
        dockHeight: root ? Math.round(root.getBoundingClientRect().height) : "none",
        viewportClient: nextViewport ? Math.round(nextViewport.clientHeight) : "none",
        viewportScroll: nextViewport ? Math.round(nextViewport.scrollHeight) : "none",
        viewportTop: nextViewport ? Math.round(nextViewport.scrollTop) : "none",
      })
      requestAnimationFrame(() => {
        const finalViewport = document.querySelector(".scroll-view__viewport") as HTMLElement | null
        markQuestionProfileUi("question-dock-raf2", props.request, {
          mountToRafMs: Math.round(performance.now() - mountAt),
          height: root ? Math.round(root.getBoundingClientRect().height) : "none",
          dockHeight: root ? Math.round(root.getBoundingClientRect().height) : "none",
          viewportClient: finalViewport ? Math.round(finalViewport.clientHeight) : "none",
          viewportScroll: finalViewport ? Math.round(finalViewport.scrollHeight) : "none",
          viewportTop: finalViewport ? Math.round(finalViewport.scrollTop) : "none",
        })
      })
    })

    let raf: number | undefined
    const update = () => {
      if (raf !== undefined) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = undefined
        measure()
      })
    }

    update()
    window.addEventListener("resize", update)

    const dock = root?.closest('[data-component="session-prompt-dock"]')
    const scroller = document.querySelector(".scroll-view__viewport")
    const observer = new ResizeObserver(update)
    if (dock instanceof HTMLElement) observer.observe(dock)
    if (scroller instanceof HTMLElement) observer.observe(scroller)

    // Keyboard navigation
    const handleKeyDown = (e: KeyboardEvent) => {
      if (store.sending) return

      // Handle cmd+enter for submit
      if (e.key === "Enter" && e.metaKey) {
        // If textarea is focused, let it handle cmd+enter (commitCustom)
        if (e.target instanceof HTMLTextAreaElement && e.target.dataset.slot === "question-custom-input") {
          return
        }
        e.preventDefault()
        next()
        return
      }

      // Arrow key navigation
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        // Don't interfere if textarea is focused
        if (e.target instanceof HTMLTextAreaElement) return

        e.preventDefault()
        const totalOptions = options().length + 1 // +1 for custom option

        if (e.key === "ArrowDown") {
          setStore("focusedOption", (current) => {
            if (current === -1) return 0
            return (current + 1) % totalOptions
          })
        } else {
          setStore("focusedOption", (current) => {
            if (current === -1) return totalOptions - 1
            return (current - 1 + totalOptions) % totalOptions
          })
        }
        return
      }

      // Enter key to select focused option
      if (e.key === "Enter" && store.focusedOption !== -1) {
        if (e.target instanceof HTMLTextAreaElement) return
        e.preventDefault()
        selectOption(store.focusedOption)
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    onCleanup(() => {
      window.removeEventListener("resize", update)
      window.removeEventListener("keydown", handleKeyDown)
      observer.disconnect()
      if (raf !== undefined) cancelAnimationFrame(raf)
    })
  })

  onCleanup(() => {
    if (replied) return
    questionCache.set(props.request.id, {
      tab: store.tab,
      answers: store.answers.map((a: QuestionAnswer | undefined) => (a ? [...a] : [])),
      custom: store.custom.map((s: string | undefined) => s ?? ""),
      customOn: store.customOn.map((b: boolean | undefined) => b ?? false),
      images: store.images.map((x: Image[] | undefined) => (x ?? []).map((y: Image) => ({ ...y }))),
    })
  })

  const refreshQuestions = async () => {
    const result = await sdk.client.question.list()
    const list = (result.data ?? []).filter((item) => item.sessionID === props.request.sessionID)
    sync.set("question", props.request.sessionID, reconcile(list, { key: "id" }))
    console.debug(
      `[question-dock] refreshed pending questions session=${props.request.sessionID} count=${list.length} stale=${props.request.id}`,
    )
  }

  const removeStaleQuestion = () => {
    replied = true
    questionCache.delete(props.request.id)
    sync.set(
      "question",
      props.request.sessionID,
      produce((draft = []) => {
        const index = draft.findIndex((item) => item.id === props.request.id)
        if (index !== -1) draft.splice(index, 1)
        return draft
      }),
    )
  }

  const fail = (err: unknown) => {
    if (questionRequestNotFound(err, props.request.id)) {
      console.warn(
        `[question-dock] stale request missing on server request=${props.request.id} session=${props.request.sessionID}`,
      )
      removeStaleQuestion()
      void refreshQuestions().catch((refreshErr: unknown) => {
        const message = refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
        console.warn(`[question-dock] refresh after stale request failed request=${props.request.id} error=${message}`)
      })
      showToast({
        title: language.t("common.requestFailed"),
        description: `Question request is no longer pending: ${props.request.id}`,
      })
      return
    }

    const message = err instanceof Error ? err.message : String(err)
    showToast({ title: language.t("common.requestFailed"), description: message })
  }

  const replyMutation = useMutation(() => ({
    mutationFn: (answers: QuestionAnswer[]) => sdk.client.question.reply({ requestID: props.request.id, answers }),
    onMutate: () => {
      props.onSubmit()
    },
    onSuccess: () => {
      replied = true
      questionCache.delete(props.request.id)
    },
    onError: fail,
  }))

  const rejectMutation = useMutation(() => ({
    mutationFn: () => sdk.client.question.reject({ requestID: props.request.id }),
    onMutate: () => {
      props.onSubmit()
    },
    onSuccess: () => {
      replied = true
      questionCache.delete(props.request.id)
    },
    onError: fail,
  }))

  const sending = createMemo(() => replyMutation.isPending || rejectMutation.isPending)

  createEffect(() => setStore("sending", sending()))

  const reply = (answers: QuestionAnswer[]) => {
    if (sending()) return
    replyMutation.mutate(answers)
  }

  const reject = () => {
    if (sending()) return
    rejectMutation.mutate()
  }

  const submit = () => void reply(questionReply(questions(), store.answers, store.images))

  const pick = (answer: string, custom: boolean = false) => {
    setStore("answers", store.tab, [answer])
    if (custom) setStore("custom", store.tab, answer)
    if (!custom) setStore("customOn", store.tab, false)
    setStore("editing", false)
  }

  const toggle = (answer: string) => {
    setStore("answers", store.tab, (current = []) => {
      if (current.includes(answer)) return current.filter((item) => item !== answer)
      return [...current, answer]
    })
  }

  const customToggle = () => {
    if (sending()) return

    if (!multi()) {
      setStore("customOn", store.tab, true)
      setStore("editing", true)
      customUpdate(input(), true)
      return
    }

    const next = !on()
    setStore("customOn", store.tab, next)
    if (next) {
      setStore("editing", true)
      customUpdate(input(), true)
      return
    }

    const value = input().trim()
    if (value)
      setStore("answers", store.tab, (current = []) =>
        current.filter((item: QuestionAnswer[number]) => !textPart(item) || item.trim() !== value),
      )
    setStore("editing", false)
  }

  const customOpen = () => {
    if (sending()) return
    if (!on()) setStore("customOn", store.tab, true)
    setStore("editing", true)
    customUpdate(input(), true)
  }

  const selectOption = (optIndex: number) => {
    if (sending()) return

    if (optIndex === options().length) {
      customOpen()
      return
    }

    const opt = options()[optIndex]
    if (!opt) return
    if (multi()) {
      toggle(opt.label)
      return
    }
    pick(opt.label)
  }

  const commitCustom = () => {
    setStore("editing", false)
    customUpdate(input())
  }

  const addImage = async (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return

    const url = await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
    if (!url) return

    setStore("images", store.tab, (list = []) => [
      ...list,
      {
        type: "image" as const,
        id: uuid(),
        mime: file.type,
        dataUrl: url,
        filename: file.name || "image",
      },
    ])
  }

  const removeImage = (id: string) => {
    setStore("images", store.tab, (list = []) => list.filter((item: Image) => item.id !== id))
  }

  const pasteImage = async (event: ClipboardEvent) => {
    if (store.sending) return

    const data = event.clipboardData
    if (!data) return
    const files = Array.from(data.items)
      .filter((item: DataTransferItem) => item.kind === "file" && ACCEPTED_IMAGE_TYPES.includes(item.type))
      .map((item) => item.getAsFile())
      .filter((item): item is File => !!item)

    if (files.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      await Promise.all(files.map(addImage))
      return
    }

    const text = data.getData("text/plain") ?? ""
    if (!text && platform.readClipboardImage) {
      const file = await platform.readClipboardImage()
      if (!file) return
      event.preventDefault()
      event.stopPropagation()
      await addImage(file)
    }
  }

  const next = () => {
    if (sending()) return
    if (store.editing) commitCustom()

    if (store.tab >= total() - 1) {
      submit()
      return
    }

    setStore("tab", store.tab + 1)
    setStore("editing", false)
    setStore("focusedOption", -1)
  }

  const back = () => {
    if (sending()) return
    if (store.tab <= 0) return
    setStore("tab", store.tab - 1)
    setStore("editing", false)
    setStore("focusedOption", -1)
  }

  const jump = (tab: number) => {
    if (sending()) return
    setStore("tab", tab)
    setStore("editing", false)
    setStore("focusedOption", -1)
  }

  return (
    <DockPrompt
      kind="question"
      ref={(el) => (root = el)}
      header={
        <>
          <div data-slot="question-header-title">{summary()}</div>
          <div data-slot="question-progress">
            <For each={questions()}>
              {(_, i) => (
                <button
                  type="button"
                  data-slot="question-progress-segment"
                  data-active={i() === store.tab}
                  data-answered={questionAnswered(
                    store.answers[i()],
                    store.custom[i()],
                    store.customOn[i()],
                    store.images[i()],
                  )}
                  disabled={store.sending}
                  onClick={() => jump(i())}
                  aria-label={`${language.t("ui.tool.questions")} ${i() + 1}`}
                />
              )}
            </For>
          </div>
        </>
      }
      footer={
        <>
          <Button variant="ghost" size="large" disabled={sending()} onClick={reject}>
            {language.t("ui.common.dismiss")}
          </Button>
          <div data-slot="question-footer-actions">
            <Show when={store.tab > 0}>
              <Button variant="secondary" size="large" disabled={sending()} onClick={back}>
                {language.t("ui.common.back")}
              </Button>
            </Show>
            <Button variant={last() ? "primary" : "secondary"} size="large" disabled={sending()} onClick={next}>
              {last() ? language.t("ui.common.submit") : language.t("ui.common.next")}
            </Button>
          </div>
        </>
      }
    >
      <div data-slot="question-text">{question()?.question}</div>
      <Show when={multi()} fallback={<div data-slot="question-hint">{language.t("ui.question.singleHint")}</div>}>
        <div data-slot="question-hint">{language.t("ui.question.multiHint")}</div>
      </Show>
      <div data-slot="question-options">
        <For each={options()}>
          {(opt, i) => {
            const picked = () => store.answers[store.tab]?.includes(opt.label) ?? false
            const focused = () => store.focusedOption === i()
            return (
              <button
                data-slot="question-option"
                data-picked={picked()}
                data-focused={focused()}
                role={multi() ? "checkbox" : "radio"}
                aria-checked={picked()}
                disabled={sending()}
                onClick={() => selectOption(i())}
              >
                <span data-slot="question-option-check" aria-hidden="true">
                  <span
                    data-slot="question-option-box"
                    data-type={multi() ? "checkbox" : "radio"}
                    data-picked={picked()}
                  >
                    <Show when={multi()} fallback={<span data-slot="question-option-radio-dot" />}>
                      <Icon name="check-small" size="small" />
                    </Show>
                  </span>
                </span>
                <span data-slot="question-option-main">
                  <span data-slot="option-label">{opt.label}</span>
                  <Show when={opt.description}>
                    <span data-slot="option-description">{opt.description}</span>
                  </Show>
                </span>
              </button>
            )
          }}
        </For>

        <Show
          when={store.editing}
          fallback={
            <div
              data-slot="question-option"
              data-custom="true"
              data-picked={on()}
              data-focused={store.focusedOption === options().length}
              role={multi() ? "checkbox" : "radio"}
              aria-checked={on()}
              aria-disabled={store.sending}
              tabIndex={store.sending ? -1 : 0}
              onClick={customOpen}
              onKeyDown={(e) => {
                if (store.sending) return
                if (e.key !== "Enter" && e.key !== " ") return
                e.preventDefault()
                customOpen()
              }}
            >
              <span
                data-slot="question-option-check"
                aria-hidden="true"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  customToggle()
                }}
              >
                <span data-slot="question-option-box" data-type={multi() ? "checkbox" : "radio"} data-picked={on()}>
                  <Show when={multi()} fallback={<span data-slot="question-option-radio-dot" />}>
                    <Icon name="check-small" size="small" />
                  </Show>
                </span>
              </span>
              <span data-slot="question-option-main">
                <span data-slot="option-label">{language.t("ui.messagePart.option.typeOwnAnswer")}</span>
                <span data-slot="option-description">{input() || language.t("ui.question.custom.placeholder")}</span>
                <div
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <PromptImageAttachments
                    attachments={attachments()}
                    onOpen={(file) => dialog.show(() => <ImagePreview src={file.dataUrl} alt={file.filename} />)}
                    onRemove={removeImage}
                    removeLabel={language.t("prompt.attachment.remove")}
                    class="px-0 pt-2"
                  />
                </div>
              </span>
            </div>
          }
        >
          <form
            data-slot="question-option"
            data-custom="true"
            data-picked={on()}
            data-focused={store.focusedOption === options().length}
            role={multi() ? "checkbox" : "radio"}
            aria-checked={on()}
            onMouseDown={(e) => {
              if (sending()) {
                e.preventDefault()
                return
              }
              if (e.target instanceof HTMLTextAreaElement) return
              const input = e.currentTarget.querySelector('[data-slot="question-custom-input"]')
              if (input instanceof HTMLTextAreaElement) input.focus()
            }}
            onSubmit={(e) => {
              e.preventDefault()
              commitCustom()
            }}
          >
            <span
              data-slot="question-option-check"
              aria-hidden="true"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                customToggle()
              }}
            >
              <span data-slot="question-option-box" data-type={multi() ? "checkbox" : "radio"} data-picked={on()}>
                <Show when={multi()} fallback={<span data-slot="question-option-radio-dot" />}>
                  <Icon name="check-small" size="small" />
                </Show>
              </span>
            </span>
            <span data-slot="question-option-main">
              <span data-slot="option-label">{language.t("ui.messagePart.option.typeOwnAnswer")}</span>
              <textarea
                ref={(el) => setTimeout(() => el.focus(), 0)}
                data-slot="question-custom-input"
                placeholder={language.t("ui.question.custom.placeholder")}
                value={input()}
                rows={2}
                disabled={store.sending}
                onPaste={(e) => void pasteImage(e)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault()
                    setStore("editing", false)
                    return
                  }
                  if (e.key !== "Enter" || !e.metaKey) return
                  e.preventDefault()
                  commitCustom()
                }}
                onInput={(e) => {
                  customUpdate(e.currentTarget.value)
                }}
              />
              <PromptImageAttachments
                attachments={attachments()}
                onOpen={(file) => dialog.show(() => <ImagePreview src={file.dataUrl} alt={file.filename} />)}
                onRemove={removeImage}
                removeLabel={language.t("prompt.attachment.remove")}
                class="px-0 pt-2"
              />
            </span>
          </form>
        </Show>
      </div>
    </DockPrompt>
  )
}
