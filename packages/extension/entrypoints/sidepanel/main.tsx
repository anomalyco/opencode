import { render } from "solid-js/web"
import { createSignal, For, Show, onMount } from "solid-js"
import "./style.css"
import { checkOpenCodeStatus, retryConnection, getOpenCodePort, getOpenCodeUrl } from "../../utils/opencode-status"
import { detectPlatform, launchOpenCodeInTerminal, copyToClipboard } from "../../utils/terminal-launcher"
import { type Platform, type OpenCodeStatus, getIcon, loadPlatforms, savePlatformsToStorage } from "../../utils/shared"
import { SettingsPanel } from "../../components/SettingsPanel"
import { ContextBar } from "./ContextBar"

function NotRunning(props: { onRetry: () => void; retryCount: number; isRetrying: boolean; retryAttempt: number }) {
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

        <div class="install-section">
          <div class="install-header">
            <h3>Download & Install OpenCode</h3>
          </div>

          <div class="install-tabs">
            <button
              class={`install-tab ${activeTab() === "windows" ? "active" : ""}`}
              onClick={() => setActiveTab("windows")}
            >
              Windows PS
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
          <h3>Already have OpenCode?</h3>
          <p>Run this to start the server:</p>
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

          <Show when={props.retryCount > 0}>
            <p class="retry-hint">
              Retried {props.retryCount} time{props.retryCount > 1 ? "s" : ""}. Make sure OpenCode is running.
            </p>
          </Show>
        </div>

        <div class="learn-more">
          <a href="https://opencode.ai" target="_blank" rel="noopener">
            Learn more about OpenCode
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

function App() {
  const [platforms, setPlatforms] = createSignal<Platform[]>(loadPlatforms())
  const [currentView, setCurrentView] = createSignal("opencode")
  const [loadedIframes, setLoadedIframes] = createSignal<Set<string>>(new Set(["opencode"]))
  const [settingsOpen, setSettingsOpen] = createSignal(false)

  const [openCodeStatus, setOpenCodeStatus] = createSignal<OpenCodeStatus>("checking")
  const [retryCount, setRetryCount] = createSignal(0)
  const [isRetrying, setIsRetrying] = createSignal(false)
  const [retryAttempt, setRetryAttempt] = createSignal(0)

  onMount(async () => {
    const connected = await checkOpenCodeStatus()
    setOpenCodeStatus(connected ? "connected" : "disconnected")
  })

  async function handleRetry() {
    setIsRetrying(true)
    setRetryAttempt(0)

    const connected = await retryConnection(3, (attempt) => {
      setRetryAttempt(attempt)
    })

    setIsRetrying(false)
    setRetryCount((c) => c + 1)

    if (connected) {
      setOpenCodeStatus("connected")
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
    if (platform?.url) {
      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.create({ url: platform.url, active: true })
      } else {
        window.open(platform.url, "_blank")
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
              <Show
                when={platform.id !== "opencode" || openCodeStatus() === "connected"}
                fallback={
                  <Show when={platform.id === "opencode"}>
                    <Show
                      when={openCodeStatus() === "disconnected"}
                      fallback={
                        <div class="checking-status">
                          <div class="spinner" />
                          <p>Connecting to OpenCode...</p>
                        </div>
                      }
                    >
                      <NotRunning
                        onRetry={handleRetry}
                        retryCount={retryCount()}
                        isRetrying={isRetrying()}
                        retryAttempt={retryAttempt()}
                      />
                    </Show>
                  </Show>
                }
              >
                <Show when={loadedIframes().has(platform.id)}>
                  <iframe
                    src={platform.id === "opencode" ? getOpenCodeUrl() : platform.url}
                    class="platform-frame"
                    allow="clipboard-read; clipboard-write"
                  />
                </Show>
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
