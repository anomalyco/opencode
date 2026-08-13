import {
  BoxRenderable,
  RGBA,
  TextareaRenderable,
  MouseEvent,
  PasteEvent,
  decodePasteBytes,
  type ColorInput,
  type KeyEvent,
} from "@opentui/core"
import { createEffect, createMemo, onMount, createSignal, onCleanup, on, Show, Switch, Match, For } from "solid-js"
import path from "path"
import { useLocal } from "../../context/local"
import { useTheme, useThemes } from "../../context/theme"
import { tint } from "../../theme/color"
import { EmptyBorder, SplitBorder } from "../../ui/border"
import { useTuiPaths, useTuiTerminalEnvironment } from "../../context/runtime"
import { useClipboard } from "../../context/clipboard"
import { Spinner } from "../spinner"
import { useClient } from "../../context/client"
import { useRoute } from "../../context/route"
import { useEvent } from "../../context/event"
import { editorSelectionKey, useEditorContext, type EditorSelection } from "../../context/editor"
import { normalizePromptContent, openEditor } from "../../editor"
import { useExit } from "../../context/exit"
import { promptOffsetWidth } from "../../prompt/display"
import { expandPromptInputPastedText, realignPromptInputMentions } from "../../prompt/mention"
import { parseSlashHead } from "../../prompt/parse"
import { stringWidth } from "../../util/string-width"
import { createStore, produce, unwrap } from "solid-js/store"
import { emptyPrompt, usePromptHistory, type PromptInfo, type PromptPartRef } from "../../prompt/history"
import { saveDraft, takeDraft } from "./draft-stash"
import { Skill } from "@opencode-ai/schema/skill"
import { computePromptTraits } from "../../prompt/traits"
import { expandPastedTextPlaceholders, expandTrackedPastedText } from "../../prompt/part"
import { usePromptStash } from "../../prompt/stash"
import { DialogStash } from "../dialog-stash"
import { type AutocompleteOption, type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { Locale } from "../../util/locale"
import { errorMessage } from "../../util/error"
import { createColors, createFrames } from "../../ui/spinner"
import { useDialog } from "../../ui/dialog"
import { DialogIntegration } from "../dialog-integration"
import { useConnected } from "../use-connected"
import { useToast } from "../../ui/toast"
import { createFadeIn } from "../../util/signal"
import { DialogSkill } from "../dialog-skill"
import { useArgs } from "../../context/args"
import { useConfig } from "../../config"
import { usePromptMove } from "./move"
import {
  normalizePastedFilepath,
  parsePastedFilepaths,
  readLocalAttachment,
  MAX_LOCAL_ATTACHMENT_BYTES,
  type LocalAttachment,
} from "./local-attachment"
import { useData } from "../../context/data"
import { useLocation } from "../../context/location"
import { Keymap, type KeymapCommand } from "../../context/keymap"
import { abbreviateHome } from "../../runtime"
import { Slot } from "../../plugin/render"
import type { SessionInbox } from "@opencode-ai/schema/session-inbox"
import {
  deduplicatePromptImages,
  preserveMentionlessPromptAttachments,
  promptAttachmentLabel,
} from "../../prompt/attachment"
import { DialogImagePreview } from "../dialog-image-preview"
import { useDirectoryRecents } from "../../prompt/directory-recents"
import { directoryRecentValue } from "../../prompt/directory-completion"

export type PromptProps = {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  onEmptySubmit?: () => boolean | Promise<boolean>
  ref?: (ref: PromptRef | undefined) => void
  hint?: JSX.Element
  right?: JSX.Element
  showPlaceholder?: boolean
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

const DRAFT_RETENTION_MIN_CHARS = 20

function randomIndex(count: number) {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}

function fadeColor(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

export function PromptInterruptStatus(props: {
  armed: boolean
  text: ColorInput
  subdued: ColorInput
  warning: ColorInput
}) {
  return (
    <text fg={props.armed ? props.warning : props.text} wrapMode="none" truncate flexShrink={1}>
      esc{" "}
      <span style={{ fg: props.armed ? props.warning : props.subdued }}>
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

  const leader = Keymap.useLeaderActive()
  const local = useLocal()
  const args = useArgs()
  const paths = useTuiPaths()
  const terminalEnvironment = useTuiTerminalEnvironment()
  const clipboard = useClipboard()
  const client = useClient()
  const editor = useEditorContext()
  const route = useRoute()
  const data = useData()
  const directoryRecents = useDirectoryRecents()
  const keymapCommands = Keymap.useCommands()
  const currentLocation = useLocation()
  const config = useConfig().data
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => data.session.status(props.sessionID ?? ""))
  const history = usePromptHistory()
  const stash = usePromptStash()
  const keymap = Keymap.use()
  const renderer = useRenderer()
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
  Keymap.createLayer(() => ({
    mode: "global",
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
            const location = await client.api.location.get({ location: { directory } }).catch((error) => {
              toast.show({ title: "Failed to change directory", message: errorMessage(error), variant: "error" })
              return undefined
            })
            if (!location) return
            if (sourceProjectID) directoryRecents.touch(sourceProjectID, location.directory)
            currentLocation.set(location)
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
  const currentProviderLabel = createMemo(() => local.model.parsed().provider)
  const connected = useConnected()
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

  event.on("tui.prompt.append", (evt, { workspace }) => {
    if (workspace !== (currentLocation.current?.workspaceID ?? data.location.default().workspaceID)) return
    if (!input || input.isDestroyed) return
    input.insertText(evt.data.text)
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.disabled) input.cursorColor = theme.background.surface.offset
    if (!props.disabled) input.cursorColor = theme.text.default
    if (config.cursor) input.cursorStyle = config.cursor
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPart: Map<number, PromptPartRef>
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
        if (disposed || input.isDestroyed) return
        const before = { sessionID: props.sessionID, mode: store.mode, text: input.plainText }
        await run(
          () =>
            disposed ||
            input.isDestroyed ||
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

  // Initialize agent/model/variant from the durable V2 Session state.
  let syncedSessionID: string | undefined
  createEffect(() => {
    const sessionID = props.sessionID
    if (!sessionID || sessionID === syncedSessionID || !local.model.ready) return
    const session = data.session.get(sessionID)
    if (!session) return
    const agent = session.agent && local.agent.list().find((agent) => agent.id === session.agent)
    if (agent && !args.agent) local.agent.set(agent.id)
    syncedSessionID = sessionID
  })

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
        palette: undefined,
        run: async (_input: string | undefined, event?: KeyEvent) => {
          event?.preventDefault()
          event?.stopPropagation()
          if (!input.focused) return
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
          if (store.mode === "shell") {
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
              continue: true,
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "Background blocking tools",
        name: "session.background",
        category: "Session",
        palette: undefined,
        enabled: status() === "running",
        run: () => {
          if (auto()?.visible) return
          if (!input.focused) return
          if (!props.sessionID) return

          void client.api.session.background({
            sessionID: props.sessionID,
          })
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

          const editorPrompt = expandPromptInputPastedText(store.prompt, store.prompt.pasted)
          const value = editorPrompt.text
          const content = await openEditor({
            renderer,
            value,
            cwd:
              (data.location.info()?.project.directory === "/" ? undefined : data.location.info()?.project.directory) ||
              data.location.default().directory ||
              paths.cwd,
          })
          if (!content) return
          const normalized = normalizePromptContent(content)

          input.setText(normalized)

          setStore("prompt", {
            ...realignPromptInputMentions(normalized, editorPrompt),
            pasted: [],
          })
          restoreExtmarksFromPrompt(store.prompt)
          input.cursorOffset = stringWidth(normalized)
        },
      },
      {
        title: "Skills",
        name: "prompt.skills",
        category: "Prompt",
        slash: { name: "skills" },
        run: () => {
          dialog.replace(() => (
            <DialogSkill
              location={currentLocation.current}
              onSelect={(skill) => {
                if (store.prompt.skills?.some((item) => item.id === skill)) return
                const text = `/${skill}`
                const start = input.cursorOffset
                input.insertText(text + " ")
                const extmarkId = input.extmarks.create({
                  start,
                  end: start + promptOffsetWidth(text),
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
                      mention: { start, end: start + promptOffsetWidth(text), text },
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
        title: "Move session",
        desc: "Move to another project dir",
        name: "session.move",
        category: "Session",
        slash: { name: "move" },
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
    commands: promptCommands(),
  }))

  Keymap.createLayer(() => ({
    priority: 1,
    bindings: ["prompt.queue"],
  }))

  Keymap.createLayer(() => ({
    bindings: [
      "prompt.submit",
      "prompt.editor",
      "prompt.editor_context.clear",
      "prompt.images.view",
      "prompt.stash",
      "prompt.stash.pop",
      "prompt.stash.list",
      "prompt.skills",
      "session.interrupt",
      "session.background",
      "session.move",
    ],
  }))

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
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
      setStore("prompt", emptyPrompt())
      setStore("extmarkToPart", new Map())
    },
    submit() {
      void submit()
    },
  }

  // Captured once: the session route is keyed by sessionID, so this Prompt
  // instance belongs to exactly one tab. Reading props.sessionID lazily would
  // observe the *next* route during onCleanup and stash under the wrong tab.
  const stashSessionID = props.sessionID
  const stashKey = () => (config.experimental?.tab_drafts === true ? (stashSessionID ?? "home") : undefined)

  onMount(() => {
    const saved = takeDraft(stashKey())
    if (store.prompt.text) return
    if (saved && saved.prompt.text) {
      input.setText(saved.prompt.text)
      setStore("prompt", saved.prompt)
      restoreExtmarksFromPrompt(saved.prompt)
      input.cursorOffset = saved.cursor
    }
  })

  onCleanup(() => {
    disposed = true
    if (store.prompt.text) {
      saveDraft(stashKey(), { prompt: unwrap(store.prompt), cursor: input.cursorOffset })
    }
    setInputTarget(undefined)
    props.ref?.(undefined)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.visible === false || props.disabled || dialog.stack.length > 0) {
      if (input.focused) input.blur()
      return
    }

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
          if (!store.prompt.text) return
          stash.push({ prompt: store.prompt })
          input.extmarks.clear()
          input.clear()
          setStore("prompt", emptyPrompt())
          setStore("extmarkToPart", new Map())
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
    commands: stashCommands(),
  }))

  Keymap.createLayer(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && !props.disabled,
      bindings: ["prompt.paste"],
    }
  })

  Keymap.createLayer(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && !props.disabled && store.prompt.text !== "",
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
          !props.disabled &&
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
      target: inputTarget,
      enabled: inputTarget() !== undefined && store.mode === "shell",
      commands: [{ bind: "escape", title: "Exit shell mode", group: "Prompt", run: () => setStore("mode", "normal") }],
    }
  })

  Keymap.createLayer(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && store.mode === "shell" && input?.visualCursor.offset === 0
      })(),
      commands: [
        { bind: "backspace", title: "Exit shell mode", group: "Prompt", run: () => setStore("mode", "normal") },
      ],
    }
  })

  Keymap.createLayer(() => {
    return {
      priority: 1,
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && !props.disabled && !auto()?.visible && input !== undefined
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
            restoreExtmarksFromPrompt(item)
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
        return inputTarget() !== undefined && !props.disabled && !auto()?.visible && input !== undefined
      })(),
      commands: [
        {
          id: "prompt.history.next",
          title: "Next prompt history",
          group: "Prompt",
          run() {
            if (input.cursorOffset !== input.plainText.length) {
              if (
                input.scrollY + input.visualCursor.visualRow ===
                Math.max(0, input.editorView.getTotalVirtualLineCount() - 1)
              ) {
                input.cursorOffset = input.plainText.length
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
            restoreExtmarksFromPrompt(item)
            input.cursorOffset = input.plainText.length
          },
        },
      ],
    }
  })

  let submitting = false
  async function submit(delivery: SessionInbox.Delivery = "steer") {
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
    if (props.disabled) return false
    if (move.creating()) return false
    if (auto()?.visible) return false
    const trimmed = store.prompt.text.trim()
    if (!trimmed) return delivery === "steer" ? (await props.onEmptySubmit?.()) === true : false
    if (
      delivery === "queue" &&
      (store.mode === "shell" || trimmed === "exit" || trimmed === "quit" || trimmed === ":q")
    ) {
      toast.show({ message: "This prompt cannot be queued", variant: "warning" })
      return false
    }
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      void exit()
      return true
    }
    const slash = argumentSlash(store.prompt.text, keymapCommands())
    if (slash) {
      if (delivery === "queue") {
        toast.show({ message: "This prompt cannot be queued", variant: "warning" })
        return false
      }
      clearPrompt()
      await slash.command.run(slash.input)
      return true
    }
    const inputText = expandTrackedPastedText(
      store.prompt.text,
      input.extmarks.getAllForTypeId(promptPartTypeId).flatMap((extmark) => {
        const ref = store.extmarkToPart.get(extmark.id)
        if (ref?.type !== "pasted") return []
        const part = store.prompt.pasted[ref.index]
        if (!part) return []
        return [{ start: extmark.start, end: extmark.end, text: part.text }]
      }),
    )
    const slashHead = parseSlashHead(inputText, /\s/)
    const isSkill =
      !(store.prompt.skills?.length ?? 0) &&
      slashHead !== undefined &&
      (data.location.skill.list(currentLocation.ref) ?? []).some(
        (skill) => skill.slash === true && skill.id === slashHead.name,
      )
    const isCommand =
      slashHead !== undefined &&
      (data.location.command.list(currentLocation.ref) ?? []).some((command) => command.name === slashHead.name)
    if (delivery === "queue" && isSkill) {
      toast.show({ message: "Skills cannot be queued", variant: "warning" })
      return false
    }
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
    const usesModel = !props.sessionID || (store.mode !== "shell" && !isSkill)
    if (usesModel && !local.model.available(selection)) {
      toast.show({
        title: "Model unavailable",
        message: `${selection.providerID}/${selection.modelID} is not available in this session's location`,
        variant: "warning",
      })
      return false
    }

    const variant = selection.variant
    let sessionID = props.sessionID
    let session = sessionID ? data.session.get(sessionID) : undefined
    let finishMoveProgress = false
    if (sessionID == null) {
      const directory = await move.getDirectory()
      if (move.pending() && !directory) return false
      finishMoveProgress = Boolean(move.progress())
      // The location context is where the next session is created: seeded by the home
      // route (launch cwd, inherited session location, or picked project) and updated
      // by /cd before a session exists.
      const location = currentLocation.ref ?? data.location.default()

      const created = await client.api.session
        .create({
          location: directory ? { directory } : location,
          agent: agent.id,
          model: {
            providerID: selection.providerID,
            id: selection.modelID,
            variant,
          },
        })
        .catch(() => undefined)

      if (!created) {
        if (finishMoveProgress) move.finishSubmit()
        toast.show({
          message: "Creating a session failed. Open console for more details.",
          variant: "error",
        })

        return true
      }

      sessionID = created.id
      session = created
    }

    // Capture mode before it gets reset
    const currentMode = store.mode
    if (store.mode === "shell") {
      move.startSubmit()
      void client.api.session.shell({
        sessionID,
        command: inputText,
      })
      setStore("mode", "normal")
    } else if (slashHead && isCommand) {
      move.startSubmit()
      const model = { providerID: selection.providerID, id: selection.modelID, variant }
      const cancelCommit = local.model.trackSessionCommit(sessionID, model)

      void client.api.session
        .command({
          sessionID,
          command: slashHead.name,
          arguments: slashHead.arguments,
          agent: agent.id,
          model,
          files: store.prompt.files,
          agents: store.prompt.agents,
          skills: store.prompt.skills?.length ? store.prompt.skills : undefined,
          delivery,
        })
        .catch((error) => {
          cancelCommit()
          toast.show({ title: "Failed to run command", message: errorMessage(error), variant: "error" })
        })
    } else if (isSkill) {
      move.startSubmit()
      void client.api.session.skill({
        sessionID,
        skill: slashHead.name,
      })
    } else {
      move.startSubmit()
      if (!session) {
        await data.session.sync(sessionID)
        session = data.session.get(sessionID)
      }
      if (session?.agent !== agent.id) {
        await client.api.session.switchAgent({ sessionID, agent: agent.id })
      }
      if (
        session?.model?.providerID !== selection.providerID ||
        session.model.id !== selection.modelID ||
        (session.model.variant ?? "default") !== (variant ?? "default")
      ) {
        const model = { providerID: selection.providerID, id: selection.modelID, variant }
        const cancelCommit = local.model.trackSessionCommit(sessionID, model)
        await client.api.session.switchModel({ sessionID, model }).catch((error) => {
          cancelCommit()
          throw error
        })
      }
      if (session?.revert) {
        const error = await client.api.session.revert.commit({ sessionID }).then(
          () => undefined,
          (error) => error,
        )
        if (error) {
          toast.show({ title: "Failed to commit revert", message: errorMessage(error), variant: "error" })
          return false
        }
      }
      if (pendingEditorSelection) {
        // Keep editor context hidden while admitting it before the corresponding user prompt.
        const error = await client.api.session
          .synthetic({
            sessionID,
            text: formatEditorContext(pendingEditorSelection),
            resume: false,
          })
          .then(
            () => undefined,
            (error) => error,
          )
        if (error) {
          toast.show({ title: "Failed to send editor context", message: errorMessage(error), variant: "error" })
          return false
        }
      }
      const error = await client.api.session
        .prompt({
          sessionID,
          text: inputText,
          files: store.prompt.files,
          agents: store.prompt.agents,
          skills: store.prompt.skills?.length ? store.prompt.skills : undefined,
          delivery,
        })
        .then(
          () => undefined,
          (error) => error,
        )
      if (error) {
        toast.show({ title: "Failed to send prompt", message: errorMessage(error), variant: "error" })
        return false
      }
      if (pendingEditorSelection) editor.markSelectionSent()
    }
    history.append({
      ...store.prompt,
      mode: currentMode,
    })
    input.extmarks.clear()
    setStore("prompt", emptyPrompt())
    setStore("extmarkToPart", new Map())
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID) {
      if (pendingEditorSelection) editor.preserveSelectionFromNewSession()
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
    }
    input.clear()
    if (finishMoveProgress) move.finishSubmit()
    return true
  }

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.cursorOffset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + promptOffsetWidth(virtualText)

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
    const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const pastedContent = normalizedText.trim()
    const filepath = normalizePastedFilepath(pastedContent, terminalEnvironment.platform)
    const isUrl = /^(https?):\/\//.test(filepath)
    if (!isUrl) {
      const attachment = await readLocalAttachment(filepath)
      if (attachment) {
        if (changed()) return
        pasteLocalAttachment(filepath, attachment)
        return
      }

      const filepaths = parsePastedFilepaths(pastedContent, terminalEnvironment.platform)
      if (filepaths.length > 1) {
        let remaining = MAX_LOCAL_ATTACHMENT_BYTES
        const attachments: Array<{ filepath: string; attachment: LocalAttachment }> = []
        for (const candidate of filepaths) {
          const next = await readLocalAttachment(candidate, remaining)
          if (!next) break
          remaining -= typeof next.content === "string" ? Buffer.byteLength(next.content) : next.content.byteLength
          attachments.push({ filepath: candidate, attachment: next })
        }
        if (attachments.length === filepaths.length) {
          if (changed()) return
          for (const item of attachments) pasteLocalAttachment(item.filepath, item.attachment)
          return
        }
      }
    }

    if (changed()) return

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
      input.getLayoutNode().markDirty()
      renderer.requestRender()
    }, 0)
  }

  function pasteLocalAttachment(filepath: string, attachment: LocalAttachment) {
    const filename = path.basename(filepath)
    if (attachment.type === "text") {
      pasteText(attachment.content, `[SVG: ${filename || "image"}]`)
      return
    }
    pasteAttachment({
      filename,
      uri: `data:${attachment.mime};base64,${Buffer.from(attachment.content).toString("base64")}`,
    })
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
    setStore("prompt", emptyPrompt())
    setStore("extmarkToPart", new Map())
  }

  const highlight = createMemo(() => {
    if (leader()) return theme.border.default
    if (store.mode === "shell") return theme.text.action.primary.selected
    const agent = local.agent.current()
    if (!agent) return theme.border.default
    return local.agent.color(agent.id)
  })
  const agentLabel = createMemo(() => {
    if (store.mode === "shell") return "Shell"
    const agent = local.agent.current()
    return agent ? Locale.titlecase(agent.id) : undefined
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const agentMetaAlpha = createFadeIn(() => store.mode === "shell" || !!local.agent.current(), animationsEnabled)
  const modelMetaAlpha = createFadeIn(() => !!local.agent.current() && store.mode === "normal", animationsEnabled)
  const variantMetaAlpha = createFadeIn(
    () => !!local.agent.current() && store.mode === "normal" && showVariant(),
    animationsEnabled,
  )
  const borderHighlight = createMemo(() => tint(theme.border.default, highlight(), agentMetaAlpha()))
  const footerInput = () => ({ sessionID: props.sessionID, mode: store.mode })

  const placeholderText = createMemo(() => {
    if (props.showPlaceholder === false) return undefined
    const value = (() => {
      if (store.mode === "shell") {
        if (!shell().length) return undefined
        return `Run a command... "${shell()[store.placeholder % shell().length]}"`
      }
      if (!list().length) return undefined
      return `Ask anything... "${list()[store.placeholder % list().length]}"`
    })()
    if (!value) return undefined
    const width = dimensions().width < 44 ? dimensions().width - 5 : Math.min(75, dimensions().width - 4) - 5
    return Locale.takeWidth(value, Math.max(1, width)).trimEnd()
  })
  const locationLabel = createMemo(() => {
    if (!props.sessionID) {
      // No session yet: show where the next session will be created.
      const location = currentLocation.ref ?? data.location.default()
      const directory = abbreviateHome(location.directory, paths.home)
      const branch = data.location.vcs.info(location)?.branch.current
      return branch ? `${directory}:${branch}` : directory
    }
    if (status() !== "idle") return
    const location = data.session.get(props.sessionID)?.location
    if (!location) return
    const directory = abbreviateHome(location.directory, paths.home)
    const branch = data.location.vcs.info(location)?.branch.current
    return branch ? `${directory}:${branch}` : directory
  })

  const spinnerDef = createMemo(() => {
    const agent = status() === "running" ? local.agent.current() : local.agent.current()
    const color = agent ? local.agent.color(agent.id) : theme.border.default
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

  const promptBg = createMemo(() => theme.raise(theme.background.surface.offset))

  return (
    <>
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
                              <text fg={theme.text.subdued}>No preview</text>
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
                    <text fg={theme.text.subdued} wrapMode="none" truncate>
                      +{imageAttachments().length - visibleImageAttachments().length} more
                    </text>
                  </box>
                </Show>
              </box>
            </Show>
            <textarea
              width="100%"
              placeholder={placeholderText()}
              placeholderColor={theme.text.subdued}
              textColor={leader() ? theme.text.subdued : theme.text.default}
              focusedTextColor={leader() ? theme.text.subdued : theme.text.default}
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
              onKeyDown={(e: { preventDefault(): void }) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
              }}
              onSubmit={() => {
                // IME: double-defer so the last composed character (e.g. Korean
                // hangul) is flushed to plainText before we read it for submission.
                setTimeout(() => setTimeout(() => submit(), 0), 0)
              }}
              onPaste={(event: PasteEvent) => {
                if (props.disabled) {
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
                  input.cursorColor = theme.text.default
                  if (config.cursor) input.cursorStyle = config.cursor
                }, 0)
              }}
              onMouseDown={(r: MouseEvent) => {
                if (props.disabled || r.button !== 0) return
                r.target?.focus()
                const extmark = input.extmarks
                  .getAtOffset(input.cursorOffset)
                  .find((item) => store.extmarkToPart.get(item.id)?.type === "pasted")
                if (!extmark || !expandPastedText(extmark.id)) return
                r.preventDefault()
                r.stopPropagation()
              }}
              focusedBackgroundColor="transparent"
              cursorColor={props.disabled ? theme.background.surface.offset : theme.text.default}
              syntaxStyle={syntax()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1} justifyContent="space-between">
              <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
                <Show when={agentLabel()} fallback={<box height={1} />}>
                  {(label) => (
                    <>
                      <text fg={fadeColor(highlight(), agentMetaAlpha())}>{label()}</text>
                      <Show
                        when={store.mode === "normal" && local.permission.mode === "auto" && dimensions().width >= 44}
                      >
                        <text fg={fadeColor(theme.text.subdued, agentMetaAlpha())}>auto</text>
                      </Show>
                      <Show when={store.mode === "normal" && dimensions().width >= 28}>
                        <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
                          <text fg={fadeColor(theme.text.subdued, modelMetaAlpha())}>·</text>
                          <text
                            flexShrink={1}
                            minWidth={0}
                            wrapMode="none"
                            truncate
                            fg={fadeColor(leader() ? theme.text.subdued : theme.text.default, modelMetaAlpha())}
                          >
                            {local.model.parsed().model}
                          </text>
                          <Show when={dimensions().width >= 50}>
                            <text flexShrink={0} fg={fadeColor(theme.text.subdued, modelMetaAlpha())}>
                              {currentProviderLabel()}
                            </text>
                          </Show>
                          <Show when={showVariant() && dimensions().width >= 70}>
                            <text fg={fadeColor(theme.text.subdued, variantMetaAlpha())}>·</text>
                            <text>
                              <span
                                style={{
                                  fg: fadeColor(theme.text.feedback.warning.default, variantMetaAlpha()),
                                  bold: true,
                                }}
                              >
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
        <box width="100%" flexDirection="row" justifyContent="space-between" gap={2}>
          <Slot path="prompt.footer" input={footerInput()}>
            <Slot path="prompt.footer.status" input={footerInput()}>
              <box flexGrow={1} flexShrink={1} minWidth={0}>
                <Switch>
                  <Match when={status() === "running"}>
                    <box flexDirection="row" gap={1} flexGrow={1} justifyContent="flex-start">
                      <box marginLeft={1}>
                        <Show when={config.animations ?? true} fallback={<text fg={theme.text.subdued}>[⋯]</text>}>
                          <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                        </Show>
                      </box>
                      <PromptInterruptStatus
                        armed={store.interrupt > 0}
                        text={theme.text.default}
                        subdued={theme.text.subdued}
                        warning={theme.text.feedback.warning.default}
                      />
                    </box>
                  </Match>
                  <Match when={move.progress()}>
                    {(progress) => (
                      <box paddingLeft={3} height={1} minHeight={0} flexShrink={1}>
                        <Spinner color={theme.hue.accent[500]}>
                          {progress()}
                          <span style={{ fg: theme.text.subdued }}>{".".repeat(move.creatingDots())}</span>
                        </Spinner>
                      </box>
                    )}
                  </Match>
                  <Match when={move.pendingNew()}>
                    <box paddingLeft={3} height={1} minHeight={0} flexShrink={1}>
                      <text fg={theme.hue.accent[500]} wrapMode="none" truncate>
                        (new working copy)
                      </text>
                    </box>
                  </Match>
                  <Match when={true}>
                    <Show when={!props.hint && locationLabel()} fallback={props.hint ?? <text />}>
                      {(location) => (
                        <text fg={theme.text.subdued} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
                          {location()}
                        </text>
                      )}
                    </Show>
                  </Match>
                </Switch>
              </box>
            </Slot>
            <Slot path="prompt.footer.file" input={footerInput()}>
              <Show when={editorContextLabelState() !== "none" ? editorFileLabelDisplay() : undefined}>
                {(file) => (
                  <text
                    wrapMode="none"
                    truncate
                    flexShrink={1}
                    fg={editorContextLabelState() === "pending" ? theme.hue.accent[500] : theme.text.subdued}
                  >
                    {file()}
                  </text>
                )}
              </Show>
            </Slot>
          </Slot>
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
