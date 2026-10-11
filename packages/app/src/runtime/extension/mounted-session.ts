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
} from "@opencode/gui-extensions/sdk"
import { useComments } from "@/composer/comments"
import { useComposerState } from "@/composer/persistence"
import { useServer } from "@/runtime/server/current"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { sessionInWorkspace, sessionProject, type SessionModel } from "@/session/model"
import { useFile } from "@/workspaces/files/model"
import { useWorkspaceLocation } from "@/workspaces/location"
import { pathKey } from "@/workspaces/path-key"
import { useExtensionAttachment } from "./host-apis"

const noTasks: readonly BackgroundTask[] = []

/** The root of the routed session's object, which ends when the screen routes another session. */
type ObjectRoot = { dispose?: () => void }

/**
 * The routed session as extensions see it: one frozen object per routed session, a new one each time the screen
 * routes another session, and the `SessionScreen` that owns the route-following files, comments and composer.
 */
export function createMountedSession(session: SessionModel) {
  const file = useFile()
  const comments = useComments()
  const composer = useComposerState()
  const server = useServer()
  const location = useWorkspaceLocation()
  const attachment = useExtensionAttachment()
  // The composer region owns background tasks and is created after the view.
  const [background, setBackground] = createSignal<Accessor<readonly BackgroundTask[]>>()

  const serverRef: ServerRef = {
    get id() {
      return server.key
    },
    get name() {
      return serverName(server.conn) || server.key
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
    sync: (path, options) => file.load(path, options),
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

  const composerRef: Composer = {
    attach: (part) => composer.context.add(part),
    update: (id, patch) => composer.context.updateComment(id, patch),
    detach: (id) => composer.context.removeComment(id),
  }

  // Each object's memos live in its own root, which ends when the next object replaces it: a kept object stops
  // updating `project`, `listedProject` and `local`, and its other fields keep reading this session's data.
  const create = (input: { id: string; directory: string; tab: string; visit: object }): MountedSession => {
    const id = input.id
    const directory = input.directory
    const info = () => server.ctx.data.session.get(id)

    // Global sync adds the worktrees found on disk, and the user's local name and icon override the server's.
    // Raw metadata stands in until global sync lists the project.
    const project = createMemo(() => {
      const value = info()

      return (
        (value && server.ctx.projects.detailsForSession(value)) || sessionProject(server.ctx.data, value, directory)
      )
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
  }
}
