import { createSignal, For, Show, onMount } from "solid-js"
import {
  type Platform,
  type OpenCodeStatus,
  DEFAULT_PLATFORMS,
  PRESET_PLATFORMS,
  getIcon,
  loadPlatforms,
  savePlatformsToStorage,
} from "../utils/shared"
import {
  checkOpenCodeStatus,
  retryConnection,
  getOpenCodeUrl,
  getConnectionMode,
  setConnectionMode,
  getOpenCodePort,
  saveOpenCodePort,
  getRemoteUrl,
  setRemoteUrl,
  manualPortScan,
  isWorkspaceEnabled,
  setWorkspaceEnabled,
  getWorkspaceDirectory,
  setWorkspaceDirectory,
  type ConnectionMode,
} from "../utils/opencode-status"

interface SettingsPanelProps {
  isModal?: boolean
  onClose?: () => void
  onPlatformsChange?: (platforms: Platform[]) => void
}

export function SettingsPanel(props: SettingsPanelProps) {
  const [platforms, setPlatforms] = createSignal<Platform[]>(loadPlatforms())
  const [settingsTab, setSettingsTab] = createSignal("platforms")
  const [showToast, setShowToast] = createSignal(false)
  const [toastMessage, setToastMessage] = createSignal("Settings saved")
  const [customPlatformName, setCustomPlatformName] = createSignal("")
  const [customPlatformUrl, setCustomPlatformUrl] = createSignal("")
  const [workspaceEnabled, setWorkspaceEnabledState] = createSignal(isWorkspaceEnabled())
  const [workspaceRoot, setWorkspaceRoot] = createSignal(getWorkspaceDirectory())

  const [openCodeStatus, setOpenCodeStatus] = createSignal<OpenCodeStatus>("checking")
  const [connectionMode, setConnectionModeState] = createSignal<ConnectionMode>(getConnectionMode())
  const [localPort, setLocalPort] = createSignal(String(getOpenCodePort()))
  const [remoteUrl, setRemoteUrlState] = createSignal(getRemoteUrl())
  const [isScanning, setIsScanning] = createSignal(false)
  const [scanResult, setScanResult] = createSignal<string | null>(null)

  onMount(async () => {
    const connected = await checkOpenCodeStatus()
    setOpenCodeStatus(connected ? "connected" : "disconnected")
  })

  function triggerToast(message: string) {
    setToastMessage(message)
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  function savePlatforms(p: Platform[]) {
    savePlatformsToStorage(p)
    setPlatforms(p)
    props.onPlatformsChange?.(p)
  }

  async function saveConnectionSettings() {
    setConnectionMode(connectionMode())
    if (connectionMode() === "local") {
      const port = parseInt(localPort(), 10)
      if (!isNaN(port) && port > 0 && port < 65536) {
        saveOpenCodePort(port)
      }
    } else {
      setRemoteUrl(remoteUrl())
    }
    updateOpenCodeUrl()
    await handleRetry()
    triggerToast("Connection settings saved")
  }

  function updateOpenCodeUrl() {
    const url = getOpenCodeUrl()
    const updated = platforms().map((p) => (p.id === "opencode" ? { ...p, url } : p))
    savePlatforms(updated)
  }

  async function handlePortScan() {
    setIsScanning(true)
    setScanResult(null)
    const foundPort = await manualPortScan()
    setIsScanning(false)
    if (foundPort) {
      setLocalPort(String(foundPort))
      setScanResult(`Found OpenCode on port ${foundPort}`)
    } else {
      setScanResult("No OpenCode server found")
    }
  }

  async function handleRetry() {
    const connected = await retryConnection(3, () => {})
    if (connected) {
      setOpenCodeStatus("connected")
    }
  }

  function togglePlatformVisibility(platformId: string) {
    const updated = platforms().map((p) => (p.id === platformId ? { ...p, isVisible: !p.isVisible } : p))
    savePlatforms(updated)
  }

  function removePlatform(platformId: string) {
    const platform = platforms().find((p) => p.id === platformId)
    if (platform?.isBuiltIn) return
    const updated = platforms().filter((p) => p.id !== platformId)
    savePlatforms(updated)
  }

  function movePlatform(platformId: string, direction: number) {
    const sorted = [...platforms()].sort((a, b) => a.order - b.order)
    const currentIndex = sorted.findIndex((p) => p.id === platformId)
    const newIndex = currentIndex + direction
    if (newIndex < 0 || newIndex >= sorted.length) return
    const temp = sorted[currentIndex].order
    sorted[currentIndex].order = sorted[newIndex].order
    sorted[newIndex].order = temp
    savePlatforms(sorted)
  }

  function addPresetPlatform(presetId: string) {
    const preset = PRESET_PLATFORMS.find((p) => p.id === presetId)
    if (!preset) return
    if (platforms().some((p) => p.id === presetId)) return
    const maxOrder = Math.max(...platforms().map((p) => p.order), 0)
    const newPlatform: Platform = {
      ...preset,
      isVisible: true,
      order: maxOrder + 1,
    }
    savePlatforms([...platforms(), newPlatform])
  }

  function addCustomPlatform() {
    const name = customPlatformName().trim()
    let url = customPlatformUrl().trim()
    if (!name || !url) return
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url
    }
    try {
      new URL(url)
    } catch {
      alert("Please enter a valid URL")
      return
    }
    const id = "custom-" + Date.now()
    const maxOrder = Math.max(...platforms().map((p) => p.order), 0)
    const newPlatform: Platform = {
      id,
      name,
      url,
      icon: id,
      isBuiltIn: false,
      isVisible: true,
      order: maxOrder + 1,
    }
    savePlatforms([...platforms(), newPlatform])
    setCustomPlatformName("")
    setCustomPlatformUrl("")
  }

  function restoreDefaults() {
    if (confirm("Restore default platforms? Custom platforms will be removed.")) {
      savePlatforms([...DEFAULT_PLATFORMS])
    }
  }

  const availablePresets = () => {
    const existingIds = new Set(platforms().map((p) => p.id))
    return PRESET_PLATFORMS.filter((p) => !existingIds.has(p.id))
  }

  const content = (
    <>
      <div class="settings-tabs">
        <button
          class={`settings-tab ${settingsTab() === "platforms" ? "active" : ""}`}
          onClick={() => setSettingsTab("platforms")}
          title="Platforms"
        >
          <span innerHTML={getIcon("apps")} />
          <span class="settings-tab-label">Platforms</span>
        </button>
        <button
          class={`settings-tab ${settingsTab() === "connection" ? "active" : ""}`}
          onClick={() => setSettingsTab("connection")}
          title="Connection"
        >
          <span innerHTML={getIcon("plug")} />
          <span class="settings-tab-label">Connection</span>
        </button>
        <button
          class={`settings-tab ${settingsTab() === "display" ? "active" : ""}`}
          onClick={() => setSettingsTab("display")}
          title="Display"
        >
          <span innerHTML={getIcon("monitor")} />
          <span class="settings-tab-label">Display</span>
        </button>
        <button
          class={`settings-tab ${settingsTab() === "about" ? "active" : ""}`}
          onClick={() => setSettingsTab("about")}
          title="About"
        >
          <span innerHTML={getIcon("info")} />
          <span class="settings-tab-label">About</span>
        </button>
      </div>

      <div class="modal-content">
        <div class="tab-content">
          <Show when={settingsTab() === "platforms"}>
            <div class="settings-section">
              <h3>Active Platforms</h3>
              <div class="platform-list">
                <For each={platforms().sort((a, b) => a.order - b.order)}>
                  {(platform) => (
                    <div class={`platform-item ${platform.isVisible ? "" : "hidden-platform"}`}>
                      <div class="platform-reorder">
                        <button
                          class="reorder-btn"
                          onClick={() => movePlatform(platform.id, -1)}
                          disabled={platform.order === 0}
                        >
                          <span innerHTML={getIcon("chevronUp")} />
                        </button>
                        <button class="reorder-btn" onClick={() => movePlatform(platform.id, 1)}>
                          <span innerHTML={getIcon("chevronDown")} />
                        </button>
                      </div>
                      <span class="platform-item-icon" innerHTML={getIcon(platform.icon, platform.name)} />
                      <div class="platform-item-info">
                        <span class="platform-item-name">{platform.name}</span>
                        <span class="platform-item-url">{platform.url || "Built-in"}</span>
                      </div>
                      <div class="platform-item-actions">
                        <button
                          class="platform-action-btn"
                          onClick={() => togglePlatformVisibility(platform.id)}
                          title={platform.isVisible ? "Hide" : "Show"}
                        >
                          <span innerHTML={getIcon(platform.isVisible ? "eye" : "eyeOff")} />
                        </button>
                        <Show when={!platform.isBuiltIn}>
                          <button
                            class="platform-action-btn danger"
                            onClick={() => removePlatform(platform.id)}
                            title="Remove"
                          >
                            <span innerHTML={getIcon("trash")} />
                          </button>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>

            <Show when={availablePresets().length > 0}>
              <div class="settings-section">
                <h3>Add Platform</h3>
                <div class="preset-grid">
                  <For each={availablePresets()}>
                    {(preset) => (
                      <button class="preset-btn" onClick={() => addPresetPlatform(preset.id)}>
                        <span class="preset-icon" innerHTML={getIcon(preset.icon)} />
                        <span class="preset-name">{preset.name}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <div class="settings-section">
              <h3>Add Custom Platform</h3>
              <div class="custom-form">
                <input
                  type="text"
                  placeholder="Platform name"
                  value={customPlatformName()}
                  onInput={(e) => setCustomPlatformName(e.currentTarget.value)}
                />
                <input
                  type="text"
                  placeholder="URL (e.g., https://example.com)"
                  value={customPlatformUrl()}
                  onInput={(e) => setCustomPlatformUrl(e.currentTarget.value)}
                />
                <button class="add-custom-btn" onClick={addCustomPlatform}>
                  Add Platform
                </button>
              </div>
            </div>
          </Show>

          <Show when={settingsTab() === "connection"}>
            <div
              class={`status-badge ${openCodeStatus() === "connected" ? "status-connected" : "status-disconnected"}`}
            >
              <div class="status-dot"></div>
              {openCodeStatus() === "connected" ? "Connected to OpenCode" : "Disconnected"}
            </div>

            <div class="settings-section">
              <h3>Server Mode</h3>
              <div class="connection-mode-tabs">
                <button
                  class={`mode-tab ${connectionMode() === "local" ? "active" : ""}`}
                  onClick={() => setConnectionModeState("local")}
                >
                  Local
                </button>
                <button
                  class={`mode-tab ${connectionMode() === "remote" ? "active" : ""}`}
                  onClick={() => setConnectionModeState("remote")}
                >
                  Remote
                </button>
              </div>
            </div>

            <Show when={connectionMode() === "local"}>
              <div class="settings-section">
                <h3>Local Settings</h3>
                <div class="connection-form">
                  <label>Port</label>
                  <div class="port-input-row">
                    <input
                      type="number"
                      placeholder="4096"
                      value={localPort()}
                      onInput={(e) => setLocalPort(e.currentTarget.value)}
                    />
                    <button class="scan-btn" onClick={handlePortScan} disabled={isScanning()}>
                      {isScanning() ? "Scanning..." : "Scan"}
                    </button>
                  </div>
                  <Show when={scanResult()}>
                    <p class="scan-result">{scanResult()}</p>
                  </Show>
                  <p class="setting-hint">Desktop app uses random ports. Click Scan to find it.</p>
                </div>
              </div>
            </Show>

            <Show when={connectionMode() === "remote"}>
              <div class="settings-section">
                <h3>Remote Settings</h3>
                <div class="connection-form">
                  <label>Server URL</label>
                  <input
                    type="text"
                    placeholder="https://your-server.example.com"
                    value={remoteUrl()}
                    onInput={(e) => setRemoteUrlState(e.currentTarget.value)}
                  />
                  <p class="setting-hint">Connect to a remote OpenCode server via Tailscale, Cloudflare Tunnel, etc.</p>
                </div>
              </div>
            </Show>

            <div class="settings-section">
              <h3>Workspace Context</h3>
              <label class="toggle-row">
                <span class="toggle-label">Use custom workspace</span>
                <input
                  type="checkbox"
                  class="toggle-checkbox"
                  checked={workspaceEnabled()}
                  onChange={(e) => {
                    const enabled = e.currentTarget.checked
                    setWorkspaceEnabledState(enabled)
                    setWorkspaceEnabled(enabled)
                  }}
                />
              </label>
              <p class="setting-hint" style="margin-top: 4px;">
                {workspaceEnabled()
                  ? "Sessions will use your specified directory as context."
                  : "Sessions use OpenCode's default project. Enable to specify a workspace."}
              </p>

              <Show when={workspaceEnabled()}>
                <div class="custom-form" style="margin-top: 12px;">
                  <input
                    type="text"
                    placeholder="Absolute path to existing directory"
                    value={workspaceRoot()}
                    onInput={(e) => {
                      const value = e.currentTarget.value
                      setWorkspaceRoot(value)
                      setWorkspaceDirectory(value)
                    }}
                  />
                  <div class="path-examples">
                    <span class="path-example-label">Examples:</span>
                    <code class="path-example">C:\Users\you\projects</code>
                    <span class="path-example-sep">or</span>
                    <code class="path-example">/home/you/projects</code>
                  </div>
                  <p class="setting-hint warning">
                    Path must exist on the machine running OpenCode. WSL users: use Linux paths if OpenCode runs in WSL.
                  </p>
                </div>
              </Show>
            </div>

            <button class="save-connection-btn" style="width: 100%; margin-top: 12px;" onClick={saveConnectionSettings}>
              Save & Connect
            </button>
          </Show>

          <Show when={settingsTab() === "display"}>
            <div class="settings-section">
              <h3>Theme</h3>
              <div class="theme-options">
                <div class="theme-option active" title="Dark Theme (Default)">
                  <div class="theme-preview"></div>
                  <span>Dark</span>
                </div>
                <div class="theme-option" title="Coming Soon" style="opacity: 0.5; cursor: not-allowed;">
                  <div class="theme-preview" style="background: #f0f0f0; border-color: #ccc;"></div>
                  <span>Light</span>
                </div>
              </div>
            </div>

            <div class="settings-section">
              <h3>Tab Bar</h3>
              <div class="connection-mode-tabs" style="opacity: 0.5; pointer-events: none;">
                <button class="mode-tab active">Top</button>
                <button class="mode-tab">Bottom</button>
              </div>
            </div>

            <div class="settings-section">
              <p class="setting-hint">More display options coming soon.</p>
            </div>
          </Show>

          <Show when={settingsTab() === "about"}>
            <div class="about-header">
              <div class="app-logo-placeholder">
                <span innerHTML={getIcon("home")} style="width: 32px; height: 32px;" />
              </div>
              <div>
                <h3 style="font-size: 16px; margin: 0 0 4px 0;">Eidorail Extension</h3>
                <span class="app-version">v0.1.0</span>
              </div>
              <div class="about-links">
                <a href="https://opencode.ai/docs" target="_blank" class="about-link">
                  <span innerHTML={getIcon("external")} style="width: 14px; height: 14px;" /> Docs
                </a>
                <a href="https://github.com/sst/opencode" target="_blank" class="about-link">
                  <span innerHTML={getIcon("external")} style="width: 14px; height: 14px;" /> GitHub
                </a>
              </div>
            </div>

            <div class="danger-zone">
              <button class="restore-btn" onClick={restoreDefaults}>
                Restore Default Platforms
              </button>
              <button
                class="danger-btn"
                onClick={() => {
                  if (confirm("Clear all extension data? This cannot be undone.")) {
                    localStorage.clear()
                    location.reload()
                  }
                }}
              >
                <span innerHTML={getIcon("trash")} /> Clear All Data
              </button>
            </div>
          </Show>
        </div>
      </div>

      <Show when={showToast()}>
        <div class="toast-container">
          <div class="toast">
            <span innerHTML={getIcon("check")} style="width: 16px; height: 16px; color: #4ade80;" />
            {toastMessage()}
          </div>
        </div>
      </Show>
    </>
  )

  if (props.isModal) {
    return (
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Settings</h2>
          <button class="modal-close" onClick={() => props.onClose?.()}>
            <span innerHTML={getIcon("close")} />
          </button>
        </div>
        {content}
      </div>
    )
  }

  return <div class="settings-standalone">{content}</div>
}
