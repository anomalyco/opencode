import { render } from "solid-js/web"
import { createSignal, For, Show, onMount } from "solid-js"
import "./style.css"
import { checkOpenCodeStatus, retryConnection as retryOpenCode, getOpenCodePort } from "../../utils/opencode-status"
import {
  checkOpenChamberStatus,
  retryOpenChamberConnection,
  getOpenChamberUrl,
  getOpenChamberPort,
  getStartCommand,
} from "../../utils/openchamber-status"
import { detectPlatform, launchOpenCodeInTerminal, copyToClipboard } from "../../utils/terminal-launcher"
import { type Platform, getIcon, loadPlatforms } from "../../utils/shared"
import { SettingsPanel } from "../../components/SettingsPanel"
import { ContextBar } from "./ContextBar"

type ConnectionState = "checking" | "opencode-missing" | "openchamber-missing" | "connected"

function OpenCodeNotRunning(props: { onRetry: () => void; isRetrying: boolean; retryAttempt: number }) {
  const platform = detectPlatform()
  const [activeTab, setActiveTab] = createSignal(platform === "windows" ? "windows" : "unix")
  const [copied, setCopied] = createSignal<string | null>(null)

  const port = getOpenCodePort()
  const serveCommand = `opencode serve --port ${port}`
  const winInstallCmd = "winget install sst.opencode"
  const unixInstallCmd = "curl -fsSL https://opencode.ai/install | bash"

  const copyCmd = async (cmd: string, id: string) => {
    await copyToClipboard(cmd)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div class="not-running">
      <div class="not-running-content">
        <div class="not-running-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>

        <h2>OpenCode isn't running</h2>
        <p class="not-running-subtitle">Start the OpenCode server first</p>

        <div class="install-section">
          <div class="install-header">
            <h3>Install OpenCode</h3>
          </div>

          <div class="install-tabs">
            <button
              class={`install-tab ${activeTab() === "windows" ? "active" : ""}`}
              onClick={() => setActiveTab("windows")}
            >
              Windows
            </button>
            <button
              class={`install-tab ${activeTab() === "unix" ? "active" : ""}`}
              onClick={() => setActiveTab("unix")}
            >
              macOS / Linux
            </button>
          </div>

          <div class="install-content">
            <div class="command-block">
              <code>{activeTab() === "windows" ? winInstallCmd : unixInstallCmd}</code>
              <button
                class="copy-btn"
                onClick={() =>
                  copyCmd(
                    activeTab() === "windows" ? winInstallCmd : unixInstallCmd,
                    activeTab() === "windows" ? "win-install" : "unix-install",
                  )
                }
              >
                {copied() === (activeTab() === "windows" ? "win-install" : "unix-install") ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>

        <div class="already-installed">
          <h3>Already installed?</h3>
          <p>Start the server:</p>
          <div class="command-display">
            <code>{serveCommand}</code>
            <button class="copy-btn-small" onClick={() => copyCmd(serveCommand, "serve")}>
              {copied() === "serve" ? "✓" : "Copy"}
            </button>
          </div>

          <button class="retry-btn" onClick={props.onRetry} disabled={props.isRetrying}>
            <Show when={props.isRetrying} fallback="Retry Connection">
              Checking... ({props.retryAttempt}/3)
            </Show>
          </button>
        </div>

        <div class="learn-more">
          <a href="https://opencode.ai" target="_blank" rel="noopener">
            Learn more
          </a>
          <span class="separator">|</span>
          <a href="https://github.com/sst/opencode" target="_blank" rel="noopener">
            GitHub
          </a>
        </div>
      </div>
    </div>
  )
}

function OpenChamberNotRunning(props: { onRetry: () => void; isRetrying: boolean; retryAttempt: number }) {
  const [activeTab, setActiveTab] = createSignal<"bun" | "npm" | "curl">("bun")
  const [copied, setCopied] = createSignal<string | null>(null)
  const startCommand = () => getStartCommand()

  const installCommands = {
    bun: "bun add -g @openchamber/web",
    npm: "npm install -g @openchamber/web",
    curl: "curl -fsSL https://raw.githubusercontent.com/btriapitsyn/openchamber/main/scripts/install.sh | bash",
  }

  const copyCmd = async (cmd: string, id: string) => {
    await copyToClipboard(cmd)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div class="not-running">
      <div class="not-running-content">
        <div class="not-running-icon connected">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h2>OpenCode is running!</h2>
        <p class="not-running-subtitle">Now start OpenChamber for the chat UI</p>

        <div class="install-section">
          <div class="install-header">
            <h3>Install OpenChamber</h3>
          </div>

          <div class="install-tabs">
            <button class={`install-tab ${activeTab() === "bun" ? "active" : ""}`} onClick={() => setActiveTab("bun")}>
              bun
            </button>
            <button class={`install-tab ${activeTab() === "npm" ? "active" : ""}`} onClick={() => setActiveTab("npm")}>
              npm
            </button>
            <button
              class={`install-tab ${activeTab() === "curl" ? "active" : ""}`}
              onClick={() => setActiveTab("curl")}
            >
              curl
            </button>
          </div>

          <div class="install-content">
            <div class="command-block">
              <code>{installCommands[activeTab()]}</code>
              <button class="copy-btn" onClick={() => copyCmd(installCommands[activeTab()], "install")}>
                {copied() === "install" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>

        <div class="already-installed">
          <h3>Already installed?</h3>
          <p>Start OpenChamber:</p>
          <div class="command-display">
            <code>{startCommand()}</code>
            <button class="copy-btn-small" onClick={() => copyCmd(startCommand(), "start")}>
              {copied() === "start" ? "✓" : "Copy"}
            </button>
          </div>

          <p class="install-note">
            For remote access via Cloudflare Tunnel, install{" "}
            <a
              href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
              target="_blank"
              rel="noopener"
            >
              cloudflared
            </a>{" "}
            and use <code>--try-cf-tunnel</code>
          </p>

          <button class="retry-btn" onClick={props.onRetry} disabled={props.isRetrying}>
            <Show when={props.isRetrying} fallback="Retry Connection">
              Checking... ({props.retryAttempt}/3)
            </Show>
          </button>
        </div>

        <div class="learn-more">
          <a href="https://github.com/btriapitsyn/openchamber" target="_blank" rel="noopener">
            OpenChamber GitHub
          </a>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [platforms, setPlatforms] = createSignal<Platform[]>(loadPlatforms())
  const [currentView, setCurrentView] = createSignal("opencode")
  const [loadedIframes, setLoadedIframes] = createSignal<Set<string>>(new Set(["opencode"]))
  const [settingsOpen, setSettingsOpen] = createSignal(false)

  const [connectionState, setConnectionState] = createSignal<ConnectionState>("checking")
  const [isRetrying, setIsRetrying] = createSignal(false)
  const [retryAttempt, setRetryAttempt] = createSignal(0)

  async function checkConnections() {
    setConnectionState("checking")

    const openCodeOk = await checkOpenCodeStatus()
    if (!openCodeOk) {
      setConnectionState("opencode-missing")
      return
    }

    const openChamberOk = await checkOpenChamberStatus()
    if (!openChamberOk) {
      setConnectionState("openchamber-missing")
      return
    }

    setConnectionState("connected")
  }

  onMount(() => {
    checkConnections()
  })

  async function handleRetryOpenCode() {
    setIsRetrying(true)
    setRetryAttempt(0)

    const connected = await retryOpenCode(3, (attempt) => {
      setRetryAttempt(attempt)
    })

    setIsRetrying(false)

    if (connected) {
      checkConnections()
    }
  }

  async function handleRetryOpenChamber() {
    setIsRetrying(true)
    setRetryAttempt(0)

    const connected = await retryOpenChamberConnection(3, (attempt) => {
      setRetryAttempt(attempt)
    })

    setIsRetrying(false)

    if (connected) {
      setConnectionState("connected")
    }
  }

  function switchView(platformId: string) {
    setCurrentView(platformId)
    if (!loadedIframes().has(platformId)) {
      setLoadedIframes((prev) => new Set([...prev, platformId]))
    }
  }

  function openExternal() {
    const platform = platforms().find((p) => p.id === currentView())
    const url = platform?.id === "opencode" ? getOpenChamberUrl() : platform?.url
    if (url) {
      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.create({ url, active: true })
      } else {
        window.open(url, "_blank")
      }
    }
  }

  function handlePlatformsChange(newPlatforms: Platform[]) {
    setPlatforms(newPlatforms)
  }

  return (
    <div class="eidorail-container">
      <header class="platform-bar">
        <div class="platform-tabs">
          <For
            each={platforms()
              .filter((p) => p.isVisible)
              .sort((a, b) => a.order - b.order)}
          >
            {(platform) => (
              <button
                class={`platform-tab ${currentView() === platform.id ? "active" : ""}`}
                onClick={() => switchView(platform.id)}
                title={platform.name}
              >
                <span class="platform-icon" innerHTML={getIcon(platform.icon, platform.name)} />
              </button>
            )}
          </For>
          <button class="platform-tab add-btn" title="Add Platform" onClick={() => setSettingsOpen(true)}>
            <span class="platform-icon" innerHTML={getIcon("plus")} />
          </button>
        </div>
        <div class="platform-actions">
          <button class="action-btn" onClick={openExternal} title="Open in new tab">
            <span class="action-icon" innerHTML={getIcon("external")} />
          </button>
          <button
            class="action-btn"
            onClick={() => launchOpenCodeInTerminal(getOpenCodePort())}
            title="Launch Terminal"
          >
            <span class="action-icon" innerHTML={getIcon("terminal")} />
          </button>
          <button class="action-btn" onClick={() => setSettingsOpen(true)} title="Settings">
            <span class="action-icon" innerHTML={getIcon("settings")} />
          </button>
        </div>
      </header>

      <main class="view-container">
        <For each={platforms().filter((p) => p.isVisible)}>
          {(platform) => (
            <div class={`view-panel ${currentView() === platform.id ? "active" : ""}`} data-view={platform.id}>
              <Show when={platform.id === "opencode"}>
                <Show
                  when={connectionState() === "connected"}
                  fallback={
                    <Show
                      when={connectionState() === "opencode-missing"}
                      fallback={
                        <Show
                          when={connectionState() === "openchamber-missing"}
                          fallback={
                            <div class="checking-status">
                              <div class="spinner" />
                              <p>Connecting...</p>
                            </div>
                          }
                        >
                          <OpenChamberNotRunning
                            onRetry={handleRetryOpenChamber}
                            isRetrying={isRetrying()}
                            retryAttempt={retryAttempt()}
                          />
                        </Show>
                      }
                    >
                      <OpenCodeNotRunning
                        onRetry={handleRetryOpenCode}
                        isRetrying={isRetrying()}
                        retryAttempt={retryAttempt()}
                      />
                    </Show>
                  }
                >
                  <iframe
                    src={getOpenChamberUrl()}
                    class="platform-frame openchamber-frame"
                    allow="clipboard-read; clipboard-write"
                  />
                </Show>
              </Show>

              <Show when={platform.id !== "opencode" && loadedIframes().has(platform.id)}>
                <iframe src={platform.url} class="platform-frame" allow="clipboard-read; clipboard-write" />
              </Show>
            </div>
          )}
        </For>
      </main>

      <ContextBar />

      <Show when={settingsOpen()}>
        <div class="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <SettingsPanel
            isModal={true}
            onClose={() => setSettingsOpen(false)}
            onPlatformsChange={handlePlatformsChange}
          />
        </div>
      </Show>
    </div>
  )
}

const root = document.getElementById("root")
if (root) {
  render(() => <App />, root)
}
