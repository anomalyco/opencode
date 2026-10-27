import {
  batch,
  createMemo,
  createEffect,
  createRenderEffect,
  createRoot,
  createSignal,
  getOwner,
  on,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js"
import type {
  BackgroundTask,
  Comments,
  Composer,
  Files,
  LineRange,
  ServerRef,
  MountedSession,
  SessionScreen,
} from "@opencode/plugin/gui"
import { useComments } from "@/composer/comments"
import { createComposerEditorActions } from "@/composer/editor/actions"
import { useComposerState } from "@/composer/persistence"
import type { ComposerStateValue } from "@/composer/state"
import { useLocal } from "@/providers/models/selection"
import { useServer } from "@/runtime/server/current"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { sessionInWorkspace, sessionProject, type SessionModel } from "@/session/model"
import { useFile } from "@/workspaces/files/model"
import { useWorkspaceLocation } from "@/workspaces/location"
import { pathKey } from "@/workspaces/path-key"
import { usePluginAttachment } from "./host-apis"

const noTasks: readonly BackgroundTask[] = []

/** The root of the routed session's object, which ends when the screen routes another session. */
type ObjectRoot = { dispose?: () => void }

/**
 * The routed session as plugins see it: one frozen object per routed session, a new one each time the screen
 * routes another session, and the `SessionScreen` that owns the route-following files, comments and composer.
 */
export function createMountedSession(session: SessionModel) {
  const file = useFile()
  const comments = useComments()
  const composer = useComposerState()
  const local = useLocal()
  const server = useServer()
  const servers = useServers()
  const location = useWorkspaceLocation()
  const attachment = usePluginAttachment()
  // The composer region owns background tasks and is created after the view.
  const [background, setBackground] = createSignal<Accessor<readonly BackgroundTask[]>>()
  // The screen's composer view, created after this object, says whether it takes quotes and focuses its prompt.
  const [prompt, setPrompt] = createSignal<{ quotable: Accessor<boolean>; focus: () => void; focused: () => boolean }>()

  const serverRef: ServerRef = {
    get id() {
      return server.key
    },
    get name() {
      return servers.label(server.conn) || server.key
    },
    get url() {
      return server.ctx.sdk.url
    },
    get password() {
      return server.conn.http.password
    },
    get client() {
      return server.ctx.sdk.api
    },
    get data() {
      return server.ctx.data
    },
    get local() {
      return server.isLocal
    },
    get builtin() {
      return ServerConnection.builtin(server.conn)
    },
    get compatible() {
      return !server.health?.incompatible
    },
    get connected() {
      return server.ctx.sdk.connection.status() === "connected"
    },
  }

  const files: Files = {
    get root() {
      return location().directory
    },
    ready: file.ready,
    resolve: file.normalize,
    absolute: file.absolute,
    get: file.get,
    missing: file.notFound,
    sync: (path, options) => {
      file.watch(path)

      return file.load(path, options)
    },
    unwatch: file.unwatch,
    exists: file.exists,
    search: (query, options) =>
      options?.kind === "any" ? file.searchFilesAndDirectories(query, options) : file.searchFiles(query, options),
    selection: {
      // SAFETY: the file model returns the view cache's selection for the path, which its schema types as a line range.
      get: (path) => file.selectedLines(path) as LineRange | null | undefined,
      set: (path, range) => void file.setSelectedLines(path, range),
    },
    scroll: {
      get: (path) => ({
        // SAFETY: the file model returns the view cache's offsets for the path, which its schema types as numbers.
        top: file.scrollTop(path) as number | undefined,
        // SAFETY: as above.
        left: file.scrollLeft(path) as number | undefined,
      }),
      set(path, value) {
        if (value.top !== undefined) file.setScrollTop(path, value.top)

        if (value.left !== undefined) file.setScrollLeft(path, value.left)
      },
    },
    tree: {
      list: file.tree.children,
      state: file.tree.state,
      sync: (path, options) => (options?.force ? file.tree.refresh(path) : file.tree.list(path)),
      expand: (path, options) => void file.tree.expand(path, options),
      collapse: (path) => void file.tree.collapse(path),
    },
  }

  const commentFile = (id: string) => comments.all().find((item) => item.id === id)?.file

  const comment: Comments = {
    list: (path) => (path ? comments.list(path) : comments.all()),
    add: comments.add,
    update(id, text) {
      const path = commentFile(id)

      if (path) comments.update(path, id, text)
    },
    remove(id) {
      const path = commentFile(id)

      if (path) comments.remove(path, id)
    },
    focus: { current: comments.focus, set: (value) => void comments.setFocus(value) },
    active: { current: comments.active, set: (value) => void comments.setActive(value) },
  }

  // A write before the routed session's draft loads would replace the stored draft, so it waits for the load and then
  // applies to that session. Later writes queue behind it to keep call order.
  let writes: Promise<void> | undefined

  const write = (apply: (draft: ComposerStateValue) => void) => {
    const target = composer.capture()

    if (!writes && composer.ready()) return apply(target)
    const loaded = composer.ready() ? undefined : composer.ready.promise

    const next = Promise.resolve(writes)
      .then(() => loaded)
      .catch(() => undefined)
      .then(() => apply(target))

    writes = next

    const settle = () => {
      if (writes === next) writes = undefined
    }

    void next.then(settle, settle)
  }

  // A subagent's session has no composer, so its draft is never sent.
  const edit = (apply: (draft: ReturnType<typeof createComposerEditorActions>) => void) => {
    if (!session.data.isChild()) write((target) => apply(createComposerEditorActions(target.store)))
  }

  const composerRef: Composer = {
    text: () =>
      session.data.isChild()
        ? ""
        : composer
            .capture()
            .current()
            .map((part) => ("content" in part ? part.content : ""))
            .join(""),
    insert(text) {
      const value = text.replace(/\r\n?/g, "\n")

      if (value) edit((draft) => draft.addText(value))
    },
    setText: (value) => edit((draft) => draft.setText(value.replace(/\r\n?/g, "\n"))),
    model() {
      const item = session.data.isChild() ? undefined : local.model.current()

      if (!item) return

      return { providerID: item.provider.id, modelID: item.id, variant: local.model.variant.current() }
    },
    setModel(model) {
      const item = session.data.isChild()
        ? undefined
        : local.model.list().find((entry) => entry.provider.id === model.providerID && entry.id === model.modelID)

      if (!item || (model.variant !== undefined && !Object.keys(item.variants ?? {}).includes(model.variant)))
        return false
      // As the model picker selects: the model first, then a variant chosen with it.
      local.model.set({ providerID: model.providerID, modelID: model.modelID }, { recent: true })

      if (model.variant !== undefined) local.model.variant.set(model.variant)

      return true
    },
    setVariant(variant) {
      if (session.data.isChild() || !local.model.current()) return false

      if (variant !== undefined && !local.model.variant.list().includes(variant)) return false
      local.model.variant.set(variant)

      return true
    },
    attach: (part) => write((draft) => draft.context.add(part)),
    quotable: () => !!prompt()?.quotable(),
    focus(commentID) {
      if (commentID === undefined) return prompt()?.focus()

      const item = composer.context.items().find((entry) => entry.type === "quote" && entry.commentID === commentID)

      if (item) composer.capture().quoteComment.set(item.key)
    },
    update: (id, patch) => write((draft) => draft.context.updateComment(id, patch)),
    detach: (id) => write((draft) => draft.context.removeComment(id)),
    focused: () => !!prompt()?.focused(),
  }

  // Each object's memos live in its own root, which ends when the next object replaces it: a kept object stops
  // updating `project`, `listedProject` and `local`, and its other fields keep reading this session's data.
  const create = (input: { id: string; directory: string; tab: string; visit: object }): MountedSession => {
    const id = input.id
    const directory = input.directory
    const info = () => server.ctx.data.session.get(id)

    // Global sync adds the worktrees found on disk. Raw metadata stands in until global sync lists the project.
    const project = createMemo(() => {
      const value = info()

      return (value && server.ctx.projects.forSession(value)) || sessionProject(server.ctx.data, value, directory)
    })

    // Only a project opened at this exact directory; a session in a project subfolder has none.
    const listedProject = createMemo(() => {
      const key = pathKey(directory)

      return server.ctx.projects
        .list()
        .find((item) => pathKey(item.worktree) === key || item.sandboxes?.some((sandbox) => pathKey(sandbox) === key))
    })

    const local = createMemo(() => !sessionInWorkspace(server.ctx.sync.data.project, info(), directory))

    const view: MountedSession = Object.freeze({
      key: `${server.key}\n${id}`,
      id,
      tab: input.tab,
      visit: input.visit,
      server: serverRef,
      get pending() {
        return server.ctx.data.session.creating(id)
      },
      get location() {
        return info()?.location
      },
      get project() {
        return project()
      },
      get listedProject() {
        return listedProject()
      },
      directory,
      get local() {
        return local()
      },
      // The composer region serves the routed session only.
      get background() {
        return mounted() === view ? (background()?.() ?? noTasks) : noTasks
      },
    })

    return view
  }

  // One object while this screen is mounted, whichever session it routes: its models follow the route.
  const screen: SessionScreen = Object.freeze({
    file: files,
    comment,
    composer: composerRef,
  })

  const owner = getOwner()
  const root: ObjectRoot = {}

  onCleanup(() => root.dispose?.())

  // A new object for each routed session, and for the same session once it moves to another directory or its shell tab
  // is known: its fields never change. A moment without an id keeps the last one. A move is the same routing visit.
  const mounted = createMemo<MountedSession>((previous) => {
    const id = session.identity.sessionID() ?? ""
    const directory = session.workspace.directory()
    const tab = session.layout.tabKey() ?? ""

    if (previous && !id) return previous

    if (previous && previous.id === id && previous.directory === directory && previous.tab === tab) return previous

    const visit = previous?.id === id ? previous.visit : {}

    return untrack(() =>
      createRoot((dispose) => {
        root.dispose?.()
        root.dispose = dispose

        return create({ id, directory, tab, visit })
      }, owner),
    )
  })

  // The session's declared stores start loading now, before its regions read them.
  createRenderEffect(on(mounted, (view) => attachment.preload(view)))
  // Publish both after render, with the original session-mount timing. Renders receive their own screen directly;
  // only global observers need this attachment. One batch prevents exposing a view on another screen.
  createEffect(() =>
    batch(() => {
      onCleanup(attachment.screen(screen))
      onCleanup(attachment.mount(mounted))
    }),
  )

  return {
    screen,
    view: mounted,
    bindBackground: (tasks: Accessor<readonly BackgroundTask[]>) => setBackground(() => tasks),
    bindPrompt: (value: { quotable: Accessor<boolean>; focus: () => void; focused: () => boolean }) =>
      setPrompt(() => value),
  }
}
