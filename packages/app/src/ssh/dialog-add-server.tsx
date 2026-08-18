import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createMemo, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSshServers } from "./context"
import {
  sshAddPrimaryButton,
  sshConfigHostSuggestions,
  sshProbeForHost,
  sshProbeStatus,
  type SshAddText,
} from "./settings-model"
import "./dialog-add-ssh-server.css"

function translate(language: ReturnType<typeof useLanguage>, value: SshAddText) {
  if (value.params) return language.t(value.key, value.params)
  return language.t(value.key)
}

interface DialogSshServerProps {
  onAdded?: (host: string) => void | Promise<void>
}

export function DialogAddSshServer(props: DialogSshServerProps = {}) {
  const language = useLanguage()
  const controller = useSshAddServerController(props)

  return (
    <Dialog fit class="settings-v2-ssh-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("ssh.server.add")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="settings-v2-ssh-dialog-body">
        <div class="settings-v2-ssh-field">
          <TextInputV2
            appearance="large"
            aria-label={language.t("ssh.add.hostLabel")}
            placeholder={language.t("ssh.add.hostPlaceholder")}
            value={controller.host()}
            disabled={controller.busy()}
            onInput={(event) => controller.setHost(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") controller.runPrimary()
            }}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
          />
          <p class="settings-v2-ssh-hint">{language.t("ssh.add.hint")}</p>
        </div>
        <Show when={controller.status()}>
          {(status) => (
            <div class="settings-v2-ssh-status" data-tone={status().tone}>
              <span>{translate(language, status().text)}</span>
              <Show when={status().detail}>
                {(detail) => <span class="settings-v2-ssh-status-detail">{detail()}</span>}
              </Show>
              <Show when={status().tone === "error"}>
                <span class="settings-v2-ssh-status-detail">
                  {language.t("ssh.add.authHint", { host: controller.host().trim() || "host" })}
                </span>
              </Show>
            </div>
          )}
        </Show>
        <Show when={controller.suggestions().length > 0}>
          <div class="settings-v2-ssh-section">
            <div class="settings-v2-ssh-section-header">
              <span class="settings-v2-ssh-section-title">{language.t("ssh.add.configHosts")}</span>
            </div>
            <div class="settings-v2-ssh-config-hosts">
              <For each={controller.suggestions()}>
                {(host) => (
                  <button
                    type="button"
                    class="settings-v2-ssh-config-host"
                    disabled={controller.busy()}
                    onClick={() => controller.setHost(host)}
                  >
                    {host}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={controller.busy()} onClick={controller.close}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          variant={controller.primary().loading ? "loading" : "contrast"}
          disabled={!controller.primary().loading && controller.primary().disabled}
          onClick={controller.runPrimary}
        >
          <Show when={controller.primary().loading} fallback={translate(language, controller.primary().label)}>
            <LoaderV2 />
          </Show>
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

function useSshAddServerController(props: DialogSshServerProps) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const sshServers = useSshServers()
  const api = platform.sshServers!
  const [store, setStore] = createStore({
    host: "",
    probing: false,
    installing: false,
    adding: false,
  })

  onMount(() => {
    void api.refreshConfigHosts().catch(() => undefined)
  })

  const probe = createMemo(() => sshProbeForHost(sshServers.data, store.host))
  const primary = createMemo(() =>
    sshAddPrimaryButton({
      hostInput: store.host,
      probe: probe(),
      probing: store.probing,
      installing: store.installing,
      adding: store.adding,
    }),
  )
  const status = createMemo(() => sshProbeStatus(probe(), store.probing))
  const suggestions = createMemo(() => sshConfigHostSuggestions(sshServers.data, store.host))
  const busy = () => store.probing || store.installing || store.adding

  const run = async (flag: "probing" | "installing" | "adding", action: () => Promise<unknown>) => {
    setStore(flag, true)
    try {
      await action()
    } catch (err) {
      requestError(language, err)
    } finally {
      setStore(flag, false)
    }
  }

  const runPrimary = () => {
    const button = primary()
    if (button.loading || button.disabled) return
    const host = store.host.trim()
    if (!host) return
    if (button.action === "probe") {
      void run("probing", () => api.probeHost(host))
      return
    }
    if (button.action === "install") {
      void run("installing", () => api.installOpencode(host))
      return
    }
    void run("adding", async () => {
      await api.addServer(host)
      if (props.onAdded) {
        await props.onAdded(host)
      } else {
        dialog.close()
      }
    })
  }

  return {
    host: () => store.host,
    setHost: (value: string) => setStore("host", value),
    probing: () => store.probing,
    busy,
    primary,
    status,
    suggestions,
    runPrimary,
    close: () => dialog.close(),
  }
}

function requestError(language: ReturnType<typeof useLanguage>, err: unknown) {
  console.error("SSH servers request failed", err instanceof Error ? (err.stack ?? err.message) : String(err))
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}
