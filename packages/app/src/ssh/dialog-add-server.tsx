import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useMutation } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

export function DialogAddSshServer() {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const api = platform.sshServers
  const [store, setStore] = createStore({
    name: "",
    host: "",
    port: "",
    identityFile: "",
  })

  const addMutation = useMutation(() => ({
    mutationFn: async () => {
      if (!api) throw new Error("SSH servers not available")
      if (!store.name.trim() || !store.host.trim()) return
      const port = store.port.trim() ? Number.parseInt(store.port, 10) : undefined
      if (port !== undefined && (Number.isNaN(port) || port < 1)) {
        showToast({ variant: "error", title: language.t("common.requestFailed"), description: "Invalid port" })
        return
      }
      const server = await api.addServer({
        id: "",
        name: store.name.trim(),
        host: store.host.trim(),
        port,
        identityFile: store.identityFile.trim() || undefined,
      })
      dialog.close()
      api.startServer(server.config.id).catch(() => {})
    },
    onError: (error) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  }))

  return (
    <Dialog fit class="settings-v2-wsl-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("ssh.dialog.add.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="settings-v2-wsl-dialog-body">
        <div class="flex flex-col gap-3">
          <TextInputV2
            appearance="base"
            placeholder={language.t("ssh.dialog.add.namePlaceholder")}
            value={store.name}
            onInput={(event) => setStore("name", event.currentTarget.value)}
            aria-label={language.t("ssh.dialog.add.name")}
          />
          <TextInputV2
            appearance="base"
            placeholder={language.t("ssh.dialog.add.hostPlaceholder")}
            value={store.host}
            onInput={(event) => setStore("host", event.currentTarget.value)}
            aria-label={language.t("ssh.dialog.add.host")}
          />
          <TextInputV2
            appearance="base"
            placeholder={language.t("ssh.dialog.add.portPlaceholder")}
            value={store.port}
            onInput={(event) => setStore("port", event.currentTarget.value)}
            aria-label={language.t("ssh.dialog.add.port")}
          />
          <div class="flex items-center gap-2">
            <TextInputV2
              appearance="base"
              class="flex-1"
              placeholder={language.t("ssh.dialog.add.identityFilePlaceholder")}
              value={store.identityFile}
              onInput={(event) => setStore("identityFile", event.currentTarget.value)}
              aria-label={language.t("ssh.dialog.add.identityFile")}
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={addMutation.isPending} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          variant={addMutation.isPending ? "loading" : "contrast"}
          disabled={!store.name.trim() || !store.host.trim()}
          onClick={() => addMutation.mutate()}
        >
          {language.t("ssh.server.add")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
