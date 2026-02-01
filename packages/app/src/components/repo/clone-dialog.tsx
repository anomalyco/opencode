import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon } from "@opencode-ai/ui/icon"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import type { Repo, RepoCloneCredentials, RepoCloneProgress } from "@opencode-ai/sdk/v2/client"
import { useCloneProgress, type CloneAuthType } from "@/hooks/use-clone-progress"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { SettingsDialog } from "@/components/settings/settings-dialog"

type CredentialMode = CloneAuthType | null

interface CloneDialogProps {
  onCloneSuccess?: (repo: Repo) => void
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function CloneDialog(props: CloneDialogProps) {
  const dialog = useDialog()
  const sync = useGlobalSync()
  const globalSDK = useGlobalSDK()

  const [gitUrl, setGitUrl] = createSignal("")
  const [branch, setBranch] = createSignal("")
  const [cloneProgress, setCloneProgress] = createSignal<RepoCloneProgress | null>(null)
  const [isCloning, setIsCloning] = createSignal(false)
  const [maybeErrorInfo, setMaybeErrorInfo] = createSignal<{
    message: string
    helpSteps?: string[]
    authType?: CloneAuthType
    canRetry?: boolean
  } | null>(null)

  const [credentialMode, setCredentialMode] = createSignal<CredentialMode>(null)
  const [patToken, setPatToken] = createSignal("")
  const [sshPassphrase, setSshPassphrase] = createSignal("")
  const [httpUsername, setHttpUsername] = createSignal("")
  const [httpPassword, setHttpPassword] = createSignal("")

  const trimmedUrl = createMemo(() => gitUrl().trim())
  const isSshUrl = createMemo(() => trimmedUrl().startsWith("git@") || trimmedUrl().startsWith("ssh://"))
  const [sshKeys, { refetch: refetchSshKeys }] = createResource(
    () => (isSshUrl() ? "ssh" : null),
    async () => {
      try {
        return (await globalSDK.client.sshKeys.list()).data ?? []
      } catch {
        return undefined
      }
    },
  )
  const missingSshKeys = createMemo(() => {
    if (!isSshUrl()) return false
    const keys = sshKeys()
    if (!keys) return false
    return keys.length === 0
  })

  const [config] = createResource(async () => {
    try {
      return (await globalSDK.client.config.get()).data
    } catch {
      return undefined
    }
  })

  const workspaceRoot = createMemo(() => {
    const root = config()?.workspace?.root
    if (!root) return undefined
    const home = sync.data.path.home
    if (home && root.startsWith(home)) {
      return `~${root.slice(home.length)}`
    }
    return root
  })

  const { startClone, startCloneWithCredentials, cancel } = useCloneProgress({
    onProgress: setCloneProgress,
    onComplete: (repo, message) => {
      setIsCloning(false)
      setCloneProgress(null)
      setCredentialMode(null)
      setPatToken("")
      setSshPassphrase("")
      setHttpUsername("")
      setHttpPassword("")
      props.onCloneSuccess?.(repo)
      showToast({ title: "Repository cloned", description: message })
      dialog.close()
    },
    onError: (message, helpSteps, authType, canRetry) => {
      setIsCloning(false)
      setCloneProgress(null)
      setMaybeErrorInfo({ message, helpSteps, authType, canRetry })
      if (authType === "ssh") {
        void refetchSshKeys()
      }
      if (canRetry && authType) setCredentialMode(authType)
      showToast({ title: "Failed to clone repository", description: message })
    },
  })

  const progressPercentage = createMemo(() => {
    const progress = cloneProgress()
    if (!progress || progress.total_objects === 0) return 0
    return Math.round((progress.received_objects / progress.total_objects) * 100)
  })

  const progressText = createMemo(() => {
    const progress = cloneProgress()
    if (!progress) return ""
    if (
      progress.received_objects === progress.total_objects &&
      progress.total_deltas > 0 &&
      progress.indexed_deltas < progress.total_deltas
    ) {
      return `Indexing: ${progress.indexed_deltas} / ${progress.total_deltas} deltas`
    }
    return `Downloading: ${progress.received_objects} / ${progress.total_objects} objects (${formatBytes(
      progress.received_bytes,
    )})`
  })

  const resetForm = () => {
    setGitUrl("")
    setBranch("")
    setMaybeErrorInfo(null)
    setCredentialMode(null)
    setPatToken("")
    setSshPassphrase("")
    setHttpUsername("")
    setHttpPassword("")
  }

  const handleClose = () => {
    if (isCloning()) cancel()
    dialog.close()
  }

  const handleClone = () => {
    if (!trimmedUrl()) {
      showToast({ title: "URL required", description: "Enter a git URL to clone." })
      return
    }
    setMaybeErrorInfo(null)
    setIsCloning(true)
    startClone(trimmedUrl(), branch().trim() || undefined)
  }

  const handleRetryWithCredentials = async () => {
    const mode = credentialMode()
    if (!mode) return

    let credentials: RepoCloneCredentials
    if (mode === "github_pat") {
      credentials = { type: "github_pat", token: patToken() }
    } else if (mode === "https_basic") {
      credentials = { type: "https_basic", username: httpUsername(), password: httpPassword() }
    } else {
      credentials = { type: "ssh_passphrase", passphrase: sshPassphrase() }
    }

    setMaybeErrorInfo(null)
    setIsCloning(true)
    await startCloneWithCredentials(trimmedUrl(), credentials, branch().trim() || undefined)
  }

  const hasValidCredentials = createMemo(() => {
    const mode = credentialMode()
    if (mode === "github_pat") return patToken().trim().length > 0
    if (mode === "https_basic") return httpUsername().trim().length > 0 && httpPassword().trim().length > 0
    if (mode === "ssh") return sshPassphrase().trim().length > 0
    return false
  })

  return (
    <Dialog
      title="Clone from URL"
      description="Enter a git URL (SSH or HTTPS) to clone the repository."
      class="max-w-[520px]"
    >
      <div class="flex flex-col gap-4 px-2 pb-3">
        <TextField
          autofocus
          label="Repository URL"
          placeholder="https://github.com/user/repo.git"
          value={gitUrl()}
          onChange={setGitUrl}
          disabled={isCloning()}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Enter" && !isCloning()) handleClone()
          }}
        />
        <TextField
          label="Branch (optional)"
          placeholder="main"
          value={branch()}
          onChange={setBranch}
          disabled={isCloning()}
        />
        <Show when={workspaceRoot()}>
          {(root) => <div class="text-12-regular text-text-weak">Repository will be cloned to {root()}</div>}
        </Show>

        <Show when={isCloning()}>
          <div class="flex items-center gap-3 rounded-md border border-border-weak-base p-3">
            <ProgressCircle size={18} strokeWidth={2} percentage={progressPercentage()} />
            <div class="flex flex-col gap-0.5">
              <div class="text-12-medium text-text-strong">{progressPercentage()}%</div>
              <div class="text-12-regular text-text-weak">{progressText()}</div>
            </div>
          </div>
        </Show>

        <Show when={maybeErrorInfo()}>
          {(errorInfo) => (
            <div class="rounded-md border border-border-weak-base bg-surface-warning-base/30 p-3">
              <div class="text-12-medium text-text-strong">{errorInfo().message}</div>
              <Show when={errorInfo().helpSteps?.length}>
                <ul class="mt-2 list-disc pl-5 text-12-regular text-text-weak">
                  <For each={errorInfo().helpSteps}>{(step) => <li>{step}</li>}</For>
                </ul>
              </Show>
            </div>
          )}
        </Show>

        <Show when={missingSshKeys()}>
          <div class="rounded-md border border-border-weak-base bg-surface-warning-base/30 p-3">
            <div class="text-12-medium text-text-strong">SSH key required</div>
            <div class="mt-1 text-12-regular text-text-weak">
              Add an SSH key to clone repositories over SSH.
            </div>
            <div class="mt-3 flex justify-end">
              <Button size="normal" onClick={() => dialog.show(() => <SettingsDialog />)} disabled={isCloning()}>
                Add SSH key
              </Button>
            </div>
          </div>
        </Show>

        <Show when={credentialMode()}>
          <div class="rounded-md border border-border-weak-base bg-surface-raised-base p-3 flex flex-col gap-3">
            <div class="text-12-medium text-text-strong">Authentication required</div>
            <Switch>
              <Match when={credentialMode() === "github_pat"}>
                <div class="flex flex-col gap-2">
                  <div class="flex items-center gap-2">
                    <div class="text-12-medium text-text-weak">GitHub personal access token</div>
                    <Tooltip value="Used only for this clone, not stored.">
                      <Icon name="help" size="small" class="text-text-weak" />
                    </Tooltip>
                  </div>
                  <TextField
                    label="Token"
                    hideLabel
                    type="password"
                    placeholder="ghp_xxxxxxxxxxxx"
                    value={patToken()}
                    onChange={setPatToken}
                    disabled={isCloning()}
                  />
                  <div class="text-12-regular text-text-weak">Used only for this clone. Not stored.</div>
                </div>
              </Match>
              <Match when={credentialMode() === "https_basic"}>
                <div class="flex flex-col gap-2">
                  <TextField
                    label="Username"
                    value={httpUsername()}
                    onChange={setHttpUsername}
                    disabled={isCloning()}
                  />
                  <div class="flex items-center gap-2">
                    <div class="text-12-medium text-text-weak">Password</div>
                    <Tooltip value="Used only for this clone, not stored.">
                      <Icon name="help" size="small" class="text-text-weak" />
                    </Tooltip>
                  </div>
                  <TextField
                    label="Password"
                    hideLabel
                    type="password"
                    value={httpPassword()}
                    onChange={setHttpPassword}
                    disabled={isCloning()}
                  />
                  <div class="text-12-regular text-text-weak">Used only for this clone. Not stored.</div>
                </div>
              </Match>
              <Match when={credentialMode() === "ssh"}>
                <div class="flex flex-col gap-2">
                  <div class="flex items-center gap-2">
                    <div class="text-12-medium text-text-weak">SSH key passphrase</div>
                    <Tooltip value="Used only for this clone, not stored.">
                      <Icon name="help" size="small" class="text-text-weak" />
                    </Tooltip>
                  </div>
                  <TextField
                    label="Passphrase"
                    hideLabel
                    type="password"
                    placeholder="Enter passphrase for your SSH key"
                    value={sshPassphrase()}
                    onChange={setSshPassphrase}
                    disabled={isCloning()}
                  />
                  <div class="text-12-regular text-text-weak">Used only for this clone. Not stored.</div>
                </div>
              </Match>
            </Switch>

            <Collapsible>
              <Collapsible.Trigger class="text-12-regular text-text-weak flex items-center gap-2">
                <Icon name="chevron-down" size="small" />
                How are my credentials used?
              </Collapsible.Trigger>
              <Collapsible.Content class="mt-2 text-12-regular text-text-weak">
                <ul class="list-disc pl-5">
                  <li>Sent directly to the git server for authentication</li>
                  <li>Used only for this single clone operation</li>
                  <li>Never stored on disk or in any database</li>
                  <li>Discarded immediately after the clone completes</li>
                </ul>
              </Collapsible.Content>
            </Collapsible>

            <Button
              size="large"
              class="w-full"
              onClick={handleRetryWithCredentials}
              disabled={isCloning() || !hasValidCredentials()}
            >
              {isCloning() ? "Cloning..." : "Retry with credentials"}
            </Button>
          </div>
        </Show>

        <div class="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="large"
            onClick={() => {
              cancel()
              resetForm()
              handleClose()
            }}
            disabled={isCloning()}
          >
            Cancel
          </Button>
          <Button size="large" onClick={handleClone} disabled={isCloning()}>
            {isCloning() ? "Cloning..." : "Clone"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
