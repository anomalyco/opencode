import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { onCleanup, onMount, Show } from "solid-js"
import {
  DialogSsh,
  HomeProjectsView,
  PlatformProvider,
  ServerConnection,
  SshConnectionPanel,
  SshProvider,
  SshServerSettings,
  useLanguage,
  useSsh,
  useSshAuthenticate,
  type SshItem,
  type SshPlatform,
  type SshState,
} from "../../../stories/mocks/gui-plugins/ssh"

const challenges = {
  trust: {
    id: "host-key",
    text: "The authenticity of host 'dev.example.com' can't be established.\nED25519 key fingerprint is SHA256:EXAMPLE-FINGERPRINT-FOR-STORY-ONLY.\nAre you sure you want to continue connecting?",
    confirm: true,
  },
  passphrase: { id: "passphrase", text: "Enter passphrase for key '~/.ssh/id_ed25519':", confirm: false },
  password: { id: "password", text: "brendon@dev.example.com's password:", confirm: false },
  otp: { id: "otp", text: "Verification code:", confirm: false },
}

type FixtureState = {
  item?: SshItem
  before?: SshItem
  prompts: (keyof typeof challenges)[]
  timer?: ReturnType<typeof setTimeout>
}

function Fixture(props: {
  session?: boolean
  settings?: boolean
  incompatible?: true | "failed-update" | "version-mismatch"
  prompts?: (keyof typeof challenges)[]
  rejectPassword?: boolean
  connectionDelay?: number
  initial?: "connecting" | "challenge" | "failure" | "required"
  responseDelay?: number
}) {
  const state: FixtureState = {
    prompts: [],
    item:
      props.initial === "required"
        ? {
            config: { id: "story", target: "ssh linuxbook", name: "" },
            stage: props.session || props.settings ? "disconnected" : "authentication",
            saved: true,
            detail: "",
          }
        : undefined,
  }

  onCleanup(() => clearTimeout(state.timer))
  const listeners = new Set<(state: SshState) => void>()
  const snapshot = (): SshState => ({ servers: state.item ? [state.item] : [] })

  const update = (changes: Partial<SshItem>) => {
    if (!state.item) return
    state.item = { ...state.item, ...changes }
    listeners.forEach((listener) => listener(snapshot()))
  }

  const nextChallenge = () => {
    const next = state.prompts.shift()
    update(
      next ? { stage: "authentication", prompt: challenges[next] } : { stage: "ready", saved: true, prompt: undefined },
    )
  }

  const api: SshPlatform = {
    getState: async () => snapshot(),
    subscribe(callback) {
      listeners.add(callback)

      return () => {
        listeners.delete(callback)
      }
    },
    hosts: async () => ["devbox", "staging", "build-host"],
    start: async (input) => {
      clearTimeout(state.timer)
      state.before = state.item?.config.id === input.id ? state.item : undefined
      state.prompts =
        props.prompts?.slice() ?? (props.initial === "required" ? ["password", "otp"] : ["trust", "password", "otp"])
      state.item = {
        config: input,
        saved: props.initial === "required",
        stage: "connecting",
        detail: "",
        destination: "brendon@dev.example.com:22",
      }

      update({ stage: "connecting" })

      if (props.initial === "connecting") return

      if (props.incompatible && !input.replace) return update({ stage: "incompatible", error: "version" })

      const connected = () => {
        if (props.incompatible === "failed-update") return update({ stage: "failed", error: "install" })

        if (props.incompatible === "version-mismatch") return update({ stage: "incompatible", error: "version" })

        if (props.initial === "failure" && state.before?.stage !== "failed")
          return update({ stage: "failed", error: "connection", detail: "Connection refused" })
        nextChallenge()
      }

      if (!props.connectionDelay) return connected()
      state.timer = setTimeout(connected, props.connectionDelay)
    },
    respond: async (_id, prompt) => {
      const next = () => {
        if (props.rejectPassword && state.before?.stage !== "failed" && prompt === "password")
          return update({ stage: "failed", error: "connection", detail: "Permission denied", prompt: undefined })
        nextChallenge()
      }

      if (!props.responseDelay) return next()
      update({ stage: "connecting", prompt: undefined })
      state.timer = setTimeout(next, props.responseDelay)
    },
    resolve: async () => null,
    disconnect: async () => {
      clearTimeout(state.timer)
      update({ stage: "disconnected", prompt: undefined })
    },
    cancel: async () => {
      if (state.item?.stage === "incompatible") return
      clearTimeout(state.timer)
      update({ ...state.before, stage: state.before?.stage ?? "disconnected", prompt: undefined })
    },
    forget: async () => {
      state.item = undefined
      listeners.forEach((listener) => listener(snapshot()))
    },
    openConfig: async () => {},
  }

  return (
    <PlatformProvider
      value={{
        platform: "desktop",
        windowID: "ssh-story",
        sshServers: api,
        openExternal() {},
        restart: async () => {},
        notify: async () => {},
        openDirectoryPickerDialog: async () => null,
      }}
    >
      <QueryClientProvider client={new QueryClient()}>
        <SshProvider>
          {props.settings ? (
            <AuthenticationSettings />
          ) : props.session ? (
            <AuthenticationSession />
          ) : props.initial === "required" ? (
            <AuthenticationHome />
          ) : (
            <Open initial={props.initial} />
          )}
        </SshProvider>
      </QueryClientProvider>
    </PlatformProvider>
  )
}

function AuthenticationSettings() {
  return (
    <div class="settings-servers" style={{ width: "min(100%, 480px)" }}>
      <SshServerSettings
        filter=""
        domain={{
          collection: { items: () => [], health: () => ({}) },
          defaults: { available: () => false, key: () => null, set: async () => {} },
          connection: {
            canRemove: () => false,
            remove: async () => {},
            canHide: () => false,
            isHidden: () => false,
            setHidden: () => {},
          },
        }}
      />
    </div>
  )
}

function AuthenticationSession() {
  const ssh = useSsh()

  return (
    <div style={{ height: "70vh" }}>
      <Show when={ssh.servers[0]}>
        {(item) => (
          <Show when={item().stage !== "ready"} fallback={<div>Session connected</div>}>
            <SshConnectionPanel
              item={item()}
              pending={ssh.pending(item().config.id)}
              onReconnect={() => ssh.connect(item().config)}
            />
          </Show>
        )}
      </Show>
    </div>
  )
}

function AuthenticationHome() {
  const language = useLanguage()
  const ssh = useSsh()
  const authenticate = useSshAuthenticate()

  const server: ServerConnection.Ssh = {
    type: "ssh",
    id: "story",
    host: "linuxbook",
    displayName: "linuxbook",
    label: "SSH",
    http: { url: "http://127.0.0.1:0" },
    get authenticationRequired() {
      return ssh.servers[0]?.stage === "authentication"
    },
    get connecting() {
      return ssh.servers[0]?.stage === "connecting"
    },
  }

  const projects = [{ worktree: "/home/user/project", expanded: true }]

  return (
    <div style={{ width: "min(100%, 340px)" }}>
      <HomeProjectsView
        dropdown
        language={language}
        servers={[server]}
        projects={projects}
        recentlyClosed={[]}
        selection={{ server: ServerConnection.key(server) }}
        homedir="/home/user"
        serverHealth={() => (ssh.servers[0]?.stage === "ready" ? { type: "healthy" } : { type: "unreachable" })}
        serverLabel={(server) => server.displayName ?? server.http.url}
        projectsForServer={() => projects}
        collapsed={() => false}
        canRevealProject={() => false}
        hasUnread={() => false}
        onWheel={() => {}}
        onChooseProject={(server) => {
          authenticate(server)
        }}
        onFocusServer={(server) => {
          authenticate(server)
        }}
        onAuthenticateServer={(server) => {
          authenticate(server)
        }}
        onToggleCollapsed={() => {}}
        onEditServer={() => {}}
        canRemoveServer={() => false}
        onRemoveServer={() => {}}
        canHideServer={() => false}
        onHideServer={() => {}}
        onMoveProject={() => {}}
        onSelectProject={() => {}}
        onAddProjects={() => {}}
        onOpenProjectNewSession={() => {}}
        canImportSession={false}
        onImportSession={() => {}}
        onEditProject={() => {}}
        onRevealProject={() => {}}
        onClearNotifications={() => {}}
        onCloseProject={() => {}}
        onOpenSettings={() => {}}
        onOpenHelp={() => {}}
      />
    </div>
  )
}

function Open(props: { initial?: string }) {
  const dialog = useDialog()

  const open = () =>
    dialog.show(() => (
      <DialogSsh
        config={props.initial ? { id: "story", target: "devbox", name: "Development" } : undefined}
        connect={!!props.initial}
      />
    ))

  onMount(open)

  return <Button onClick={open}>Open SSH connection</Button>
}

export default { title: "App/Dialogs/SSH", id: "app-dialog-ssh" }

export const Host = { render: () => <Fixture /> }

export const Connecting = { render: () => <Fixture initial="connecting" /> }

export const KeyOnly = { render: () => <Fixture prompts={[]} connectionDelay={1500} /> }

export const Password = { render: () => <Fixture initial="challenge" prompts={["password", "otp"]} /> }

export const SlowPassword = {
  render: () => <Fixture initial="challenge" prompts={["password", "otp"]} responseDelay={5000} />,
}

export const KeyPassphraseRejected = {
  render: () => <Fixture initial="challenge" prompts={["passphrase", "password", "otp"]} responseDelay={700} />,
}

export const VerificationCode = { render: () => <Fixture initial="challenge" prompts={["otp"]} /> }

export const Confirmation = { render: () => <Fixture initial="challenge" /> }

export const Failure = { render: () => <Fixture initial="failure" /> }

export const AuthenticationFailureRetry = { render: () => <Fixture prompts={["password"]} rejectPassword /> }

export const IncompatibleHost = { render: () => <Fixture incompatible prompts={[]} connectionDelay={1500} /> }

export const FailedUpdate = { render: () => <Fixture incompatible="failed-update" connectionDelay={1500} /> }

export const StillIncompatibleAfterUpdate = {
  render: () => <Fixture incompatible="version-mismatch" connectionDelay={1500} />,
}

export const AuthenticationRequired = { render: () => <Fixture initial="required" /> }

export const SettingsReconnect = { render: () => <Fixture initial="required" settings connectionDelay={200} /> }

export const IncompatibleSession = { render: () => <Fixture initial="required" session incompatible /> }

export const InactiveSession = { render: () => <Fixture initial="required" session connectionDelay={3000} /> }

export const KeyReconnect = { render: () => <Fixture initial="required" session prompts={[]} connectionDelay={3000} /> }
