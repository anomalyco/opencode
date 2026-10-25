import {
  BoxRenderable,
  RGBA,
  TextareaRenderable,
  MouseEvent,
  PasteEvent,
  decodePasteBytes,
  rgbToHex,
  type KeyEvent,
} from "@opentui/core"
import { createEffect, createMemo, onMount, createSignal, onCleanup, on, Show, Switch, Match, For } from "solid-js"
import path from "path"
import { useLocal } from "../../context/local"
import { Flag } from "@bolt-ai/core/flag/flag"
import { tint, useTheme } from "../../context/theme"
import { EmptyBorder, SplitBorder } from "../../ui/border"
import { useTuiPaths, useTuiTerminalEnvironment } from "../../context/runtime"
import { useClipboard } from "../../context/clipboard"
import { Spinner } from "../spinner"
import { voice } from "../../voice"
import { createFire, FireStrip } from "../fire-frame"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { usePromptRef } from "../../context/prompt"
import { useSessionTabs } from "../../context/session-tabs"
import { useEvent } from "../../context/event"
import { editorSelectionKey, useEditorContext, type EditorSelection } from "../../context/editor"
import { normalizePromptContent, openEditor } from "../../editor"
import { useExit } from "../../context/exit"
import { expandPromptInputPastedText, realignPromptInputMentions } from "../../prompt/mention"
import { parseSlashHead } from "../../prompt/parse"
import { createStore, produce, unwrap } from "solid-js/store"
import { emptyPrompt, usePromptHistory, type PromptInfo, type PromptPartRef } from "../../prompt/history"
import { saveDraft, takeDraft } from "./draft-stash"
import { Skill } from "@opencode/schema/skill"
import { computePromptTraits } from "../../prompt/traits"
import { expandPastedTextPlaceholders, expandTrackedPastedText } from "../../prompt/part"
import { usePromptStash } from "../../prompt/stash"
import { DialogStash } from "../dialog-stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import type { AssistantMessage, FilePart, UserMessage } from "@bolt-ai/sdk/v2"
import { Locale } from "../../util/locale"
import { meter } from "../../util/meter"
import { errorMessage } from "../../util/error"
import { createColors, createFrames } from "../../ui/spinner"
import { useDialog } from "../../ui/dialog"
import { DialogIntegration } from "../dialog-integration"
import { useConnected } from "../use-connected"
import { useToast } from "../../ui/toast"
import { createFadeIn } from "../../util/signal"
import { DialogSkill } from "../dialog-skill"
import { DialogWorkspaceUnavailable } from "../dialog-workspace-unavailable"
import { useArgs } from "../../context/args"
import { BOLT_BASE_MODE, useBindings, useCommandShortcut, useLeaderActive, useOpencodeKeymap } from "../../keymap"
import { useTuiConfig } from "../../config"
import { usePromptWorkspace } from "./workspace"
import { usePromptMove } from "./move"
import { resolvePastedAttachments } from "./local-attachment"
import { locationKey, useData } from "../../context/data"
import { useLocation } from "../../context/location"
import { useVim, VimModeIndicator, vimToggleCommand } from "./vim-mode"
import { createCostAlertController } from "../../util/cost-alert"
import { useNudge } from "../../context/nudge"
import { parseMemoryCommand } from "@bolt-ai/memory/commands"
import { runMemoryCommand } from "../../util/memory-command"
import { showMemoryDialog, showMemoryHelpDialog, showMemoryStatusDialog } from "../dialog-memory"

registerOpencodeSpinner()

export type PromptProps = {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  muted?: boolean
  onSubmit?: () => void
  onAside?: (question: string) => void
  ref?: (ref: PromptRef | undefined) => void
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  mode: "normal" | "shell"
  setMode(mode: "normal" | "shell"): void
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
  // Optional so plugin-provided prompt replacements without side-question
  // support still satisfy the ref.
  aside?(): void
  // Optional for the same reason; inserts text at the cursor without submitting.
  insert?(text: string): void
}

const DRAFT_RETENTION_MIN_CHARS = 20
const revealedPromptMetadata = new WeakSet<object>()

function randomIndex(count: number) {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}

export function PromptInterruptStatus(props: {
  armed: boolean
  animations?: boolean
  text: RGBA
  subdued: RGBA
  warning: RGBA
  flash?: RGBA
}) {
  const ignition = createAnimatable(
    { level: 0 },
    { enabled: () => props.animations ?? false, transition: tween({ duration: 0.22 }) },
  )
  createEffect(
    on(
      () => props.armed,
      (armed) => {
        if (!armed || !props.animations) return ignition.jump({ level: 0 })
        ignition.jump({ level: 0.75 })
        ignition.animate({ level: 0 })
      },
      { defer: true },
    ),
  )
  const armedColor = createMemo(() => {
    const level = ignition.value().level
    if (level === 0 || !props.flash) return props.warning
    return tint(props.warning, props.flash, level)
  })

  return (
    <text fg={props.armed ? armedColor() : props.text} wrapMode="none" truncate flexShrink={1}>
      esc{" "}
      <span style={{ fg: props.armed ? armedColor() : props.subdued }}>
        {props.armed ? "again to interrupt" : "interrupt"}
      </span>
    </text>
  )
}

function hasEditorRangeSelection(selection: EditorSelection["ranges"][number]) {
  return (
    selection.selection.start.line !== selection.selection.end.line ||
    selection.selection.start.character !== selection.selection.end.character
  )
}

function getEditorRangeLabel(selection: EditorSelection["ranges"][number]) {
  if (!hasEditorRangeSelection(selection)) return
  if (selection.selection.start.line === selection.selection.end.line) return `#${selection.selection.start.line}`
  return `#${selection.selection.start.line}-${selection.selection.end.line}`
}

function formatEditorContext(selection: EditorSelection) {
  const selected = selection.ranges.filter(hasEditorRangeSelection)
  if (selected.length === 0)
    return `<system-reminder>Note: The user opened the file "${selection.filePath}". This may or may not be relevant to the current task.</system-reminder>\n`

  const ranges = selected.map((range, index) => {
    const prefix = selected.length > 1 ? `Selection ${index + 1}: ` : ""
    return `Note: The user selected ${prefix}${getEditorRangeLabel(range)} from "${selection.filePath}". \`\`\`${range.text}\`\`\`\n\n`
  })

  return `<system-reminder>${ranges.join("\n")} This may or may not be relevant to the current task.</system-reminder>\n`
}

function argumentSlash(input: string, commands: readonly KeymapCommand[]) {
  const head = parseSlashHead(input, /\s/)
  if (!head) return
  const command = commands.find(
    (command) =>
      command.slash?.arguments &&
      (command.slash.name === head.name || command.slash.aliases?.includes(head.name) === true),
  )
  if (!command) return
  return { command, input: head.arguments }
}

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  const [inputTarget, setInputTarget] = createSignal<TextareaRenderable | undefined>()

  const enabled = useInteractivity()
  const disabled = () => props.disabled || !enabled()
  const leader = Keymap.useLeaderActive()
  const muted = () => leader() || props.muted
  const local = useLocal()
  const paths = useTuiPaths()
  const terminalEnvironment = useTuiTerminalEnvironment()
  const clipboard = useClipboard()
  const client = useClient()
  const editor = useEditorContext()
  const route = useRoute()
  const promptRef = usePromptRef()
  const sessionTabs = useSessionTabs()
  const data = useData()
  const directoryRecents = useDirectoryRecents()
  const keymapCommands = Keymap.useCommands()
  const currentLocation = useLocation()
  const args = useArgs()
  const config = useConfig().data
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => data.session.status(props.sessionID ?? ""))
  const history = usePromptHistory()
  const stash = usePromptStash()
  const keymap = Keymap.use()
  const renderer = useRenderer()
  const measure = (text: string) => measureEditText(text, { widthMethod: renderer.widthMethod })
  const exit = useExit()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const animationsEnabled = createMemo(() => config.animations ?? true)
  const list = createMemo(() => props.placeholders?.normal ?? [])
  const shell = createMemo(() => props.placeholders?.shell ?? [])
  const fileContextEnabled = createMemo(() => config.prompt?.editor ?? true)
  const [dismissedEditorSelectionKey, setDismissedEditorSelectionKey] = createSignal<string>()
  const editorContext = createMemo(() => {
    const selection = fileContextEnabled() ? editor.selection() : undefined
    if (!selection) return
    return editorSelectionKey(selection) === dismissedEditorSelectionKey() ? undefined : selection
  })
  const editorPath = createMemo(() => editorContext()?.filePath)
  const editorSelectionLabel = createMemo(() => {
    const ranges = editorContext()?.ranges
    if (!ranges) return
    const first = ranges.find(hasEditorRangeSelection) ?? ranges[0]
    if (!first) return
    return [getEditorRangeLabel(first), ranges.length > 1 ? `+${ranges.length - 1}` : undefined]
      .filter(Boolean)
      .join(" ")
  })
  const editorFileLabel = createMemo(() => {
    const value = editorPath()
    if (!value) return
    const filename = path.basename(value)
    const file = /^index\.[^./]+$/.test(filename)
      ? [path.basename(path.dirname(value)), filename].filter(Boolean).join("/")
      : filename
    return `${file.split(path.sep).join("/")}${editorSelectionLabel() ?? ""}`
  })
  const editorFileLabelDisplay = createMemo(() => {
    const file = editorFileLabel()
    if (!file) return
    return Locale.truncateMiddle(file, Math.max(12, Math.min(48, Math.floor(dimensions().width / 3))))
  })
  const editorContextLabelState = createMemo(() => editor.labelState())
  const [auto, setAuto] = createSignal<AutocompleteRef>()
  const move = usePromptMove({
    projectID: () =>
      (props.sessionID ? data.session.get(props.sessionID)?.projectID : undefined) ?? data.location.info()?.project.id,
    sessionID: () => props.sessionID,
  })
  const [pendingDirectory, setPendingDirectory] = createSignal<string>()
  Keymap.createLayer(() => ({
    mode: "global",
    enabled: !disabled(),
    commands: [
      {
        id: "session.cd",
        title: "Change working directory",
        slash: { name: "cd", arguments: true },
        run: async (input) => {
          if (!input?.trim()) {
            toast.show({ message: "Directory is required", variant: "error" })
            return
          }
          const sessionID = props.sessionID
          const session = sessionID ? data.session.get(sessionID) : undefined
          const sourceProjectID = session?.projectID ?? data.location.info()?.project.id
          const value = input.trim()
          const expanded =
            value === "~" ? paths.home : value.startsWith("~/") ? path.join(paths.home, value.slice(2)) : value
          const directory = path.resolve(
            session?.location.directory ?? currentLocation.current?.directory ?? data.location.default().directory,
            expanded,
          )
          if (!sessionID) {
            setPendingDirectory(directory)
            const location = await client.api.location.get({ location: { directory } }).catch((error) => {
              toast.show({ title: "Failed to change directory", message: errorMessage(error), variant: "error" })
              return undefined
            })
            if (!location) {
              setPendingDirectory(undefined)
              return
            }
            if (sourceProjectID) directoryRecents.touch(sourceProjectID, location.directory)
            currentLocation.set(location)
            setPendingDirectory(undefined)
            return
          }
          const error = await client.api.session.move({ sessionID, directory: input }).then(
            () => undefined,
            (error) => error,
          )
          if (error) {
            toast.show({ title: "Failed to change directory", message: errorMessage(error), variant: "error" })
            return
          }
          if (sourceProjectID) directoryRecents.touch(sourceProjectID, directory)
        },
      },
    ],
  }))
  const [cursorVersion, setCursorVersion] = createSignal(0)
  const nudge = useNudge()
  const vim = useVim({
    input: () => input,
    disabled: () => props.disabled ?? false,
    autocompleteVisible: () => Boolean(auto()?.visible),
    getVimEnabled: () => Boolean(kv.get("vim_enabled", false)),
    bumpCursor: () => setCursorVersion((value) => value + 1),
    cursorVersion: () => cursorVersion(),
  })
  const currentProviderLabel = createMemo(() => local.model.parsed().provider)
  const hasRightContent = createMemo(() => Boolean(props.right))

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "Connect an integration to send prompts",
      duration: 3000,
    })
    if (!connected()) {
      dialog.replace(() => <DialogIntegration />)
    }
  }

  function dismissEditorContext() {
    setDismissedEditorSelectionKey(editorSelectionKey(editorContext()))
    editor.clearSelection()
  }
  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const skillStyleId = syntax().getStyleId("extmark.skill")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0
  const event = useEvent()

  event.on("tui.prompt.append", (evt, { directory }) => {
    if (directory !== (currentLocation.current?.directory ?? data.location.default().directory)) return
    if (!input || input.isDestroyed) return
    input.insertText(evt.data.text)
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.invalidateIntrinsicSize()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
    if (tuiConfig.cursor) input.cursorStyle = tuiConfig.cursor
  })

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m): m is UserMessage => m.role === "user")
  })

  const usage = createMemo(() => {
    if (!props.sessionID) return
    const session = sync.session.get(props.sessionID)
    const msg = sync.data.message[props.sessionID] ?? []
    const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return

    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const pct = model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : undefined
    const cost = session?.cost ?? 0
    return {
      context: pct !== undefined ? `${meter(pct)} ${Locale.number(tokens)} (${pct}%)` : Locale.number(tokens),
      cost: cost > 0 ? money.format(cost) : undefined,
    }
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell" | "btw"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: randomIndex(list().length),
    prompt: emptyPrompt(),
    mode: "normal",
    extmarkToPart: new Map(),
    interrupt: 0,
  })
  let disposed = false
  let pasteQueue = Promise.resolve()

  function enqueuePaste(run: (changed: () => boolean) => Promise<void>) {
    pasteQueue = pasteQueue
      .then(async () => {
        if (disposed || input.isDestroyed || disabled()) return
        const before = { sessionID: props.sessionID, mode: store.mode, text: input.plainText }
        await run(
          () =>
            disposed ||
            input.isDestroyed ||
            disabled() ||
            props.sessionID !== before.sessionID ||
            store.mode !== before.mode ||
            input.plainText !== before.text,
        )
      })
      .catch((error) => {
        if (!disposed) toast.error(error)
      })
    return pasteQueue
  }

  const imageAttachments = createMemo(() =>
    (deduplicatePromptImages(store.prompt.files) ?? []).filter((file) => file.uri.startsWith("data:image/")),
  )
  const imagePreviewHeight = createMemo(() => Math.max(4, Math.min(8, Math.floor(dimensions().height / 4))))
  const imagePreviewWidth = createMemo(() => imagePreviewHeight() * 2)
  const visibleImageAttachments = createMemo(() => imageAttachments().slice(0, 3))

  function openImagePreview(initial: number) {
    const images = imageAttachments()
    if (images.length === 0) return
    dialog.replace(() => <DialogImagePreview images={images} initial={initial} />)
  }

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", randomIndex(list().length))
      },
      { defer: true },
    ),
  )

  const promptCommands = createMemo(() =>
    [
      {
        title: "Clear prompt",
        name: "prompt.clear",
        category: "Prompt",
        palette: undefined,
        run: () => {
          clearPrompt()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        name: "prompt.submit",
        category: "Prompt",
        palette: undefined,
        run: async (_input: string | undefined, event?: KeyEvent) => {
          event?.preventDefault()
          event?.stopPropagation()
          if (!input.focused) return
          const handled = await submit()
          if (!handled) return

          dialog.clear()
        },
      },
      {
        title: "Queue prompt",
        name: "prompt.queue",
        category: "Prompt",
        run: async (_input: string | undefined, event?: KeyEvent) => {
          event?.preventDefault()
          event?.stopPropagation()
          if (!input.focused) return
          if (auto()?.visible && !auto()?.completeQueueableCommand()) return
          const handled = await submit("queue")
          if (!handled) return
          dialog.clear()
        },
      },
      {
        title: "Remove editor context",
        name: "prompt.editor_context.clear",
        category: "Prompt",
        enabled: Boolean(editorContext()),
        run: () => {
          dismissEditorContext()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        name: "prompt.paste",
        category: "Prompt",
        palette: undefined,
        run: (_input: string | undefined, event?: KeyEvent) => {
          event?.preventDefault()
          event?.stopPropagation()
          return enqueuePaste(async (changed) => {
            const content = await clipboard.read()
            if (changed()) return
            if (content?.mime.startsWith("image/")) {
              pasteAttachment({
                filename: "clipboard",
                uri: `data:${content.mime};base64,${content.data}`,
              })
              return
            }
            if (content?.mime === "text/plain") {
              await pasteInputText(content.data, changed)
            }
          })
        },
      },
      {
        title: "View image attachments",
        name: "prompt.images.view",
        category: "Prompt",
        enabled: imageAttachments().length > 0,
        run: () => openImagePreview(0),
      },
      {
        title: "Interrupt session",
        name: "session.interrupt",
        category: "Session",
        palette: undefined,
        enabled: status() === "running",
        run: () => {
          if (auto()?.visible) return
          if (!input.focused) return
          // TODO: this should be its own command
          if (store.mode !== "normal") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            void client.api.session.interrupt({
              sessionID: props.sessionID,
              resume: true,
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "Cost alert",
        desc: "Set a session cost alert",
        name: "cost_alert",
        category: "Session",
        slashName: "cost-alert",
        slashAliases: ["cost"],
        run: () => {
          costAlert.start()
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        name: "prompt.editor",
        slash: { name: "editor" },
        run: async () => {
          dialog.clear()

          const editorPrompt = expandPromptInputPastedText(store.prompt, store.prompt.pasted, renderer.widthMethod)
          const value = editorPrompt.text
          const content = await openEditor({
            renderer,
            value,
            cwd:
              (data.location.info()?.project.directory === "/" ? undefined : data.location.info()?.project.directory) ||
              data.location.default().directory ||
              paths.cwd,
          }).catch((error) => {
            toast.show({ title: "Failed to open editor", message: errorMessage(error), variant: "error" })
          })
          if (!content) return
          const normalized = normalizePromptContent(content)

          input.setText(normalized)

          setStore("prompt", {
            ...realignPromptInputMentions(normalized, editorPrompt, renderer.widthMethod),
            pasted: [],
          })
          restoreExtmarksFromPrompt(store.prompt)
          input.cursorOffset = measure(normalized)
        },
      },
      vimToggleCommand({
        vimEnabled: vim.vimEnabled,
        setVimEnabled: (value) => kv.set("vim_enabled", value),
        resetVim: vim.resetVim,
        clearDialog: () => dialog.clear(),
        showToast: (message) => toast.show({ message, variant: "info" }),
      }),
      {
        title: "Skills",
        name: "prompt.skills",
        category: "Prompt",
        slash: { name: "skills" },
        run: () => {
          dialog.replace(() => (
            <DialogSkill
              location={currentLocation.ref}
              onSelect={(skill) => {
                if (store.prompt.skills?.some((item) => item.id === skill)) return
                const text = `@${skill}`
                const start = input.cursorOffset
                const end = start + measure(text)
                input.insertText(text + " ")
                const extmarkId = input.extmarks.create({
                  start,
                  end,
                  virtual: true,
                  styleId: skillStyleId,
                  typeId: promptPartTypeId,
                })
                setStore(
                  produce((draft) => {
                    draft.prompt.text = input.plainText
                    const skills = (draft.prompt.skills ??= [])
                    const index = skills.length
                    skills.push({
                      id: Skill.ID.make(skill),
                      mention: { start, end, text },
                    })
                    draft.extmarkToPart.set(extmarkId, { type: "skill", index })
                  }),
                )
              }}
            />
          ))
        },
      },
      {
        title: "Warp",
        desc: "Change the workspace for the session",
        name: "workspace.set",
        category: "Session",
        enabled: Flag.BOLT_EXPERIMENTAL_WORKSPACES,
        slashName: "warp",
        run: () => {
          workspace.open()
        },
      },
      {
        title: "Move session",
        desc: "Move to another project dir",
        name: "session.move",
        category: "Session",
        slash: { name: "worktrees" },
        run: () => {
          move.open()
        },
      },
    ].map(
      ({ name, category, ...command }) =>
        ({
          id: name,
          group: category,
          bind: false,
          palette: true as const,
          ...command,
        }) satisfies KeymapCommand,
    ),
  )

  Keymap.createLayer(() => ({
    mode: "global",
    enabled: !disabled(),
    commands: promptCommands(),
  }))

  useBindings(() => ({
    mode: BOLT_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("prompt.palette", [
      "prompt.submit",
      "prompt.editor",
      "prompt.editor_context.clear",
      "prompt.images.view",
      "prompt.stash",
      "prompt.stash.pop",
      "prompt.stash.list",
      "prompt.skills",
      "prompt.vim.toggle",
      "session.interrupt",
      "session.background",
      "session.move",
    ],
  }))

  const ref: PromptRef = {
    get focused() {
      return !disabled() && input.focused
    },
    get current() {
      return store.prompt
    },
    get mode() {
      return store.mode
    },
    focus() {
      if (disabled()) return
      input.focus()
    },
    blur() {
      input.blur()
    },
    setMode(mode) {
      setStore("mode", mode)
    },
    set(prompt) {
      input.setText(prompt.text)
      setStore("prompt", prompt)
      restoreExtmarksFromPrompt(prompt)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
      // return to insert mode after the prompt is cleared
      vim.resetVim()
    },
    submit() {
      void submit()
    },
    aside() {
      setStore("mode", "btw")
      input.focus()
    },
    insert(text) {
      input.insertText(text)
      input.focus()
    },
  }

  function resetComposer() {
    input.extmarks.clear()
    setStore("prompt", emptyPrompt())
    setStore("extmarkToPart", new Map())
    input.clear()
  }

  // Captured once: the session route is keyed by sessionID, so this Prompt
  // instance belongs to exactly one tab. Reading props.sessionID lazily would
  // observe the *next* route during onCleanup and stash under the wrong tab.
  const stashSessionID = props.sessionID

  onMount(() => {
    const saved = takeDraft(stashSessionID)
    if (store.prompt.text) return
    if (saved && saved.prompt.text) {
      input.setText(saved.prompt.text)
      setStore("prompt", saved.prompt)
      restoreExtmarksFromPrompt(saved.prompt)
      input.cursorOffset = Math.min(saved.cursor, measure(saved.prompt.text))
    }
  })

  onCleanup(() => {
    disposed = true
    if (store.prompt.text) {
      saveDraft(stashSessionID, { prompt: unwrap(store.prompt), cursor: input.cursorOffset })
    }
    setInputTarget(undefined)
    props.ref?.(undefined)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.visible === false || disabled() || dialog.stack.length > 0) {
      if (input.focused) input.blur()
      input.focusable = false
      return
    }

    input.focusable = true
    // Slot/plugin updates can remount the background prompt while a dialog is open.
    // Keep focus with the dialog and let the prompt reclaim it after the dialog closes.
    if (!input.focused) input.focus()
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    input.traits = {
      ...input.traits,
      ...computePromptTraits({
        mode: store.mode,
        autocompleteVisible: !!auto()?.visible,
      }),
    }
  })

  function restoreExtmarksFromPrompt(prompt: PromptInfo) {
    input.extmarks.clear()
    setStore("extmarkToPart", new Map())

    const parts = [
      ...(prompt.files ?? []).map((part, index) => ({
        mention: part.mention,
        ref: { type: "file" as const, index },
        styleId: fileStyleId,
      })),
      ...(prompt.agents ?? []).map((part, index) => ({
        mention: part.mention,
        ref: { type: "agent" as const, index },
        styleId: agentStyleId,
      })),
      ...(prompt.skills ?? []).map((part, index) => ({
        mention: part.mention,
        ref: { type: "skill" as const, index },
        styleId: skillStyleId,
      })),
      ...prompt.pasted.map((part, index) => ({
        mention: part.source,
        ref: { type: "pasted" as const, index },
        styleId: pasteStyleId,
      })),
    ]

    parts.forEach(({ mention, ref, styleId }) => {
      if (mention?.text) {
        const extmarkId = input.extmarks.create({
          start: mention.start,
          end: mention.end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPart", (map: Map<number, PromptPartRef>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, ref)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, PromptPartRef>()
        const fileExtmarks = new Map<number, NonNullable<PromptInfo["files"]>[number]>()
        const files: NonNullable<PromptInfo["files"]> = []
        const agents: NonNullable<PromptInfo["agents"]> = []
        const skills: NonNullable<PromptInfo["skills"]> = []
        const pasted: PromptInfo["pasted"] = []

        for (const extmark of allExtmarks) {
          const ref = draft.extmarkToPart.get(extmark.id)
          if (!ref) continue
          if (ref.type === "file") {
            const part = draft.prompt.files?.[ref.index]
            if (!part?.mention) continue
            part.mention.start = extmark.start
            part.mention.end = extmark.end
            files.push(part)
            fileExtmarks.set(extmark.id, part)
            continue
          }
          if (ref.type === "agent") {
            const part = draft.prompt.agents?.[ref.index]
            if (!part?.mention) continue
            part.mention.start = extmark.start
            part.mention.end = extmark.end
            const index = agents.length
            agents.push(part)
            newMap.set(extmark.id, { type: "agent", index })
            continue
          }
          if (ref.type === "skill") {
            const part = draft.prompt.skills?.[ref.index]
            if (!part?.mention) continue
            part.mention.start = extmark.start
            part.mention.end = extmark.end
            const index = skills.length
            skills.push(part)
            newMap.set(extmark.id, { type: "skill", index })
            continue
          }
          const part = draft.prompt.pasted[ref.index]
          if (!part) continue
          part.source.start = extmark.start
          part.source.end = extmark.end
          const index = pasted.length
          pasted.push(part)
          newMap.set(extmark.id, { type: "pasted", index })
        }

        const nextFiles = preserveMentionlessPromptAttachments(draft.prompt.files, files)
        const fileIndices = new Map(nextFiles.map((file, index) => [file, index]))
        for (const [extmark, file] of fileExtmarks) {
          const index = fileIndices.get(file)
          if (index !== undefined) newMap.set(extmark, { type: "file", index })
        }

        draft.extmarkToPart = newMap
        if (
          nextFiles.length !== draft.prompt.files?.length ||
          nextFiles.some((file, index) => file !== draft.prompt.files?.[index])
        )
          draft.prompt.files = nextFiles
        draft.prompt.agents = agents
        draft.prompt.skills = skills
        draft.prompt.pasted = pasted
      }),
    )
  }

  const stashCommands = createMemo(() =>
    [
      {
        title: "Stash prompt",
        name: "prompt.stash",
        category: "Prompt",
        enabled: !!store.prompt.text,
        run: () => {
          if (!store.prompt.input) return
          stash.push({
            input: store.prompt.input,
            parts: store.prompt.parts,
          })
          input.extmarks.clear()
          input.clear()
          setStore("prompt", { input: "", parts: [] })
          setStore("extmarkToPartIndex", new Map())
          vim.resetVim()
          dialog.clear()
        },
      },
      {
        title: "Stash pop",
        name: "prompt.stash.pop",
        category: "Prompt",
        enabled: stash.list().length > 0,
        run: () => {
          const entry = stash.pop()
          if (entry) {
            input.setText(entry.prompt.text)
            setStore("prompt", entry.prompt)
            restoreExtmarksFromPrompt(entry.prompt)
            input.gotoBufferEnd()
            vim.resetVim()
          }
          dialog.clear()
        },
      },
      {
        title: "Stash list",
        name: "prompt.stash.list",
        category: "Prompt",
        enabled: stash.list().length > 0,
        run: () => {
          dialog.replace(() => (
            <DialogStash
              onSelect={(entry) => {
                input.setText(entry.prompt.text)
                setStore("prompt", entry.prompt)
                restoreExtmarksFromPrompt(entry.prompt)
                input.gotoBufferEnd()
                vim.resetVim()
              }}
            />
          ))
        },
      },
    ].map(
      ({ name, category, ...command }) =>
        ({
          id: name,
          group: category,
          bind: false,
          palette: true as const,
          ...command,
        }) satisfies KeymapCommand,
    ),
  )

  Keymap.createLayer(() => ({
    mode: "global",
    enabled: !disabled(),
    commands: stashCommands(),
  }))

  Keymap.createLayer(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && !disabled(),
      bindings: ["prompt.paste"],
    }
  })

  Keymap.createLayer(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && !disabled() && store.prompt.text !== "",
      bindings: ["prompt.clear"],
    }
  })

  Keymap.createLayer(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return (
          inputTarget() !== undefined &&
          !disabled() &&
          store.mode === "normal" &&
          !auto()?.visible &&
          input?.visualCursor.offset === 0
        )
      })(),
      commands: [
        {
          bind: "!",
          title: "Shell mode",
          group: "Prompt",
          run: () => {
            setStore("placeholder", randomIndex(shell().length))
            setStore("mode", "shell")
          },
        },
      ],
    }
  })

  Keymap.createLayer(() => {
    return {
      priority: 1,
      target: inputTarget,
      enabled: inputTarget() !== undefined && store.mode !== "normal",
      bindings: [{ key: "escape", desc: "Exit mode", group: "Prompt", cmd: () => setStore("mode", "normal") }],
    }
  })

  Keymap.createLayer(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && store.mode !== "normal" && input?.visualCursor.offset === 0
      })(),
      bindings: [{ key: "backspace", desc: "Exit mode", group: "Prompt", cmd: () => setStore("mode", "normal") }],
    }
  })

  Keymap.createLayer(() => {
    return {
      priority: 1,
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && !disabled() && !auto()?.visible && input !== undefined
      })(),
      commands: [
        {
          id: "prompt.history.previous",
          title: "Previous prompt history",
          group: "Prompt",
          run() {
            if (input.cursorOffset !== 0) {
              if (input.scrollY + input.visualCursor.visualRow === 0) {
                input.cursorOffset = 0
                return
              }
              input.moveCursorUp()
              return
            }

            const item = history.move(-1, input.plainText)
            if (!item) return false
            input.setText(item.text)
            setStore("prompt", item)
            setStore("mode", item.mode ?? "normal")
            restoreExtmarksFromParts(item.parts)
            // recalled history starts in insert mode
            vim.resetVim()
            input.cursorOffset = 0
          },
        },
      ],
    }
  })

  Keymap.createLayer(() => {
    return {
      priority: 1,
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && !disabled() && !auto()?.visible && input !== undefined
      })(),
      commands: [
        {
          id: "prompt.history.next",
          title: "Next prompt history",
          group: "Prompt",
          run() {
            const end = measure(input.plainText)
            if (input.cursorOffset !== end) {
              if (
                input.scrollY + input.visualCursor.visualRow ===
                Math.max(0, input.editorView.getTotalVirtualLineCount() - 1)
              ) {
                input.cursorOffset = end
                return
              }
              input.moveCursorDown()
              return
            }

            const item = history.move(1, input.plainText)
            if (!item) return false
            input.setText(item.text)
            setStore("prompt", item)
            setStore("mode", item.mode ?? "normal")
            restoreExtmarksFromParts(item.parts)
            // recalled history starts in insert mode
            vim.resetVim()
            input.cursorOffset = input.plainText.length
          },
        },
      ],
    }
  })

  let submitting = false
  async function submit(delivery: SessionInbox.Delivery = "steer") {
    if (disabled()) return false
    // Prevent overlapping invocations (e.g. a double-pressed Enter, or the
    // input's native onSubmit racing another dispatch). Without this guard,
    // a second call slips past the empty-input check before the first call
    // clears `store.prompt.text`, then awaits its own `session.create` and
    // ultimately reads the now-empty store — sending a phantom empty prompt
    // to a freshly created session.
    if (submitting) return false
    submitting = true
    try {
      return await submitInner(delivery)
    } finally {
      submitting = false
    }
  }

  async function submitInner(delivery: SessionInbox.Delivery) {
    // IME: double-defer may fire before onContentChange flushes the last
    // composed character (e.g. Korean hangul) to the store, so read
    // plainText directly and sync before any downstream reads.
    if (input && !input.isDestroyed && input.plainText !== store.prompt.text) {
      setStore("prompt", "text", input.plainText)
      syncExtmarksWithPromptParts()
    }
    if (move.creating()) return false
    if (auto()?.visible) return false
    if (!store.prompt.input) return false
    // in-memory cost alert command
    if (costAlert.handle(store.prompt.input.trim())) return true
    // client-side /memory command; never sent to the model
    if (parseMemoryCommand(store.prompt.input.trim())) {
      const text = store.prompt.input.trim()
      clearPrompt()
      void runMemoryCommand({
        text,
        client: sdk.client,
        sessionID: props.sessionID,
        toast,
        inspect: async (root) => {
          const { default: open } = await import("open")
          await open(root)
        },
        show: () => showMemoryDialog(dialog),
        status: () => showMemoryStatusDialog(dialog),
        usage: (reason) => showMemoryHelpDialog(dialog, { reason, sessionID: props.sessionID }),
      })
      return true
    }
    const agent = local.agent.current()
    if (!agent) return false
    const trimmed = store.prompt.input.trim()
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      void exit()
      return true
    }
    if (slash) {
      clearPrompt()
      await slash.command.run(slash.input)
      return true
    }
    const slashHead = parseSlashHead(inputText, /\s/)
    const isCommand =
      slashHead !== undefined &&
      (data.location.command.list(currentLocation.ref) ?? []).some((command) => command.name === slashHead.name)
    const editorSelection = editorContext()
    const pendingEditorSelection = editorSelection && editor.labelState() === "pending" ? editorSelection : undefined
    if (delivery === "queue" && pendingEditorSelection) {
      toast.show({ message: "Editor context cannot be queued", variant: "warning" })
      return false
    }
    const agent = local.agent.current()
    if (!agent) return false
    const selection = local.model.selection()
    if (!selection) {
      void promptModelWarning()
      return false
    }
    const usesModel = !props.sessionID || store.mode !== "shell"
    if (usesModel && !local.model.available(selection)) {
      toast.show({
        title: "Model unavailable",
        message: `${selection.providerID}/${selection.modelID} is not available in this session's location`,
        variant: "warning",
      })
      return false
    }

    // Snapshot the composer and clear it synchronously, before the first await.
    // Everything below reads the snapshot: text typed while a request is in
    // flight lands in the already-empty composer and survives, and prompt
    // history records exactly what was submitted instead of the live store
    // (which may have absorbed mid-flight typing). Failure paths restore the
    // snapshot unless the user has started typing something new.
    const currentMode = store.mode
    const entry = { ...store.prompt, mode: currentMode }
    if (trimmed) {
      resetComposer()
      props.onSubmit?.()
    }
    const restoreEntry = () => {
      if (disposed || input.isDestroyed || input.plainText !== "") return
      input.setText(entry.text)
      setStore("prompt", entry)
      setStore("mode", entry.mode ?? "normal")
      restoreExtmarksFromPrompt(entry)
      input.cursorOffset = measure(entry.text)
    }
    const fail = (title: string, error: unknown) => {
      toast.show({ title, message: errorMessage(error), variant: "error" })
      restoreEntry()
    }
    const attempt = async (title: string, run: () => Promise<unknown>) => {
      return run().then(
        () => true,
        (error: unknown) => {
          fail(title, error)
          return false
        },
      )
    }

    const variant = selection.variant
    let sessionID = props.sessionID
    let session = sessionID ? data.session.get(sessionID) : undefined
    let finishMoveProgress = false
    // New-session sends wait for creation and environment setup.
    let newSession: { gate: Promise<unknown>; recover: (error: unknown) => void } | undefined
    if (sessionID == null) {
      const directory = await move.getDirectory()
      if (move.pending() && !directory) {
        restoreEntry()
        return false
      }
      finishMoveProgress = Boolean(move.progress())
      // The location context is where the next session is created: seeded by the home
      // route (launch cwd, inherited session location, or picked project) and updated
      // by /cd before a session exists.
      const location = currentLocation.ref ?? data.location.default()

      // Optimistic create: the data layer mints the ID client-side and admits
      // a local session record synchronously, so the navigation below happens
      // immediately — enter feels sent even while the create round-trip is in
      // flight. Sends against the new session gate on the request.
      const newSessionID = args.takeNewSessionID()
      const created = data.session.create({
        id: newSessionID,
        location: directory ? { directory } : location,
        agent: agent.id,
        model: {
          providerID: selection.providerID,
          id: selection.modelID,
          variant,
        },
      })

      if (res.error) {
        if (finishMoveProgress) move.finishSubmit()
        console.log("Creating a session failed:", res.error)

        toast.show({
          message: "Creating a session failed. Open console for more details.",
          variant: "error",
        })

        return true
      }

      sessionID = res.data.id
    }

    const inputText = expandTrackedPastedText(
      store.prompt.input,
      input.extmarks.getAllForTypeId(promptPartTypeId).flatMap((extmark) => {
        const partIndex = store.extmarkToPartIndex.get(extmark.id)
        const part = partIndex === undefined ? undefined : store.prompt.parts[partIndex]
        if (part?.type !== "text") return []
        return [{ start: extmark.start, end: extmark.end, text: part.text }]
      }),
    )

    // Filter out text parts (pasted content) since they're now expanded inline
    const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")

    // Capture mode before it gets reset
    const currentMode = store.mode
    const editorSelection = editorContext()
    const editorParts =
      editorSelection && editor.labelState() === "pending"
        ? [
            {
              type: "text" as const,
              text: formatEditorContext(editorSelection),
              synthetic: true,
              metadata: {
                kind: "editor_context",
                source: editorSelection.source ?? "editor",
                filePath: editorSelection.filePath,
                ranges: editorSelection.ranges,
              },
            },
          ]
        : []

    if (store.mode === "btw") {
      // Sticky side-question mode: each submission becomes its own fork; the
      // mode stays active until esc so follow-ups don't need /btw again.
      if (!inputText.trim()) return true
      props.onAside?.(inputText)
    } else if (store.mode === "shell") {
      move.startSubmit()
      void sdk.client.session.shell({
        sessionID,
        agent: agent.name,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
        },
        command: inputText,
      })
      setStore("mode", "normal")
    } else if (
      inputText.startsWith("/") &&
      sync.data.command.some((x) => x.name === inputText.split("\n")[0].split(" ")[0].slice(1))
    ) {
      move.startSubmit()
      // Parse command from first line, preserve multi-line content in arguments
      const firstLineEnd = inputText.indexOf("\n")
      const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
      const [command, ...firstLineArgs] = firstLine.split(" ")
      const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
      const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")

      void sdk.client.session.command({
        sessionID,
        command: command.slice(1),
        arguments: args,
        agent: agent.name,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        variant,
        parts: nonTextParts.filter((x) => x.type === "file"),
      })
    } else {
      move.startSubmit()
      sdk.client.session
        .prompt(
          {
            sessionID,
            ...selectedModel,
            agent: agent.name,
            model: selectedModel,
            variant,
            // Yolo mode: permissions are auto-approved client-side, so tell
            // the model up front not to stop and ask for any.
            system:
              local.permission.mode === "auto"
                ? "Yolo mode is active: every permission request is granted automatically. Do not ask the user for permission or confirmation before acting; proceed directly."
                : undefined,
            parts: [
              ...editorParts,
              {
                type: "text",
                text: inputText,
              },
              ...nonTextParts,
            ],
          },
          { throwOnError: true },
        )
        .catch((error) => {
          toast.show({
            title: data.session.get(created.id) ? "Failed to set up session" : "Creating a session failed",
            message: errorMessage(error),
            variant: "error",
          })
          const active =
            route.data.type === "session" && route.data.sessionID === created.id ? promptRef.current : undefined
          const current = active?.current
          const draft = current?.text
            ? { prompt: { ...unwrap(current) }, cursor: Infinity }
            : (takeDraft(created.id) ?? { prompt: entry, cursor: Infinity })
          saveDraft(undefined, draft)
          active?.reset()
          if (sessionTabs.enabled()) {
            sessionTabs.close(created.id)
          } else if (route.data.type === "session" && route.data.sessionID === created.id) {
            route.navigate({ type: "home" })
          }
        },
      }
    }

    const target = sessionID
    const prepareAgent = async () => {
      if (!session) {
        await data.session.sync(target)
        session = data.session.get(target)
      }
      if (session?.agent !== agent.id) {
        await client.api.session.switchAgent({ sessionID: target, agent: agent.id })
      }
    }
    const commitModel = () => {
      const model = { providerID: selection.providerID, id: selection.modelID, variant }
      const cancelCommit = local.model.trackSessionCommit(target, model, agent.id)
      return client.api.session.switchModel({ sessionID: target, model }).catch((error) => {
        cancelCommit()
        throw new Error(`Failed to switch model: ${errorMessage(error)}`, { cause: error })
      })
    }
    const commitSelection = async () => {
      await prepareAgent()
      await commitModel()
    }
    if (!trimmed) {
      // Blank Enter in an existing session commits the composer's agent and
      // model selection, then hands off to the route (queued prompt promotion).
      await attempt("Failed to prepare session", async () => {
        await commitSelection()
        await props.onEmptySubmit?.()
      })
      return true
    }
    history.append(entry)
    if (currentMode === "shell") {
      move.startSubmit()
      const send = () => client.api.session.shell({ sessionID: target, command: inputText })
      void (newSession ? newSession.gate.then(send) : send()).catch((error) =>
        newSession ? newSession.recover(error) : fail("Failed to run shell command", error),
      )
      setStore("mode", "normal")
    } else if (slashHead && isCommand) {
      const send = async () => {
        // Commands inherit the composer selection; command-specific overrides
        // remain server-owned and run after this preparation.
        await commitSelection()
        return client.api.session.command({
          sessionID: target,
          name: slashHead.name,
          text: slashHead.arguments,
          files: entry.files,
          agents: entry.agents,
          skills: entry.skills?.length ? entry.skills : undefined,
          delivery,
        })
      }
      void (newSession ? newSession.gate.then(send) : send()).catch((error) =>
        newSession ? newSession.recover(error) : fail("Failed to run command", error),
      )
    } else {
      move.startSubmit()
      if (!(await attempt("Failed to prepare session", prepareAgent))) return true
      // Revert must settle before optimistic admission: its committed echo
      // splices every local row at or after the boundary, which would include
      // a freshly admitted prompt.
      if (
        session?.revert &&
        !(await attempt("Failed to commit revert", () => client.api.session.revert.commit({ sessionID: target })))
      )
        return false
      if (pendingEditorSelection) {
        // Keep editor context hidden while admitting it before the corresponding user prompt.
        const send = () =>
          client.api.session.synthetic({
            sessionID: target,
            text: formatEditorContext(pendingEditorSelection),
            resume: false,
          })
        // Fold into the setup gate so the context still admits before the
        // user prompt once the session exists.
        if (newSession) newSession.gate = newSession.gate.then(send)
        else if (!(await attempt("Failed to send editor context", send))) return false
      }
      // The data layer admits optimistically: the prompt renders immediately
      // and rolls back if the server rejects it, so submission does not wait
      // on the network. On rejection the row is already rolled back; restore
      // the composer unless the user has started typing something new.
      data.session
        .prompt({
          sessionID: target,
          text: inputText,
          files: entry.files,
          agents: entry.agents,
          skills: entry.skills?.length ? entry.skills : undefined,
          delivery,
          gate: newSession?.gate,
          // Commit the captured selection after earlier admissions, including
          // compaction setup. Cached state may still precede their SSE echoes;
          // the server makes an unchanged selection a no-op.
          prepare: commitModel,
        })
        .catch((error) => (newSession ? newSession.recover(error) : fail("Failed to send prompt", error)))
      if (pendingEditorSelection) editor.markSelectionSent()
    }

    // Optimistic admission puts the message in the store synchronously, so
    // the session view renders it on arrival.
    if (!props.sessionID) {
      if (pendingEditorSelection) editor.preserveSelectionFromNewSession()
      // Text typed while session creation was in flight lives in this (home)
      // prompt, which unmounts on navigation and would stash it under the
      // home key. Re-stash it under the new session so that composer restores
      // it, and clear it here so onCleanup does not also stash it for home.
      if (!disposed && !input.isDestroyed && store.prompt.text) {
        // Copy before clearing: unwrap returns the live store target, and the
        // resetComposer store write merges into that same object.
        saveDraft(sessionID, { prompt: { ...unwrap(store.prompt) }, cursor: input.cursorOffset })
        resetComposer()
      }
      route.navigate({
        type: "session",
        sessionID,
      })
    }
    if (finishMoveProgress) move.finishSubmit()
    return true
  }

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.cursorOffset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + measure(virtualText)

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const index = draft.prompt.pasted.length
        draft.prompt.pasted.push({
          text,
          source: { start: extmarkStart, end: extmarkEnd, text: virtualText },
        })
        draft.extmarkToPart.set(extmarkId, { type: "pasted", index })
      }),
    )
  }

  function expandPastedText(extmarkId: number) {
    const extmark = input.extmarks.get(extmarkId)
    const ref = store.extmarkToPart.get(extmarkId)
    if (!extmark || ref?.type !== "pasted") return false
    const part = store.prompt.pasted[ref.index]
    if (!part) return false

    input.extmarks.delete(extmarkId)
    input.setSelection(extmark.start, extmark.end)
    input.insertText(part.text)
    return true
  }

  async function pasteInputText(text: string, changed: () => boolean) {
    const normalizedText = stripAnsiSequences(text).replace(/\r\n?/g, "\n")
    const pastedContent = normalizedText.trim()
    const attachments = await resolvePastedAttachments(pastedContent, terminalEnvironment.platform)
    if (changed()) return
    if (attachments) {
      attachments.forEach((attachment) => {
        if (attachment.type === "text") {
          pasteText(attachment.content, `[SVG: ${attachment.filename || "image"}]`)
          return
        }
        pasteAttachment(attachment)
      })
      return
    }

    const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
    if ((lineCount >= 3 || pastedContent.length > 150) && config.prompt?.paste !== "full") {
      const extmark = input.extmarks.getAllForTypeId(promptPartTypeId).find((extmark) => {
        const ref = store.extmarkToPart.get(extmark.id)
        return (
          (extmark.end === input.cursorOffset || extmark.end + 1 === input.cursorOffset) &&
          ref?.type === "pasted" &&
          store.prompt.pasted[ref.index]?.text === pastedContent
        )
      })
      if (extmark && expandPastedText(extmark.id)) return
      pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
      return
    }

    input.insertText(normalizedText)

    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.invalidateIntrinsicSize()
      renderer.requestRender()
    }, 0)
  }

  function pasteAttachment(file: { filename?: string; uri: string }) {
    const currentOffset = input.cursorOffset
    const extmarkStart = currentOffset
    const virtualText = promptAttachmentLabel(store.prompt.files, { uri: file.uri, name: file.filename })
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: NonNullable<PromptInfo["files"]>[number] = {
      uri: file.uri,
      name: file.filename,
      mention: {
        start: extmarkStart,
        end: extmarkEnd,
        text: virtualText,
      },
    }
    setStore(
      produce((draft) => {
        const files = (draft.prompt.files ??= [])
        const index = files.length
        files.push(part)
        draft.extmarkToPart.set(extmarkId, { type: "file", index })
      }),
    )
  }

  function clearPrompt() {
    if (
      store.prompt.text.trim().length >= DRAFT_RETENTION_MIN_CHARS ||
      store.prompt.pasted.length > 0 ||
      (store.prompt.files?.length ?? 0) > 0 ||
      (store.prompt.agents?.length ?? 0) > 0
    ) {
      history.append({
        ...store.prompt,
        mode: store.mode,
      })
    }
    input.clear()
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    // don't leak stale vim mode/selection into an emptied prompt
    vim.resetVim()
  }

  // cost-alert logic lives in util/cost-alert; only prompt mutation stays here
  const costAlert = createCostAlertController({
    prefill: () => {
      const value = "/cost-alert "
      input.setText(value)
      setStore("prompt", { input: value, parts: [] })
      input.gotoBufferEnd()
    },
    clearPrompt,
    toast,
    nudge,
    sessionID: () => props.sessionID,
  })

  const highlight = createMemo(() => {
    if (leader()) return theme.border
    return theme.primary
  })

      const loading = data.location.agent.list(location) === undefined || !local.model.catalogReady
      const error = currentLocation.error
      const failed = error && locationKey(error.location) === locationKey(location)
      if (loading && !failed) return previous

      const agent = local.agent.current()
      const model = local.model.parsed()
      return {
        agentLabel: agent ? Locale.titlecase(agent.id) : undefined,
        agentColor: agent ? local.agent.color(agent.id) : undefined,
        modelLabel: model.model,
        providerLabel: model.provider,
        variant: local.model.variant.current(),
      }
    },
    {
      agentLabel: undefined,
      agentColor: undefined,
      modelLabel: local.model.parsed().model,
      providerLabel: local.model.parsed().provider,
      variant: undefined,
    },
  )
  const borderHighlight = createMemo(() => tint(theme.border, highlight(), agentMetaAlpha()))
  const fire = createMemo(
    () => animationsEnabled() && kv.get("fire_animation_enabled", true) && status().type !== "idle",
  )
  const flames = createFire(
    () => dimensions().width,
    fire,
    () => rgbToHex(theme.primary),
  )
  const placeholderText = createMemo(() => {
    const value = (() => {
      if (store.mode === "shell") {
        if (!shell().length) return undefined
        return `Run a command… "${shell()[store.placeholder % shell().length]}"`
      }
      if (!list().length) return undefined
      return `Ask anything… "${list()[store.placeholder % list().length]}"`
    })()
    if (!value) return undefined
    const width = dimensions().width < 44 ? dimensions().width - 5 : Math.min(75, dimensions().width - 4) - 5
    return Locale.takeWidth(value, Math.max(1, width)).trimEnd()
  })
  const footerLocation = createMemo(() => {
    if (!props.sessionID) {
      // No session yet: show where the next session will be created.
      return currentLocation.ref ?? data.location.default()
    }
    if (store.mode === "btw") return "Ask a side question... esc to exit"
    if (!list().length) return undefined
    return `Ask anything… "${list()[store.placeholder % list().length]}"`
  })

  const spinnerDef = createMemo(() => {
    const color = promptDisplay().agentColor ?? theme.border.base
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
    }
  })
  const maxHeight = createMemo(() => Math.max(6, Math.floor(dimensions().height / 3)))

  const promptBg = createMemo(() => theme.decrease(theme.background.raised.base))

  return (
    <>
      {/* Outside the anchor box on purpose: the autocomplete palette renders
          above the anchor, so keeping the fire out of it lets the palette sit
          flush against the input and cover the flames instead of floating
          above the whole strip. */}
      <Show when={props.visible !== false && fire()}>
        <FireStrip rows={flames()} />
      </Show>
      <box ref={(r: BoxRenderable) => (anchor = r)} visible={props.visible !== false} width="100%">
        <box
          width="100%"
          border={["left"]}
          borderColor={borderHighlight()}
          customBorderChars={{
            ...SplitBorder.customBorderChars,
            bottomLeft: "╹",
          }}
        >
          <box
            paddingLeft={dimensions().width < 44 ? 1 : 2}
            paddingRight={dimensions().width < 44 ? 1 : 2}
            paddingTop={1}
            flexShrink={0}
            backgroundColor={promptBg()}
            flexGrow={1}
            width="100%"
          >
            <Show when={config.prompt?.image_preview && visibleImageAttachments().length > 0}>
              <box
                width="100%"
                height={imagePreviewHeight() + 1}
                flexDirection="row"
                flexShrink={0}
                justifyContent="flex-start"
                gap={1}
                paddingBottom={1}
              >
                <For each={visibleImageAttachments()}>
                  {(file, index) => {
                    const [failed, setFailed] = createSignal(false)
                    return (
                      <box
                        width={imagePreviewWidth()}
                        height={imagePreviewHeight()}
                        flexBasis={imagePreviewWidth()}
                        flexShrink={1}
                        onMouseUp={(event: MouseEvent) => {
                          if (event.button !== 0) return
                          event.stopPropagation()
                          openImagePreview(index())
                        }}
                      >
                        <Show
                          when={!failed()}
                          fallback={
                            <box width="100%" height="100%" alignItems="center" justifyContent="center">
                              <text fg={theme.text.muted}>No preview</text>
                            </box>
                          }
                        >
                          <image
                            id={`prompt-image-preview-${index()}`}
                            source={file.uri}
                            fit="cover"
                            protocol="auto"
                            width="100%"
                            height="100%"
                            onError={() => setFailed(true)}
                          />
                        </Show>
                      </box>
                    )
                  }}
                </For>
                <Show when={imageAttachments().length > visibleImageAttachments().length}>
                  <box
                    width={8}
                    height={imagePreviewHeight()}
                    flexBasis={8}
                    flexShrink={1}
                    alignItems="center"
                    justifyContent="center"
                    onMouseUp={(event: MouseEvent) => {
                      if (event.button !== 0) return
                      event.stopPropagation()
                      openImagePreview(visibleImageAttachments().length)
                    }}
                  >
                    <text fg={theme.text.muted} wrapMode="none" truncate>
                      +{imageAttachments().length - visibleImageAttachments().length} more
                    </text>
                  </box>
                </Show>
              </box>
            </Show>
            <textarea
              width="100%"
              placeholder={placeholderText()}
              placeholderColor={theme.text.muted}
              textColor={muted() ? theme.text.muted : theme.text.base}
              focusedTextColor={muted() ? theme.text.muted : theme.text.base}
              minHeight={1}
              maxHeight={maxHeight()}
              cursorStyle={config.cursor}
              onContentChange={() => {
                const value = input.plainText
                setStore("prompt", "text", value)
                auto()?.onInput(value)
                syncExtmarksWithPromptParts()
                setCursorVersion((value) => value + 1)
              }}
              onCursorChange={() => setCursorVersion((value) => value + 1)}
              onKeyDown={(e: KeyEvent) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
                // route keys through the vim layer when enabled
                if (vim.vimOnKey(e)) {
                  e.preventDefault()
                  e.stopPropagation()
                  return
                }
              }}
              onSubmit={() => {
                if (disabled()) return
                // IME: double-defer so the last composed character (e.g. Korean
                // hangul) is flushed to plainText before we read it for submission.
                setTimeout(() => setTimeout(() => submit(), 0), 0)
              }}
              onPaste={(event: PasteEvent) => {
                if (disabled()) {
                  event.preventDefault()
                  return
                }

                // Normalize line endings at the boundary
                // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
                // Replace CRLF first, then any remaining CR
                const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n")

                // Windows Terminal <1.25 can surface image-only clipboard as an
                // empty bracketed paste. Windows Terminal 1.25+ does not.
                if (event.bytes.byteLength === 0) {
                  keymap.dispatch("prompt.paste")
                  return
                }

                // Once we cross an async boundary below, the terminal may perform its
                // default paste unless we suppress it first and handle insertion ourselves.
                event.preventDefault()

                void enqueuePaste((changed) => pasteInputText(normalizedText, changed))
              }}
              ref={(r: TextareaRenderable) => {
                input = r
                Object.assign(r, {
                  getClipboardText: (text: string) => expandPastedTextPlaceholders(text, store.prompt.pasted),
                })
                setInputTarget(r)
                if (promptPartTypeId === 0) {
                  promptPartTypeId = input.extmarks.registerType("prompt-part")
                }
                props.ref?.(ref)
                setTimeout(() => {
                  // setTimeout is a workaround and needs to be addressed properly
                  if (!input || input.isDestroyed) return
                  input.cursorColor = disabled() ? theme.background.raised.base : theme.text.base
                  if (config.cursor) input.cursorStyle = config.cursor
                }, 0)
              }}
              onMouseDown={(r: MouseEvent) => {
                if (disabled()) {
                  r.preventDefault()
                  return
                }
                if (r.button !== 0) return
                r.target?.focus()
                const extmark = input.extmarks
                  .getAtOffset(input.cursorOffset)
                  .find((item) => store.extmarkToPart.get(item.id)?.type === "pasted")
                if (!extmark || !expandPastedText(extmark.id)) return
                r.preventDefault()
                r.stopPropagation()
              }}
              focusedBackgroundColor="transparent"
              cursorColor={disabled() ? theme.background.raised.base : theme.text.base}
              syntaxStyle={syntax()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1} justifyContent="space-between">
              <box flexDirection="row" gap={1}>
                <Show when={local.agent.current()} fallback={<box height={1} />}>
                  {(agent) => (
                    <>
                      <text fg={fadeColor(highlight(), agentMetaAlpha())}>
                        {store.mode === "shell"
                          ? "Shell"
                          : store.mode === "btw"
                            ? "Btw"
                            : Locale.titlecase(agent().name)}
                      </text>
                      <Show when={store.mode === "normal" && local.permission.mode === "auto"}>
                        <text fg={fadeColor(theme.textMuted, agentMetaAlpha())}>auto</text>
                      </Show>
                      <VimModeIndicator
                        when={() => vim.vimEnabled() && store.mode !== "shell"}
                        mode={vim.vimMode}
                        fade={fadeColor}
                        textMuted={() => theme.textMuted}
                        info={() => theme.info}
                        warning={() => theme.warning}
                        success={() => theme.success}
                        alpha={agentMetaAlpha}
                      />
                      <Show when={store.mode === "normal"}>
                        <box flexDirection="row" gap={1}>
                          <text fg={fadeColor(theme.textMuted, modelMetaAlpha())}>·</text>
                          <text
                            flexShrink={0}
                            fg={fadeColor(leader() ? theme.textMuted : theme.text, modelMetaAlpha())}
                          >
                            {local.model.parsed().model}
                          </text>
                          <text fg={fadeColor(theme.textMuted, modelMetaAlpha())}>{currentProviderLabel()}</text>
                          <Show when={showVariant()}>
                            <text fg={fadeColor(theme.textMuted, variantMetaAlpha())}>·</text>
                            <text>
                              <span style={{ fg: fadeColor(theme.warning, variantMetaAlpha()), bold: true }}>
                                {local.model.variant.current()}
                              </span>
                            </text>
                          </Show>
                        </box>
                      </Show>
                    </>
                  )}
                </Show>
              </box>
              <Show when={hasRightContent()}>
                <box flexDirection="row" gap={1} alignItems="center">
                  {props.right}
                </box>
              </Show>
            </box>
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={borderHighlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: promptBg().a !== 0 ? "╹" : " ",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={promptBg()}
            customBorderChars={
              promptBg().a !== 0
                ? {
                    ...EmptyBorder,
                    horizontal: "▀",
                  }
                : {
                    ...EmptyBorder,
                    horizontal: " ",
                  }
            }
          />
        </box>
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <Switch>
            <Match when={voice.status() !== "idle"}>
              <box marginLeft={1} flexDirection="row" gap={1}>
                <Show
                  when={voice.status() === "recording"}
                  fallback={<Spinner color={theme.accent}>transcribing</Spinner>}
                >
                  <text fg={theme.error}>● recording</text>
                  <text fg={theme.textMuted}>/voice to stop</text>
                </Show>
              </box>
            </Match>
            <Match when={status().type !== "idle"}>
              <box
                flexGrow={1}
                flexShrink={1}
                minWidth={0}
                onSizeChange={function (this: BoxRenderable) {
                  const width = this.width
                  queueMicrotask(() => setLocationWidth(width))
                }}
              >
                <Switch>
                  <Match when={status() === "running"}>
                    <box flexDirection="row" gap={1} flexGrow={1} justifyContent="flex-start">
                      <box marginLeft={1}>
                        <Show when={config.animations ?? true} fallback={<text fg={theme.text.muted}>[⋯]</text>}>
                          <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                        </Show>
                      </box>
                      <PromptInterruptStatus
                        armed={store.interrupt > 0}
                        animations={animationsEnabled()}
                        text={theme.text.base}
                        subdued={theme.text.muted}
                        warning={theme.text.feedback.warning.base}
                        flash={theme.decrease(theme.text.feedback.warning.base, 2)}
                      />
                    </box>
                  </Match>
                  <Match when={move.progress()}>
                    {(progress) => (
                      <box paddingLeft={3} height={1} minHeight={0} flexShrink={1}>
                        <Spinner color={theme.hue.accent[500]}>
                          {progress()}
                          <span style={{ fg: theme.text.muted }}>{".".repeat(move.creatingDots())}</span>
                        </Spinner>
                      </box>
                    )}
                  </Match>
                  <Match when={move.pendingNew()}>
                    <box paddingLeft={3} height={1} minHeight={0} flexShrink={1}>
                      <text fg={theme.hue.accent[500]} wrapMode="none" truncate>
                        (new worktree)
                      </text>
                    </box>
                  </Match>
                  <Match when={true}>
                    <Show when={locationLabelDisplay()} fallback={<text />}>
                      {(location) => (
                        <text
                          id="prompt.footer.location"
                          fg={locationActions.hovered() ? theme.text.base : theme.text.muted}
                          wrapMode="none"
                          truncate
                          flexGrow={1}
                          flexShrink={1}
                          onMouseOver={locationActions.onMouseOver}
                          onMouseOut={locationActions.onMouseOut}
                          onMouseUp={locationActions.onMouseUp}
                        >
                          {location()}
                        </text>
                      )}
                    </Match>
                    <Match when={true}>
                      <text fg={theme.text}>
                        <span style={{ fg: theme.text, bg: theme.backgroundPanel, bold: true }}>
                          {"["}
                          {agentShortcut()}
                          {"]"}
                        </span>{" "}
                        <span style={{ fg: theme.textMuted }}>agents</span>
                      </text>
                    </Match>
                  </Switch>
                  <text fg={theme.text}>
                    <span style={{ fg: theme.text, bg: theme.backgroundPanel, bold: true }}>
                      {"["}
                      {paletteShortcut()}
                      {"]"}
                    </span>{" "}
                    <span style={{ fg: theme.textMuted }}>commands</span>
                  </text>
                </Match>
                <Match when={store.mode === "shell"}>
                  <text fg={theme.text}>
                    <span style={{ fg: theme.text, bg: theme.backgroundPanel, bold: true }}>[esc]</span>{" "}
                    <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                  </text>
                </Match>
              </Switch>
            </box>
          </Show>
        </box>
      </box>
      <Autocomplete
        sessionID={props.sessionID}
        argumentAutocomplete={(command) => (command.id === "session.cd" ? "directory" : undefined)}
        directoryOptions={(query): AutocompleteOption[] => {
          if (query !== "") return []
          const projectID =
            (props.sessionID ? data.session.get(props.sessionID)?.projectID : undefined) ??
            data.location.info()?.project.id
          if (!projectID) return []
          return directoryRecents.list(projectID).map((item) => {
            const value = directoryRecentValue(item.directory, paths.home)
            return {
              display: value,
              value,
              description: "recent",
              isDirectory: true,
              path: value,
              absolute: item.directory,
              destructive: {
                id: item.directory,
                confirm: "Press ctrl+d to confirm",
                run: () => directoryRecents.remove(projectID, item.directory),
              },
            }
          })
        }}
        ref={(r) => {
          setAuto(() => r)
        }}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(part, extmarkId) => {
          setStore("extmarkToPart", (map: Map<number, PromptPartRef>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, part)
            return newMap
          })
        }}
        value={store.prompt.text}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        skillStyleId={skillStyleId}
        hasSkill={(id) => store.prompt.skills?.some((skill) => skill.id === id) ?? false}
        promptPartTypeId={() => promptPartTypeId}
      />
    </>
  )
}
