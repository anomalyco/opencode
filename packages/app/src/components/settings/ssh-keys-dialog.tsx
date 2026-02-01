import { createMemo, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import type { SshKey } from "@opencode-ai/sdk/v2/client"

const errorMessage = (err: unknown) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { error?: { message?: string } } }).data
    if (data?.error?.message) return data.error.message
  }
  if (err instanceof Error) return err.message
  return "Request failed"
}

const TextAreaField = (props: {
  label: string
  placeholder?: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) => (
  <label class="flex flex-col gap-1">
    <span class="text-12-medium text-text-strong">{props.label}</span>
    <textarea
      class="min-h-[96px] w-full rounded-md border border-border-weak-base bg-background-base px-3 py-2 text-12-regular text-text-strong placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-border-strong-base"
      placeholder={props.placeholder}
      value={props.value}
      disabled={props.disabled}
      onInput={(event) => props.onChange(event.currentTarget.value)}
    />
  </label>
)

export function SshKeysDialog() {
  const globalSDK = useGlobalSDK()
  const [form, setForm] = createStore({
    name: "",
    hosts: "",
    publicKey: "",
    privateKey: "",
  })
  const [state, setState] = createStore({
    isSaving: false,
    deletingId: "" as string | null,
  })

  const [keys, { refetch }] = createResource(async () => {
    try {
      return (await globalSDK.client.sshKeys.list()).data ?? []
    } catch {
      return []
    }
  })

  const canSubmit = createMemo(() => {
    return (
      form.name.trim().length > 0 &&
      form.hosts.trim().length > 0 &&
      form.publicKey.trim().length > 0 &&
      form.privateKey.trim().length > 0
    )
  })

  const parseHosts = () =>
    form.hosts
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean)

  const resetForm = () => {
    setForm({
      name: "",
      hosts: "",
      publicKey: "",
      privateKey: "",
    })
  }

  const createKey = async () => {
    if (!canSubmit()) {
      showToast({ title: "Missing fields", description: "Fill in all SSH key fields before saving." })
      return
    }
    const hosts = parseHosts()
    if (hosts.length === 0) {
      showToast({ title: "Hosts required", description: "Enter at least one host pattern." })
      return
    }
    setState("isSaving", true)
    try {
      await globalSDK.client.sshKeys.create({
        sshKeyInput: {
          name: form.name.trim(),
          hosts,
          publicKey: form.publicKey.trim(),
          privateKey: form.privateKey.trim(),
        },
      })
      resetForm()
      await refetch()
      showToast({ title: "SSH key added", description: "Key installed and ready for SSH clones." })
    } catch (err) {
      showToast({ title: "Failed to add SSH key", description: errorMessage(err) })
    } finally {
      setState("isSaving", false)
    }
  }

  const removeKey = async (key: SshKey) => {
    setState("deletingId", key.id)
    try {
      await globalSDK.client.sshKeys.delete({ keyID: key.id })
      await refetch()
      showToast({ title: "SSH key removed", description: key.name })
    } catch (err) {
      showToast({ title: "Failed to remove SSH key", description: errorMessage(err) })
    } finally {
      setState("deletingId", null)
    }
  }

  return (
    <div class="flex flex-col gap-4 rounded-md border border-border-weak-base p-4">
      <div class="flex flex-col gap-1">
        <div class="text-14-medium text-text-strong">SSH keys</div>
        <div class="text-12-regular text-text-weak">
          Add SSH keys for git operations. Keys are stored on the server and installed into your home directory.
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <Show when={keys()?.length} fallback={<div class="text-12-regular text-text-weak">No SSH keys added.</div>}>
          <div class="flex flex-col gap-2">
            <For each={keys()}>
              {(key) => (
                <div class="flex items-start justify-between gap-3 rounded-md border border-border-weak-base px-3 py-2">
                  <div class="min-w-0">
                    <div class="text-13-medium text-text-strong">{key.name}</div>
                    <div class="text-12-regular text-text-weak">Fingerprint: {key.fingerprint}</div>
                    <div class="text-12-regular text-text-weak">
                      Hosts: {key.hosts?.length ? key.hosts.join(", ") : "—"}
                    </div>
                    <Show when={key.installed?.privateKeyPath}>
                      <div class="text-12-regular text-text-weak">Installed</div>
                    </Show>
                  </div>
                  <Button
                    size="normal"
                    variant="ghost"
                    onClick={() => removeKey(key)}
                    disabled={state.deletingId === key.id}
                  >
                    {state.deletingId === key.id ? "Removing..." : "Remove"}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="flex flex-col gap-3 rounded-md border border-border-weak-base bg-background-base p-3">
        <div class="text-12-medium text-text-strong">Add SSH key</div>
        <TextField
          label="Name"
          placeholder="Work laptop"
          value={form.name}
          onChange={(value) => setForm("name", value)}
          disabled={state.isSaving}
        />
        <TextField
          label="Hosts"
          placeholder="github.com, gitlab.com"
          value={form.hosts}
          onChange={(value) => setForm("hosts", value)}
          disabled={state.isSaving}
        />
        <div class="text-12-regular text-text-weak">Comma-separated host patterns for this key.</div>
        <TextAreaField
          label="Public key"
          placeholder="ssh-ed25519 AAAA..."
          value={form.publicKey}
          onChange={(value) => setForm("publicKey", value)}
          disabled={state.isSaving}
        />
        <TextAreaField
          label="Private key"
          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          value={form.privateKey}
          onChange={(value) => setForm("privateKey", value)}
          disabled={state.isSaving}
        />
        <div class="flex justify-end">
          <Button size="normal" onClick={createKey} disabled={state.isSaving || !canSubmit()}>
            {state.isSaving ? "Saving..." : "Save SSH key"}
          </Button>
        </div>
      </div>
    </div>
  )
}
