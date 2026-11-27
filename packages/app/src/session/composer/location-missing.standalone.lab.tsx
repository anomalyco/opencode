import type { SessionInfo, SessionMoveInput, WorktreeDirectory } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { createSignal, onMount, Show } from "solid-js"
import {
  createMemoryStorage,
  createLabFetch,
  DialogLabRuntime,
  LAB_DIRECTORY,
  LAB_PROJECTS,
} from "@/lab/dialog-runtime"
import type { Platform } from "@/runtime/platform/platform"
import { useData } from "@/runtime/server/current"
import { ToastRegion } from "@/shell/notifications/toast"
import { SessionLocationMissing } from "./location-missing"
import { RecoverySession, RestoredComposer } from "./recovery-lab"

const worktree = (name: string): WorktreeDirectory => ({ directory: `${LAB_DIRECTORY}-${name}`, strategy: "git" })

// Ten or more other worktrees add a search field to the list.
const worktrees = {
  available: ["timeline", "review", "settings"].map(worktree),
  many: [
    "timeline",
    "review",
    "settings",
    "sidebar",
    "terminal",
    "composer",
    "palette",
    "markdown",
    "history",
    "search",
    "theme",
    "tooltip",
  ].map(worktree),
  none: [],
}

type Args = { directory: string; git: boolean; worktrees: keyof typeof worktrees; failFirstMove: boolean }

function RecoveryLab(props: Args) {
  const session: SessionInfo = {
    id: "ses_missing",
    projectID: LAB_PROJECTS[0].id,
    location: { directory: props.directory },
    title: "Timeline fixtures",
    time: { created: 1, updated: 2 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }

  const fallback = createLabFetch()

  let failed = false

  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)

    const path = new URL(request.url).pathname

    if (path === "/api/project")
      return Response.json(LAB_PROJECTS.map((p) => ({ ...p, vcs: props.git ? "git" : undefined })))

    if (path === "/api/worktree" && request.method === "POST")
      return Response.json({ directory: `${LAB_DIRECTORY}-new` })

    if (path === "/api/worktree") return Response.json(worktrees[props.worktrees])

    if (path === `/api/session/${session.id}/move`) {
      if (props.failFirstMove && !failed) {
        failed = true

        return new Response("The checkout is busy", { status: 503 })
      }

      const body: Pick<SessionMoveInput, "directory"> = await request.json()
      session.location.directory = body.directory

      return new Response(null, { status: 204 })
    }

    if (path === `/api/session/${session.id}`) return Response.json({ data: session })

    return fallback(input, init)
  }

  const platform: Platform = {
    platform: "web",
    openExternal() {},
    notify: async () => {},
    restart: async () => {},
    storage: createMemoryStorage(),
    fetch: Object.assign(fetcher, { preconnect: fallback.preconnect }),
  }

  return (
    <DialogLabRuntime platform={platform}>
      <RecoveryDock session={session} directory={props.directory} />
    </DialogLabRuntime>
  )
}

function RecoveryDock(props: { session: SessionInfo; directory: string }) {
  const data = useData()

  onMount(() => void data.project.sync())

  const destination = () => data.session.get(props.session.id)?.location.directory

  return (
    <RecoverySession>
      <Show
        when={destination() && destination() !== props.directory}
        fallback={
          <SessionLocationMissing
            sessionID={props.session.id}
            projectID={props.session.projectID}
            directory={props.directory}
          />
        }
      >
        <output class="text-13-regular text-text-weak">Session moved to {destination()}</output>
        <RestoredComposer />
      </Show>
      <ToastRegion />
    </RecoverySession>
  )
}

function Replay(props: Args) {
  const [revision, setRevision] = createSignal(0)

  return (
    <div class="mx-auto w-full max-w-[760px]">
      <Show when={{ ...props, revision: revision() }} keyed>
        {(args) => <RecoveryLab {...args} />}
      </Show>
      <Button size="small" variant="ghost-muted" onClick={() => setRevision((value) => value + 1)}>
        Replay recovery
      </Button>
    </div>
  )
}

export default {
  title: "OpenCode/Session/Missing location",
  id: "session-missing-location",
  args: { directory: `${LAB_DIRECTORY}-old`, git: true, worktrees: "available", failFirstMove: false } satisfies Args,
  argTypes: { worktrees: { options: ["available", "many", "none"] } },
  render: (args: Args) => <Replay {...args} />,
}

export const MissingWorktree = {}

export const DirectoryOnly = { args: { git: false } }

export const NoWorktrees = { args: { worktrees: "none" } }

export const ManyWorktrees = { args: { worktrees: "many" } }

export const RetryMove = { args: { failFirstMove: true } }
