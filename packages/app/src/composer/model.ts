import { ImagePreview } from "@opencode/ui/image-preview"
import { useDialog } from "@opencode/ui/context/dialog"
import type { ReferenceInfo } from "@opencode/client/promise"
import type { Links, MountedSession } from "@opencode/plugin/gui"
import { createComponent, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { Predicate } from "effect"
import type { ComposerSuggestion } from "./types"
import { createComposerEditor, createComposerEditorState, type ComposerEditorModel } from "./editor/interaction"
import { selectionFromLines, type SelectedLineRange, useFile } from "@/workspaces/files/model"
import { useComments } from "@/composer/comments"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { usePluginHost } from "@/runtime/plugin/host"
import { usePluginAttachment } from "@/runtime/plugin/host-apis"
import { usePlatform } from "@/runtime/platform/platform"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { readLocalImage } from "@/runtime/server/image"
import { showToast } from "@/shell/notifications/toast"
import { formatServerError } from "@/runtime/server/errors"
import { Skill } from "@opencode/schema/skill"
import { Session } from "@opencode/schema/session"
import { abort } from "@opencode/util/abort"
import { parseSessionMention } from "@opencode/util/session-mention"
import { createKnownServerSessions, createServerSessionEntries } from "@/shell/commands/palette"
import { matchesSessionTitle } from "./session-match"
import type { ComposerAdapter, ComposerControls, ComposerQueue } from "./adapter"
import { isAttachment } from "./prompt-parts"
import { isCommentItem } from "./state"
import type { PromptHistoryComment } from "./history/entry"
import { createComposerHistory } from "./history/store"
import { createComposerSubmit } from "./submit"
import { useAttachmentDestination } from "./attachments/destination"
import { parseClientSlashCommand } from "./client-slash-command"

export type ComposerModel = ComposerEditorModel & {
  readonly model: ComposerControls["model"]
}

const sendFailedTitle = {
  shell: "prompt.toast.shellSendFailed.title",
  command: "prompt.toast.commandSendFailed.title",
  prompt: "prompt.toast.promptSendFailed.title",
} as const

export function createComposerModel(adapter: ComposerAdapter, options?: { queue?: ComposerQueue }): ComposerModel {
  const sdk = useWorkspaceLocation()
  const data = useData()
  const server = useServer()

  const available = () =>
    server.conn.type !== "plugin" || !server.conn.managed || server.ctx.sdk.connection.status() === "connected"

  const files = useFile()
  const links = usePluginHost().links
  const plugins = usePluginAttachment()
  const comments = useComments()
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const prompt = adapter.state
  // Editor actions write the captured store directly, rather than going through the context methods.
  createEffect(
    on(
      () => prompt.context.items(),
      (items) => prompt.quoteSource.retain(items.map((item) => item.key)),
    ),
  )
  let editor: HTMLDivElement | undefined
  // A path attachment's image is read through the server, which can see both local and uploaded paths.
  const pathImages = new Map<string, Promise<string | undefined>>()
  const pathImageReads = new AbortController()
  onCleanup(() => {
    abort(pathImageReads)
    pathImages.forEach((url) => void url.then((value) => value && URL.revokeObjectURL(value)))
  })

  const interaction = createComposerEditorState(prompt.mode.current())
  createEffect(
    on(
      () => (adapter.ready() ? prompt.mode.current() : undefined),
      (mode) => {
        if (!mode) return
        // Project external draft changes without another mode write clearing restored retry metadata.
        interaction[1](mode === "shell" ? { mode, popover: { type: "closed" } } : { mode })
      },
    ),
  )
  const mode = () => interaction[0].mode
  const history = createComposerHistory()

  const recent = createMemo(() => {
    const all = plugins.files.opened()
    const active = plugins.files.active()

    return active ? [active, ...all.filter((path) => path !== active)] : all
  })

  const attachments = createMemo(() => prompt.current().filter(isAttachment))

  const commentCount = createMemo(() => {
    if (mode() === "shell") return 0

    return prompt.context.items().filter(isCommentItem).length
  })

  const blank = createMemo(() => {
    const text = prompt
      .current()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")

    return text.trim().length === 0 && attachments().length === 0 && commentCount() === 0
  })

  const stopping = createMemo(() => adapter.working() && blank())

  const placeholder = () => {
    if (mode() === "shell") return language.t("prompt.placeholder.shell", { example: "git status" })

    if (adapter.working() || (options?.queue?.count() ?? 0) > 0)
      return language.t("ui.promptInput.placeholder.followUp", { slash: "/", at: "@" })

    return language.t("ui.promptInput.placeholder.normal", { slash: "/", at: "@" })
  }

  const historyComments = () => {
    const byID = new Map(comments.all().map((item) => [`${item.file}\n${item.id}`, item] as const))

    return prompt.context.items().flatMap((item) => {
      const comment = item.comment?.trim()

      if (!comment || item.type !== "file") return []
      const selection = item.commentID ? byID.get(`${item.path}\n${item.commentID}`)?.selection : undefined

      const nextSelection =
        selection ??
        (item.selection
          ? ({ start: item.selection.startLine, end: item.selection.endLine } satisfies SelectedLineRange)
          : undefined)

      if (!nextSelection) return []

      return [
        {
          id: item.commentID ?? item.key,
          path: item.path,
          selection: { ...nextSelection },
          comment,
          time: item.commentID ? (byID.get(`${item.path}\n${item.commentID}`)?.time ?? Date.now()) : Date.now(),
          origin: item.commentOrigin,
          preview: item.preview,
        } satisfies PromptHistoryComment,
      ]
    })
  }

  const restoreHistoryComments = (items: PromptHistoryComment[]) => {
    comments.replace(
      items.map((item) => ({
        id: item.id,
        file: item.path,
        selection: { ...item.selection },
        comment: item.comment,
        time: item.time,
      })),
    )
    // History records file comments only; notes and quotes stay with the draft while it is browsed.
    prompt.context.replaceComments([
      ...prompt.context.items().filter((item) => item.type !== "file"),
      ...items.map((item) => ({
        type: "file" as const,
        path: item.path,
        selection: selectionFromLines(item.selection),
        comment: item.comment,
        commentID: item.id,
        commentOrigin: item.origin,
        preview: item.preview,
      })),
    ])
  }

  const referenceDescription = (reference: ReferenceInfo) =>
    reference.source.type === "git" ? reference.source.repository : reference.source.path

  const references = createMemo(() =>
    (data.location.reference.list({ directory: sdk().directory }) ?? [])
      .filter((reference) => !reference.hidden)
      .map((reference) => ({
        id: `reference:${reference.name}`,
        kind: "reference" as const,
        label: `@${reference.name}`,
        path: reference.path,
        description: reference.description ?? referenceDescription(reference),
        mention: {
          type: "file" as const,
          path: reference.path,
          content: `@${reference.name}`,
          start: 0,
          end: 0,
          mime: "application/x-directory",
          filename: reference.name,
        },
      })),
  )

  const skills = createMemo(() => data.location.skill.list({ directory: sdk().directory }) ?? [])

  let sessionSearch: string | undefined
  const [sessionSearched, setSessionSearched] = createSignal<string>()

  const sessions = createServerSessionEntries({
    server: server.key,
    known: createKnownServerSessions(server.ctx),
    projects: server.ctx.projects.list,
    load: async (search, signal) => {
      const page = await serverSDK.api.session.list({ parentID: null, search, archived: false, limit: 50 }, { signal })
      page.data.forEach(data.session.remember)

      return page
    },
    get: async (sessionID, signal) => {
      const session = await serverSDK.api.session.get({ sessionID }, { signal })
      data.session.remember(session)

      return session
    },
    untitled: () => language.t("command.session.new"),
    category: () => language.t("command.category.session"),
    recentCategory: () => language.t("palette.group.recentSessions"),
    recentLimit: 50,
  })

  const context = createMemo<ComposerSuggestion[]>(() => [
    ...references(),
    ...skills().map((skill) => ({
      id: `skill:${skill.id}`,
      kind: "skill" as const,
      label: `@${skill.id}`,
      description: skill.description,
      mention: {
        type: "skill" as const,
        id: Skill.ID.make(skill.id),
        name: Skill.Name.make(skill.name),
        content: `@${skill.id}`,
        start: 0,
        end: 0,
      },
    })),
    ...adapter
      .controls()
      .agents.available.filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map((agent) => ({
        id: `agent:${agent.name}`,
        kind: "agent" as const,
        label: `@${agent.name}`,
        mention: { type: "agent" as const, name: agent.name, content: `@${agent.name}`, start: 0, end: 0 },
      })),
    ...recent().map((path) => ({
      id: `file:${path}`,
      kind: "file" as const,
      label: path,
      path,
      recent: true,
      mention: { type: "file" as const, path, content: `@${path}`, start: 0, end: 0 },
    })),
  ])

  const slashCommands = createMemo(() => [
    ...(data.location.command.list({ directory: sdk().directory }) ?? []).map((item) => ({
      id: `custom.${item.name}`,
      trigger: item.name,
      title: item.name,
      description: item.description,
      type: "custom" as const,
    })),
    ...command.options
      .filter((item) => !item.disabled && !item.id.startsWith("suggested.") && item.slash)
      .map((item) => ({
        id: item.id,
        trigger: item.slash!,
        title: item.title,
        description: item.description,
        arguments: item.slashArguments,
        type: "builtin" as const,
      })),
  ])

  const commands = createMemo<ComposerSuggestion[]>(() => [
    ...slashCommands().map((item) => ({
      id: item.id,
      kind: "command" as const,
      label: `/${item.trigger}`,
      trigger: item.trigger,
      title: item.title,
      description: item.description,
      keybind: command.keybindParts(item.id),
    })),
  ])

  const variants = createMemo(() => ["default", ...adapter.controls().model.selection.variant.list()])

  const submission = createComposerSubmit({
    adapter,
    mode,
    commands: () => data.location.command.list({ directory: sdk().directory }),
    editor: () => editor,
    queueScroll: () => requestAnimationFrame(() => editor?.scrollIntoView({ block: "nearest" })),
    addToHistory: (value, mode) => controller.addHistory(value, mode),
    removeFromHistory: (value, mode, comments) => history.remove(value, mode, mode === "shell" ? [] : comments),
    resetHistory: () => controller.resetHistory(),
    setMode: (next) => controller.dispatch({ type: next === "shell" ? "mode.shell" : "mode.normal" }),
    closePopover: () => controller.dispatch({ type: "popover.close" }),
    delivery: (alternate) => {
      const queue = options?.queue

      if (!queue) return "steer"

      return (alternate ? queue.alternate() : queue.delivery()) ?? "steer"
    },
    notify: {
      missingSelection: () =>
        showToast({
          title: language.t("prompt.toast.modelAgentRequired.title"),
          description: language.t("prompt.toast.modelAgentRequired.description"),
        }),
      unqueueable: () => showToast({ title: language.t("prompt.toast.unqueueable.title") }),
      failed: (kind, error) =>
        showToast({
          title: language.t(sendFailedTitle[kind]),
          description:
            kind === "command"
              ? formatServerError(error, language.t, language.t("common.requestFailed"))
              : composerErrorMessage(language, error),
        }),
    },
    comments: {
      capture: historyComments,
      clear: comments.clear,
      restore: restoreHistoryComments,
    },
    clientCommand: (text) => {
      const selected = parseClientSlashCommand(slashCommands(), text)

      if (!selected) return

      // A command declines only keys, so a slash command's `false` means nothing more.
      return async () => {
        await command.trigger(selected.id, "slash", selected.input)
      }
    },
  })

  const controller = createComposerEditor({
    store: prompt.store,
    state: interaction,
    history: {
      entries: (mode) => history.entries(mode).map((entry) => ({ prompt: entry.prompt, metadata: entry.comments })),
      add: (value, mode) => history.add(value, mode, mode === "shell" ? [] : historyComments()),
      capture: historyComments,
      // SAFETY: `entries` stores each entry's comments as its metadata, and the editor restores only metadata it read there.
      restore: (metadata) => restoreHistoryComments(metadata as PromptHistoryComment[]),
    },
    commands,
    context,
    searchSessions: (query) => {
      if (interaction[0].popover.type !== "context") {
        // Closing aborts the search, so reopening on the same query must fetch again.
        sessionSearch = undefined

        return []
      }

      // The server narrows by the first word; the title match then needs the whole query.
      const search = firstWord(query)

      if (search !== sessionSearch) {
        sessionSearch = search
        void sessions.search(search).then(
          () => sessionSearch === search && setSessionSearched(search),
          () => sessionSearch === search && setSessionSearched(search),
        )
      }

      return sessions
        .items(search)
        .filter((entry) => !query || matchesSessionTitle(entry.title, query))
        .flatMap((entry): ComposerSuggestion[] => {
          if (adapter.kind === "active-session" && entry.sessionID === adapter.session().id) return []
          const mention = entry.sessionID && parseSessionMention(entry.sessionID)

          if (!mention) return []

          return [
            {
              id: `session:${mention.id}`,
              kind: "session",
              label: entry.title,
              description: entry.description,
              mention: {
                type: "session",
                id: Session.ID.make(mention.id),
                content: `@${entry.title}`,
                start: 0,
                end: 0,
              },
            },
          ]
        })
        .slice(0, query ? 8 : 5)
    },
    sessionsPending: (query) => sessionSearched() !== firstWord(query),
    searchContextFiles: async (query, signal) =>
      (await files.searchFilesAndDirectories(query, { signal })).map((path) => ({
        id: `file:${path}`,
        kind: "file",
        label: path,
        path,
        mention: { type: "file", path, content: `@${path}`, start: 0, end: 0 },
      })),
    onQuoteComment: (item, comment) => prompt.context.updateComment(item.commentID, { comment }),
    quoteComment: prompt.quoteComment,
    quoteSource: prompt.quoteSource,
    onContextRemove(item) {
      if (item.type === "file" && item.commentID) comments.remove(item.path, item.commentID)
    },
    openAttachment(attachment, origin) {
      void controller.previewAttachment(attachment).then((src) => {
        if (src) dialog.show(() => createComponent(ImagePreview, { src, alt: attachment.filename, origin }))
      })
    },
    readImage(path) {
      const existing = pathImages.get(path)

      if (existing) return existing

      const url = readLocalImage(serverSDK.api, sdk().directory, path, pathImageReads.signal)
        .then((blob) => blob && URL.createObjectURL(blob))
        .catch(() => undefined)

      pathImages.set(path, url)
      // A failed read retries the next time the attachment shows.
      void url.then((value) => value || pathImages.delete(path))

      return url
    },
    openContext(key) {
      const item = controller.contextItem(key)

      if (item?.type === "note") {
        // The plugin that attached the note reveals its subject.
        const href = item.live?.href ?? item.href

        if (href) links.open({ href, origin: item.origin, session: plugins.current() })

        return
      }

      if (item?.type === "file") openComment(item, links, plugins.current(), files, comments)
    },
    onEditor(element) {
      // SAFETY: the editor's only `setEditor` call passes its editable root, a `<div>` (`editor/editor.tsx`).
      editor = element as HTMLDivElement

      if (adapter.kind === "active-session") adapter.setEditor(editor)
    },
    onSuggestionSelect(item) {
      if (item.kind !== "command") return
      const selected = slashCommands().find((entry) => entry.id === item.id)

      if (!selected || selected.type === "custom") return

      if (selected.arguments) return

      return () => command.trigger(selected.id, "slash")
    },
    attachments: {
      picker: platform.openAttachmentPickerDialog,
      directory: () => sdk().directory,
      destination: useAttachmentDestination(adapter.controls),
      isDialogActive: () => !!dialog.active,
      duplicate: () => showToast({ title: language.t("prompt.toast.attachmentDuplicate.title") }),
      onUploadError: (error) =>
        showToast({
          variant: "error",
          title: language.t("prompt.toast.uploadFailed.title"),
          description: composerErrorMessage(language, error),
        }),
      onError: (error) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      readClipboardImage: platform.readClipboardImage,
      getPathForFile: platform.getPathForFile,
      onDragCancel: platform.onDragCancel,
      store: platform.draftStore?.putBlob,
    },
    view: {
      placeholder,
      get agent() {
        const agents = adapter.controls().agents

        return agents.visible && agents.options.length > 0
          ? {
              options: () => adapter.controls().agents.options.map((name) => ({ id: name, label: name })),
              current: () => adapter.controls().agents.current,
              onSelect: (value: string) => adapter.controls().agents.select(value),
              keybind: () => command.keybindParts("agent.cycle"),
            }
          : undefined
      },
      variant: {
        options: () => {
          const preview = adapter.controls().model.preview

          return (preview ? ["default", ...preview.variants] : variants()).map((value) => ({ id: value, label: value }))
        },
        current: () =>
          adapter.controls().model.preview?.variant ??
          adapter.controls().model.selection.variant.current() ??
          "default",
        onSelect: (value) => {
          if (adapter.controls().model.loading) return

          adapter.controls().model.selection.variant.set(value === "default" ? undefined : value)
        },
        keybind: () => command.keybindParts("model.variant.cycle"),
      },
      submit: {
        available,
        stopping,
        held: submission.held,
        working: adapter.working,
        queue: options?.queue,
        onSubmit: (submitOptions) => {
          if (!available()) return
          const queue = options?.queue

          if (queue?.undoing()) return

          // Confirming an edit re-admits the queued prompt instead of sending
          // the composer value as a new prompt. Enter keeps it queued in
          // place; the alternate action sends it as a steer.
          if (queue?.editing()) {
            queue.confirmEdit(submitOptions?.alternate ? "steer" : "queue")

            return
          }

          void submission.submit(new Event("submit"), submitOptions)
        },
        onStop: () => void submission.stop(),
      },
    },
  })

  Object.defineProperty(controller, "model", { get: () => adapter.controls().model })

  command.register("composer-editor", () => [
    {
      id: "file.attach",
      title: language.t("prompt.action.attachFile"),
      category: language.t("command.category.file"),
      keybind: "mod+u",
      editable: true,
      disabled: controller.state.mode !== "normal",
      onSelect: () => controller.attach(),
    },
    {
      id: "prompt.mode.shell",
      title: language.t("command.prompt.mode.shell"),
      category: language.t("command.category.session"),
      keybind: "mod+shift+x",
      disabled: controller.state.mode === "shell",
      onSelect: () => void controller.dispatch({ type: "mode.shell" }),
    },
    {
      id: "prompt.mode.normal",
      title: language.t("command.prompt.mode.normal"),
      category: language.t("command.category.session"),
      keybind: "mod+shift+e",
      disabled: controller.state.mode === "normal",
      onSelect: () => void controller.dispatch({ type: "mode.normal" }),
    },
  ])

  // SAFETY: the `model` getter defined on the controller above completes `ComposerModel`.
  return controller as ComposerModel
}

function composerErrorMessage(language: ReturnType<typeof useLanguage>, cause: unknown) {
  if (Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)) return cause.message

  if (
    Predicate.hasProperty(cause, "data") &&
    Predicate.hasProperty(cause.data, "message") &&
    Predicate.isString(cause.data.message) &&
    cause.data.message
  )
    return cause.data.message

  return language.t("common.requestFailed")
}

function openComment(
  item: { path: string; commentID?: string; commentOrigin?: "review" | "file" },
  links: Links,
  session: MountedSession | undefined,
  files: ReturnType<typeof useFile>,
  comments: ReturnType<typeof useComments>,
) {
  if (!item.commentID) return
  const focus = { file: item.path, id: item.commentID }
  comments.setActive(focus)

  const queueFocus = (attempts = 6) => {
    requestAnimationFrame(() => {
      comments.setFocus({ ...focus })

      if (attempts <= 0) return
      requestAnimationFrame(() => {
        const current = comments.focus()

        if (current?.file === focus.file && current.id === focus.id) queueFocus(attempts - 1)
      })
    })
  }

  // The plugin that owns the comment's origin reveals it (the review diff or a file tab), keeping the conversation.
  links.open({ href: item.path, origin: item.commentOrigin, exact: true, background: true, session })

  if (item.commentOrigin === "review") return queueFocus()
  void Promise.resolve(files.load(item.path)).finally(() => queueFocus())
}

function firstWord(query: string) {
  return query.toLowerCase().split(" ")[0] ?? ""
}
