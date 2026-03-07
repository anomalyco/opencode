import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Component,
} from "solid-js"
import { useElementHeight } from "@opencode-ai/ui/hooks"
import { useI18n } from "../context/i18n"
import { ComposerDragOverlay } from "./new-composer/drag-overlay"
import { DEFAULT_AT_OPTIONS, DEFAULT_SLASH_COMMANDS } from "./new-composer/defaults"
import { ComposerInputLayer } from "./new-composer/input-layer"
import { PermissionBody } from "./new-composer/permission-body"
import { ComposerPopover } from "./new-composer/popover"
import { QuestionBody, QuestionSizer } from "./new-composer/question-body"
import { ComposerTodoTray } from "./new-composer/todo-tray"
import { ComposerTray } from "./new-composer/tray"
import type { ComposerSource, ContextItem, ImageAttachment, NewComposerProps } from "./new-composer/types"
import { ACCEPTED_FILE_TYPES } from "./new-composer/types"
import { useEditor } from "./new-composer/use-editor"
import { useLayout } from "./new-composer/use-layout"
import { useTodo } from "./new-composer/use-todo"
import { showToast } from "./toast"

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const normalize = (key: string, code?: string) => {
  if (code === "Quote") return "'"
  if (key === ",") return "comma"
  if (key === "+") return "plus"
  if (key === " ") return "space"
  if (key === "Dead" && code === "Quote") return "'"
  return key.toLowerCase()
}

const match = (config: string | undefined, event: KeyboardEvent) => {
  if (!config || config === "none") return false
  const key = normalize(event.key, event.code)

  const combos = config.split(",")
  for (const combo of combos) {
    const kb = {
      key: "",
      ctrl: false,
      meta: false,
      shift: false,
      alt: false,
    }

    for (const part of combo.trim().toLowerCase().split("+")) {
      if (part === "ctrl" || part === "control") {
        kb.ctrl = true
        continue
      }
      if (part === "meta" || part === "cmd" || part === "command") {
        kb.meta = true
        continue
      }
      if (part === "mod") {
        if (IS_MAC) kb.meta = true
        else kb.ctrl = true
        continue
      }
      if (part === "alt" || part === "option") {
        kb.alt = true
        continue
      }
      if (part === "shift") {
        kb.shift = true
        continue
      }
      kb.key = part
    }

    if (
      kb.key === key &&
      kb.ctrl === !!event.ctrlKey &&
      kb.meta === !!event.metaKey &&
      kb.shift === !!event.shiftKey &&
      kb.alt === !!event.altKey
    ) {
      return true
    }
  }

  return false
}

/**
 * New Composer — split architecture version of composer island.
 */
export const NewComposer: Component<NewComposerProps> = (props) => {
  const i18n = useI18n()
  const [answers, setAnswers] = createSignal<Record<number, string[]>>(
    (props.questionAnswers ?? []).reduce<Record<number, string[]>>((map, row, i) => {
      map[i] = [...row]
      return map
    }, {}),
  )
  const [customs, setCustoms] = createSignal<Record<number, string>>({})
  const [customOns, setCustomOns] = createSignal<Record<number, boolean>>({})
  const [sending, setSending] = createSignal(false)
  const [questionSending, setQuestionSending] = createSignal(false)
  const [permissionSending, setPermissionSending] = createSignal(false)
  const [accept, setAccept] = createSignal(props.accepting ?? false)
  const [modelTick, setModelTick] = createSignal(0)
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [contexts, setContexts] = createSignal<ContextItem[]>(props.contextItems ?? [])
  const [drag, setDrag] = createSignal<"image" | "@mention" | null>(null)
  let id = 0
  let editor: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  const pick = () => input?.click()

  const isQuestion = () => props.mode === "question"
  const isPermission = () => props.mode === "permission"
  const isMulti = () => props.questionMultiple ?? false
  const working = createMemo(() => props.working ?? sending())
  const accepting = createMemo(() => props.accepting ?? accept())
  const questionBusy = createMemo(() => props.questionBusy ?? questionSending())
  const permissionBusy = createMemo(() => props.permissionBusy ?? permissionSending())
  const tab = () => props.questionIndex ?? 0

  const mapFromList = (list: string[][] | undefined) => {
    const map: Record<number, string[]> = {}
    if (!list) return map
    list.forEach((row, i) => {
      if (!row) return
      map[i] = [...row]
    })
    return map
  }

  const listFromMap = (map: Record<number, string[]>) => {
    const keys = Object.keys(map).map(Number)
    const count = Math.max(props.questionTotal ?? 0, keys.length > 0 ? Math.max(...keys) + 1 : 0)
    return Array.from({ length: count }, (_, i) => map[i] ?? [])
  }

  const setAnswerMap = (
    next: Record<number, string[]> | ((prev: Record<number, string[]>) => Record<number, string[]>),
  ) => {
    setAnswers((prev) => {
      const map = typeof next === "function" ? next(prev) : next
      props.onQuestionAnswersChange?.(listFromMap(map))
      return map
    })
  }

  const selected = createMemo(() => answers()[tab()] ?? [])
  const custom = createMemo(() => customs()[tab()] ?? "")
  const customOn = createMemo(() => customOns()[tab()] ?? false)
  const answered = createMemo(() => {
    if (props.questionAnswered) return props.questionAnswered
    const total = props.questionTotal ?? 0
    const map = answers()
    const text = customs()
    const flags = customOns()
    return Array.from({ length: total }, (_, i) => {
      if ((map[i]?.length ?? 0) > 0) return true
      if (flags[i] === true && (text[i] ?? "").trim().length > 0) return true
      return false
    })
  })
  const activeDrag = createMemo(() => props.forceDragType ?? drag())

  const [trayRef, setTrayRef] = createSignal<HTMLDivElement>()
  const trayHeight = useElementHeight(trayRef, 42)
  const trayOverlap = 14

  createEffect(
    on(
      () => props.questionAnswers,
      (next) => {
        if (next === undefined) return
        setAnswers(mapFromList(next))
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.contextItems,
      (next) => {
        if (next) setContexts(next)
      },
    ),
  )

  createEffect(
    on(
      () => props.accepting,
      (next) => {
        if (next === undefined) return
        setAccept(next)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const i = tab()
    const list = answers()[i] ?? []
    const options = new Set((props.questionOptions ?? []).map((item) => item.label.trim()))
    const free = list.find((item) => !options.has(item.trim())) ?? ""

    setCustoms((map) => {
      if ((map[i] ?? "") === free) return map
      return { ...map, [i]: free }
    })

    const hasOption = list.some((item) => options.has(item.trim()))
    setCustomOns((map) => {
      const prev = map[i] ?? false
      const next = free ? true : hasOption ? false : prev
      if (prev === next) return map
      return { ...map, [i]: next }
    })
  })

  const toggleAccept = () => {
    if (props.runtime?.toggleAccept) {
      void Promise.resolve()
        .then(() => props.runtime?.toggleAccept?.())
        .catch(() => {})
      return
    }
    if (props.onAcceptToggle) {
      void Promise.resolve()
        .then(() => props.onAcceptToggle?.())
        .catch(() => {})
      return
    }
    setAccept((value) => !value)
  }

  const cycle = (list: string[] | undefined, curr: string | undefined, pick?: (value: string) => void) => {
    if (!list || list.length === 0 || !pick) return
    const i = curr ? list.findIndex((item) => item === curr) : -1
    const next = i < 0 ? 0 : (i + 1) % list.length
    const value = list[next]
    if (!value) return
    pick(value)
  }

  const openModel = () => {
    if (props.runtime?.openModel) {
      void Promise.resolve()
        .then(() => props.runtime?.openModel?.())
        .catch(() => {})
      return
    }
    if (props.onModelOpen) {
      void Promise.resolve()
        .then(() => props.onModelOpen?.())
        .catch(() => {})
      return
    }
    setModelTick((value) => value + 1)
  }

  const cycleAgent = () => {
    if (props.runtime?.cycleAgent) {
      void Promise.resolve()
        .then(() => props.runtime?.cycleAgent?.())
        .catch(() => {})
      return
    }
    if (props.onAgentCycle) {
      void Promise.resolve()
        .then(() => props.onAgentCycle?.())
        .catch(() => {})
      return
    }
    cycle(props.agentOptions, props.agentCurrent ?? props.agentName, props.onAgentSelect)
  }

  const cycleVariant = () => {
    if (props.runtime?.cycleVariant) {
      void Promise.resolve()
        .then(() => props.runtime?.cycleVariant?.())
        .catch(() => {})
      return
    }
    if (props.onVariantCycle) {
      void Promise.resolve()
        .then(() => props.onVariantCycle?.())
        .catch(() => {})
      return
    }
    cycle(props.variantOptions, props.variantCurrent ?? props.variant, props.onVariantSelect)
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      if (match(props.modelKeybind ?? "mod+'", event)) {
        event.preventDefault()
        event.stopPropagation()
        openModel()
        return
      }

      if (match(props.agentKeybind ?? "mod+.", event)) {
        event.preventDefault()
        event.stopPropagation()
        cycleAgent()
        return
      }

      if (match(props.variantKeybind ?? "shift+mod+d", event)) {
        event.preventDefault()
        event.stopPropagation()
        cycleVariant()
      }
    }

    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  const layout = useLayout({
    isQuestion,
    isPermission,
    imageCount: () => images().length,
    contextCount: () => contexts().length,
    heightSpring: props.heightSpring,
    morphSpring: props.morphSpring,
  })

  const edit = useEditor({
    value: props.value,
    onValueChange: props.onValueChange,
    onSubmit: (input) => {
      if (working()) {
        if (props.runtime?.abort) {
          void Promise.resolve()
            .then(() => props.runtime?.abort?.())
            .catch(() => {})
          return
        }
        void Promise.resolve()
          .then(() => props.onAbort?.())
          .catch(() => {})
        return
      }

      const payload = {
        source: input.source,
        mode: input.mode,
        text: input.text,
        parts: input.parts,
        files: images(),
        context: contexts(),
      }

      const text = payload.text.trim()
      if (!text && payload.files.length === 0 && payload.context.length === 0) return
      if (!props.runtime?.submit && !props.onSubmit) return

      const run = props.runtime?.submit ? () => props.runtime?.submit?.(payload) : () => props.onSubmit?.(payload)

      setSending(true)
      void Promise.resolve()
        .then(run)
        .then(() => {
          setImages([])
          edit.setText("")
        })
        .catch(() => {})
        .finally(() => {
          setSending(false)
        })
    },
    onAbort: () => {
      if (props.runtime?.abort) {
        return Promise.resolve()
          .then(() => props.runtime?.abort?.())
          .catch(() => {})
      }
      if (props.onAbort) {
        return Promise.resolve()
          .then(() => props.onAbort?.())
          .catch(() => {})
      }
      if (!sending()) return
      setSending(false)
    },
    onAuto: toggleAccept,
    onPick: pick,
    onModel: openModel,
    onAgent: cycleAgent,
    onVariant: cycleVariant,
    modelKeybind: props.modelKeybind ?? "mod+'",
    agentKeybind: props.agentKeybind ?? "mod+.",
    variantKeybind: props.variantKeybind ?? "shift+mod+d",
    onSlash: props.runtime?.runSlash ?? props.onSlashCommand,
    historyRead: props.runtime?.historyRead ?? props.historyRead,
    historyWrite: props.runtime?.historyWrite ?? props.historyWrite,
    working,
    atOptions: props.runtime?.searchAt ?? props.atOptions ?? DEFAULT_AT_OPTIONS,
    slashCommands: props.runtime?.searchSlash ?? props.slashCommands ?? DEFAULT_SLASH_COMMANDS,
    editor: () => editor,
    measure: () => layout.measure(editor),
  })

  const listAnswers = () => {
    const count = Math.max((props.questionTotal ?? 0) || 0, tab() + 1)
    return Array.from({ length: count }, (_, i) => answers()[i] ?? [])
  }

  const updateCustom = (value: string, on: boolean = customOn()) => {
    const i = tab()
    const prev = (customs()[i] ?? "").trim()
    const next = value.trim()

    setCustoms((map) => ({ ...map, [i]: value }))
    if (!on) return

    if (isMulti()) {
      setAnswerMap((map) => {
        const list = map[i] ?? []
        const clean = prev ? list.filter((item) => item.trim() !== prev) : list
        if (!next) return { ...map, [i]: clean }
        if (clean.some((item) => item.trim() === next)) return { ...map, [i]: clean }
        return { ...map, [i]: [...clean, next] }
      })
      return
    }
    setAnswerMap((map) => ({ ...map, [i]: next ? [next] : [] }))
  }

  const setCustom = (value: string) => {
    updateCustom(value)
  }

  const setCustomOn = (value: boolean) => {
    const i = tab()
    setCustomOns((map) => ({ ...map, [i]: value }))
    if (value) {
      updateCustom(custom(), true)
      return
    }

    const text = custom().trim()
    if (!text) return
    setAnswerMap((map) => {
      const list = map[i] ?? []
      return { ...map, [i]: list.filter((item) => item.trim() !== text) }
    })
  }

  const questionSubmit = () => {
    if (questionBusy()) return
    const run = props.runtime?.submitQuestion ?? props.onQuestionSubmit
    if (!run) {
      props.onQuestionNext?.()
      return
    }

    setQuestionSending(true)
    void Promise.resolve()
      .then(() => run(listAnswers()))
      .catch(() => {})
      .finally(() => {
        setQuestionSending(false)
      })
  }

  const questionNext = () => {
    if (questionBusy()) return
    const last = (props.questionIndex ?? 0) >= (props.questionTotal ?? 1) - 1
    if (last) {
      questionSubmit()
      return
    }
    props.onQuestionNext?.()
  }

  const questionForward = () => {
    if (questionBusy()) return
    const last = (props.questionIndex ?? 0) >= (props.questionTotal ?? 1) - 1
    if (last) return
    props.onQuestionNext?.()
  }

  const questionBack = () => {
    if (questionBusy()) return
    props.onQuestionBack?.()
  }

  const questionDismiss = () => {
    if (questionBusy()) return

    const run = props.runtime?.rejectQuestion ?? props.onQuestionReject
    if (!run) {
      props.onQuestionDismiss?.()
      return
    }

    setQuestionSending(true)
    void Promise.resolve()
      .then(run)
      .then(() => {
        props.onQuestionDismiss?.()
      })
      .catch(() => {})
      .finally(() => {
        setQuestionSending(false)
      })
  }

  const decidePermission = (response: "once" | "always" | "reject") => {
    if (permissionBusy()) return

    const run = props.runtime?.decidePermission ?? props.onPermissionDecide
    if (!run) return

    setPermissionSending(true)
    void Promise.resolve()
      .then(() => run(response))
      .catch(() => {})
      .finally(() => {
        setPermissionSending(false)
      })
  }

  const todo = useTodo({
    todos: () => props.todos ?? [],
    show: () => props.showTodos ?? false,
    blocked: () => isQuestion() || isPermission(),
    collapsed: () => props.todoCollapsed,
    onCollapsed: props.onTodoCollapseChange,
    shellHeight: layout.height,
    trayHeight,
    trayOverlap,
  })

  const toggleOption = (label: string) => {
    const index = tab()
    if (isMulti()) {
      setAnswerMap((prev) => {
        const list = prev[index] ?? []
        const next = list.includes(label) ? list.filter((item) => item !== label) : [...list, label]
        return { ...prev, [index]: next }
      })
      return
    }
    setCustomOns((prev) => ({ ...prev, [index]: false }))
    setAnswerMap((prev) => ({ ...prev, [index]: [label] }))
  }

  const ctxKey = (item: ContextItem) => {
    if (item.id) return `id:${item.id}`
    if (item.commentID) return `comment:${item.path}:${item.commentID}`
    const start = item.selection?.startLine ?? 0
    const end = item.selection?.endLine ?? 0
    return `path:${item.path}:${start}:${end}`
  }

  const dropContext = (item: ContextItem) => {
    const id = ctxKey(item)
    setContexts((prev) => prev.filter((x) => ctxKey(x) !== id))
    props.runtime?.removeContext?.(item)
    props.onContextDrop?.(item)
  }

  const openContext = (item: ContextItem) => {
    props.runtime?.openContext?.(item)
    props.onContextOpen?.(item)
  }

  const rejectFile = (source: "paste" | "drop" | "pick", file?: File) => {
    const input = { source, file }
    const runtime = props.runtime?.fileRejected
    const handler = props.onFileRejected

    if (runtime) {
      runtime(input)
      return
    }
    if (handler) {
      handler(input)
      return
    }
    if (source !== "paste") return

    showToast({
      title: i18n.t("ui.prompt.toast.pasteUnsupported.title"),
      description: i18n.t("ui.prompt.toast.pasteUnsupported.description"),
    })
  }

  const dialogOn = () => props.runtime?.dialogActive?.() ?? props.dialogActive ?? false

  const addFile = (file: File, source: "paste" | "drop" | "pick") => {
    if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
      rejectFile(source, file)
      return false
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setImages((prev) => [
        ...prev,
        {
          id: `img-${++id}-${Date.now()}`,
          filename: file.name,
          mime: file.type,
          dataUrl,
        },
      ])
    }
    reader.readAsDataURL(file)
    return true
  }

  const dropImage = (itemID: string) => setImages((prev) => prev.filter((item) => item.id !== itemID))

  const handlePaste = (event: ClipboardEvent) => {
    const data = event.clipboardData
    if (!data) return
    event.preventDefault()
    event.stopPropagation()

    const items = Array.from(data.items)
    const fileItems = items.filter((item) => item.kind === "file")
    const accepted = fileItems.filter((item) => ACCEPTED_FILE_TYPES.includes(item.type))

    if (accepted.length > 0) {
      for (const item of accepted) {
        const file = item.getAsFile()
        if (file) addFile(file, "paste")
      }
      return
    }

    if (fileItems.length > 0) {
      const file = fileItems[0]?.getAsFile() ?? undefined
      rejectFile("paste", file)
      return
    }

    const text = data.getData("text/plain") ?? ""
    if (!text) {
      const read = props.runtime?.readClipboardImage ?? props.readClipboardImage
      if (!read) return
      void Promise.resolve()
        .then(read)
        .then((file) => {
          if (!file) return
          addFile(file, "paste")
        })
        .catch(() => {})
      return
    }

    document.execCommand("insertText", false, text)
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    if (dialogOn()) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"

    const hasFiles = event.dataTransfer?.types.includes("Files")
    if (hasFiles) {
      setDrag("image")
      return
    }

    const hasText = event.dataTransfer?.types.includes("text/plain")
    if (hasText) {
      setDrag("@mention")
      return
    }

    setDrag(null)
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (dialogOn()) return
    if (!event.relatedTarget) setDrag(null)
  }

  const handleGlobalDrop = (event: DragEvent) => {
    if (dialogOn()) return
    event.preventDefault()
    setDrag(null)

    const text = event.dataTransfer?.getData("text/plain")
    if (text?.startsWith("file:")) {
      edit.insertFile(text.slice(5))
      return
    }

    const list = event.dataTransfer?.files
    if (!list) return
    for (const file of Array.from(list)) {
      addFile(file, "drop")
    }
  }

  const onPick = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement
    const files = target.files
    if (!files) return
    for (const file of Array.from(files)) addFile(file, "pick")
    target.value = ""
  }

  const send = (source: ComposerSource = "button") => {
    if (working()) {
      if (props.runtime?.abort) {
        void Promise.resolve()
          .then(() => props.runtime?.abort?.())
          .catch(() => {})
      } else {
        void Promise.resolve()
          .then(() => props.onAbort?.())
          .catch(() => {})
      }
      return
    }
    edit.submit(source)
  }

  const pickShortcut = (n: number) => {
    const opts = props.questionOptions ?? []
    if (n <= 0) return

    const option = opts[n - 1]
    if (option) {
      toggleOption(option.label)
      return
    }

    if (n === opts.length + 1) {
      setCustomOn(true)
      const input = document.querySelector('[data-slot="question-custom-input"]')
      if (input instanceof HTMLTextAreaElement) input.focus()
    }
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isQuestion()) return
      if (questionBusy()) return

      const target = event.target
      const writing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)

      if (
        event.key === "Escape" &&
        target instanceof HTMLTextAreaElement &&
        target.dataset.slot === "question-custom-input"
      ) {
        target.blur()
        event.preventDefault()
        return
      }

      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        target instanceof HTMLTextAreaElement &&
        target.dataset.slot === "question-custom-input"
      ) {
        target.blur()
        event.preventDefault()
        return
      }

      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key === "Enter") {
        event.preventDefault()
        questionSubmit()
        return
      }

      if (writing) return

      if (event.key >= "1" && event.key <= "9") {
        pickShortcut(Number(event.key))
        event.preventDefault()
        return
      }

      if (event.key === "ArrowLeft") {
        questionBack()
        event.preventDefault()
        return
      }

      if (event.key === "ArrowRight") {
        questionForward()
        event.preventDefault()
        return
      }

      if (event.key !== "Enter") return
      event.preventDefault()
      questionNext()
    }

    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  onMount(() => {
    document.addEventListener("dragover", handleGlobalDragOver)
    document.addEventListener("dragleave", handleGlobalDragLeave)
    document.addEventListener("drop", handleGlobalDrop)

    onCleanup(() => {
      document.removeEventListener("dragover", handleGlobalDragOver)
      document.removeEventListener("dragleave", handleGlobalDragLeave)
      document.removeEventListener("drop", handleGlobalDrop)
    })
  })

  return (
    <div
      data-component="new-composer"
      data-mode={props.mode}
      style={{
        width: "100%",
        "max-width": "720px",
        margin: "0 auto",
        position: "relative",
        height: `${todo.totalHeight()}px`,
      }}
    >
      <ComposerTray
        onRef={setTrayRef}
        inputOpacity={layout.inputOpacity()}
        inputBlur={layout.inputBlur()}
        questionOpacity={layout.questionOpacity()}
        questionBlur={layout.questionBlur()}
        morph={layout.morph()}
        isQuestion={isQuestion()}
        isPermission={isPermission()}
        showQuestion={layout.showQuestion()}
        showPermission={layout.showPermission()}
        agentName={props.agentName}
        modelName={props.modelName}
        variant={props.variant}
        agentOptions={props.agentOptions}
        modelOptions={props.modelOptions}
        variantOptions={props.variantOptions}
        agentCurrent={props.agentCurrent}
        modelCurrent={props.modelCurrent}
        variantCurrent={props.variantCurrent}
        onAgentSelect={props.onAgentSelect}
        onModelSelect={props.onModelSelect}
        onVariantSelect={props.onVariantSelect}
        agentKeybind={props.agentKeybind ?? "mod+."}
        modelKeybind={props.modelKeybind ?? "mod+'"}
        variantKeybind={props.variantKeybind ?? "shift+mod+d"}
        modelOpenTick={modelTick()}
        agentControl={props.agentControl}
        modelControl={props.modelControl}
        variantControl={props.variantControl}
        shell={edit.mode()}
        onShell={edit.setMode}
        questionIndex={props.questionIndex}
        questionTotal={props.questionTotal}
        onQuestionDismiss={questionDismiss}
        onQuestionBack={questionBack}
        onQuestionNext={questionNext}
        questionBusy={questionBusy()}
        onPermissionDecide={decidePermission}
        permissionBusy={permissionBusy()}
      />

      <Show when={todo.progress() > 0.001}>
        <ComposerTodoTray
          todos={props.todos ?? []}
          collapsed={todo.collapsed()}
          onToggle={todo.toggle}
          progress={todo.progress()}
          collapse={todo.collapse()}
          visibleHeight={todo.visible()}
          hide={todo.hide()}
          shut={todo.shut()}
          bottom={todo.bottom()}
          onContentRef={todo.contentRef}
        />
      </Show>

      <ComposerPopover
        kind={edit.popover()}
        bottom={trayHeight() - trayOverlap + layout.height() + 8}
        atFlat={edit.at.flat()}
        atActive={edit.at.active()}
        atKey={edit.atKey}
        onAtHover={edit.at.setActive}
        onAtPick={edit.insertAt}
        slashFlat={edit.slash.flat()}
        slashActive={edit.slash.active()}
        onSlashHover={edit.slash.setActive}
        onSlashPick={edit.insertSlash}
      />

      <div
        data-dock-surface="shell"
        style={{
          position: "absolute",
          bottom: `${trayHeight() - trayOverlap}px`,
          left: 0,
          right: 0,
          "z-index": 10,
          height: `${layout.height()}px`,
          ...(activeDrag()
            ? {
                border: "2px dashed var(--icon-info-active)",
                "box-shadow": "none",
              }
            : {
                "box-shadow": `0 0 0 1px light-dark(#cfcecd, #595353), 0 1px 2px -1px rgba(19,16,16,0.04), 0 1px 2px 0 rgba(19,16,16,0.06), 0 1px 3px 0 rgba(19,16,16,0.08)`,
              }),
        }}
      >
        <ComposerDragOverlay type={activeDrag()} />

        <div
          ref={layout.setQuestionRef}
          data-component="dock-prompt"
          data-kind="question"
          aria-hidden="true"
          style={{ position: "absolute", visibility: "hidden", left: 0, right: 0, "pointer-events": "none" }}
        >
          <div data-slot="question-body" style={{ padding: "8px 8px 0" }}>
            <QuestionSizer
              text={props.questionText}
              options={props.questionOptions}
              multi={isMulti()}
              index={props.questionIndex}
              total={props.questionTotal}
              answered={answered()}
            />
          </div>
        </div>

        <div
          ref={layout.setPermissionRef}
          data-component="dock-prompt"
          data-kind="permission"
          aria-hidden="true"
          style={{ position: "absolute", visibility: "hidden", left: 0, right: 0, "pointer-events": "none" }}
        >
          <div data-slot="permission-body">
            <PermissionBody
              tool={props.permissionTool}
              description={props.permissionDescription}
              patterns={props.permissionPatterns}
            />
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            "flex-direction": "column",
            opacity: layout.inputOpacity(),
            transform: `scale(${layout.inputScale()})`,
            filter: `blur(${layout.inputBlur()}px)`,
            "pointer-events": layout.morph() > 0.5 ? "none" : "auto",
          }}
        >
          <ComposerInputLayer
            value={edit.value()}
            mode={edit.mode()}
            images={images()}
            contexts={contexts()}
            working={working()}
            accepting={accepting()}
            placeholder={props.placeholder}
            onImageDrop={dropImage}
            contextActive={props.contextActive}
            onContextOpen={openContext}
            onContextDrop={dropContext}
            onAccept={toggleAccept}
            onPick={pick}
            onSend={() => send("button")}
            onEditorRef={(el) => {
              editor = el
              requestAnimationFrame(() => {
                layout.measure(editor)
                el.focus()
              })
            }}
            onInput={edit.handleInput}
            onKeyDown={edit.handleKeyDown}
            onPaste={handlePaste}
            onCompStart={() => edit.setComposing(true)}
            onCompEnd={() => edit.setComposing(false)}
          />
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: layout.questionOpacity(),
            transform: `scale(${layout.questionScale()})`,
            filter: `blur(${layout.questionBlur()}px)`,
            "pointer-events": layout.morph() < 0.5 ? "none" : "auto",
          }}
        >
          <Switch>
            <Match when={layout.showQuestion()}>
              <div data-component="dock-prompt" data-kind="question">
                <div data-slot="question-body" style={{ padding: "8px 8px 0" }}>
                  <QuestionBody
                    text={props.questionText}
                    options={props.questionOptions}
                    multi={isMulti()}
                    index={props.questionIndex}
                    total={props.questionTotal}
                    answered={answered()}
                    selected={selected()}
                    custom={custom()}
                    customOn={customOn()}
                    busy={questionBusy()}
                    onToggle={toggleOption}
                    onCustomOn={setCustomOn}
                    onCustom={setCustom}
                    onJump={props.onQuestionJump}
                  />
                </div>
              </div>
            </Match>
            <Match when={layout.showPermission()}>
              <div data-component="dock-prompt" data-kind="permission">
                <div data-slot="permission-body">
                  <PermissionBody
                    tool={props.permissionTool}
                    description={props.permissionDescription}
                    patterns={props.permissionPatterns}
                  />
                </div>
              </div>
            </Match>
          </Switch>
        </div>
      </div>

      <input
        ref={(el) => {
          input = el
        }}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES.join(",")}
        style={{ display: "none" }}
        onChange={onPick}
      />
    </div>
  )
}

export const Composer = NewComposer

export type {
  AtOption,
  ComposerHistoryItem,
  ContextItem,
  ImageAttachment,
  NewComposerProps,
  SlashCommand,
  TodoItem,
} from "./new-composer/types"
