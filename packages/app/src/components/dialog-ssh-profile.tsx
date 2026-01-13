import { Component, Show, createSignal } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { useSsh, type ConnectionProfile } from "@/context/ssh"
import { usePlatform } from "@/context/platform"
import { showToast } from "@opencode-ai/ui/toast"

export const DialogSshProfile: Component<{ profile?: ConnectionProfile }> = (props) => {
  const dialog = useDialog()
  const ssh = useSsh()
  const platform = usePlatform()
  const isDesktop = platform.platform === "desktop"

  const [name, setName] = createSignal(props.profile?.name ?? "")
  const [host, setHost] = createSignal(props.profile?.host ?? "")
  const [user, setUser] = createSignal(props.profile?.user ?? "")
  const [port, setPort] = createSignal(props.profile?.port?.toString() ?? "")
  const [identityFile, setIdentityFile] = createSignal(props.profile?.identityFile ?? "")
  const [proxyJump, setProxyJump] = createSignal(props.profile?.proxyJump ?? "")
  const [sshConfigMode, setSshConfigMode] = createSignal<"pass-through" | "isolation">(
    props.profile?.sshConfigMode ?? "pass-through",
  )
  const [remoteServerPorts, setRemoteServerPorts] = createSignal(
    props.profile?.remoteServerPorts.join(", ") ?? "8080",
  )
  const [remoteHost, setRemoteHost] = createSignal(props.profile?.remoteHost ?? "127.0.0.1")
  const [bootstrapEnabled, setBootstrapEnabled] = createSignal(props.profile?.bootstrapEnabled ?? false)
  const [autoReconnect, setAutoReconnect] = createSignal(props.profile?.autoReconnect ?? true)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const handleSubmit = async () => {
    if (!isDesktop) {
      setError("SSH profiles only available on desktop")
      return
    }

    if (!name().trim()) {
      setError("Profile name is required")
      return
    }

    if (!host().trim()) {
      setError("Host is required")
      return
    }

    const ports = remoteServerPorts()
      .split(",")
      .map((p) => parseInt(p.trim(), 10))
      .filter((p) => !isNaN(p) && p > 0 && p <= 65535)

    if (ports.length === 0) {
      setError("At least one valid remote server port is required")
      return
    }

    const portNum = port().trim() ? parseInt(port().trim(), 10) : undefined
    if (port().trim() && (isNaN(portNum!) || portNum! < 1 || portNum! > 65535)) {
      setError("Port must be between 1 and 65535")
      return
    }

    setError(undefined)
    setSaving(true)

    try {
      const profile: ConnectionProfile = {
        id: props.profile?.id ?? `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: name().trim(),
        host: host().trim(),
        user: user().trim() || undefined,
        port: portNum,
        identityFile: identityFile().trim() || undefined,
        proxyJump: proxyJump().trim() || undefined,
        sshConfigMode: sshConfigMode(),
        remoteServerPorts: ports,
        remoteHost: remoteHost().trim() || "127.0.0.1",
        bootstrapEnabled: bootstrapEnabled(),
        autoReconnect: autoReconnect(),
        createdAt: props.profile?.createdAt ?? new Date().toISOString(),
        lastUsed: props.profile?.lastUsed,
      }

      await ssh.saveProfile(profile)
      showToast({ title: "Profile saved", description: `SSH profile "${profile.name}" has been saved.` })
      dialog.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title={props.profile ? "Edit SSH Profile" : "New SSH Profile"}>
      <div class="flex flex-col gap-4 pb-4">
        <TextField
          label="Profile Name"
          value={name()}
          onChange={setName}
          placeholder="e.g., Production Server"
          required
          autofocus
        />

        <div class="grid grid-cols-2 gap-4">
          <TextField
            label="Host"
            value={host()}
            onChange={setHost}
            placeholder="example.com"
            required
          />
          <TextField
            label="User (optional)"
            value={user()}
            onChange={setUser}
            placeholder="username"
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <TextField
            label="SSH Port (optional)"
            value={port()}
            onChange={setPort}
            placeholder="22"
            type="number"
          />
          <TextField
            label="Identity File (optional)"
            value={identityFile()}
            onChange={setIdentityFile}
            placeholder="~/.ssh/id_rsa"
          />
        </div>

        <TextField
          label="Proxy Jump (optional)"
          value={proxyJump()}
          onChange={setProxyJump}
          placeholder="user@jumphost.com"
        />

        <div class="flex flex-col gap-2">
          <label class="text-14-regular text-text-strong">SSH Config Mode</label>
          <div class="flex gap-4">
            <label class="flex items-center gap-2">
              <input
                type="radio"
                checked={sshConfigMode() === "pass-through"}
                onChange={() => setSshConfigMode("pass-through")}
              />
              <span class="text-14-regular">Pass-through (use SSH config files)</span>
            </label>
            <label class="flex items-center gap-2">
              <input
                type="radio"
                checked={sshConfigMode() === "isolation"}
                onChange={() => setSshConfigMode("isolation")}
              />
              <span class="text-14-regular">Isolation (ignore SSH config files)</span>
            </label>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <TextField
            label="Remote Server Ports"
            value={remoteServerPorts()}
            onChange={setRemoteServerPorts}
            placeholder="8080, 8081"
            description="Comma-separated list of ports to try"
          />
          <TextField
            label="Remote Host"
            value={remoteHost()}
            onChange={setRemoteHost}
            placeholder="127.0.0.1"
            description="Host to forward to on remote"
          />
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-14-regular text-text-strong">Bootstrap Server</div>
              <div class="text-12-regular text-text-weak">Automatically install and start OpenCode server if not available</div>
            </div>
            <Switch checked={bootstrapEnabled()} onChange={setBootstrapEnabled} />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-14-regular text-text-strong">Auto Reconnect</div>
              <div class="text-12-regular text-text-weak">Automatically reconnect on connection loss</div>
            </div>
            <Switch checked={autoReconnect()} onChange={setAutoReconnect} />
          </div>
        </div>

        <Show when={error()}>
          <div class="text-14-regular text-text-critical">{error()}</div>
        </Show>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving()}>
            {saving() ? "Saving..." : props.profile ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
