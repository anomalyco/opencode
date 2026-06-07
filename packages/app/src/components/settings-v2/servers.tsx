import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import fuzzysort from "fuzzysort"
import { type Component, For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { ServerRowMenu } from "@/components/server/server-row-menu"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, serverName } from "@/context/server"
import { useServerManagementController } from "../dialog-select-server"
import { SettingsListV2 } from "./parts/list"
import { DialogAddWslServer } from "@/wsl/dialog-add-server"
import { isWslServer, useFilteredWslServers, WslServerSettings } from "@/wsl/settings"
import type { WslServerItem } from "@/wsl/types"
import "./settings-v2.css"

type ServerSettingsView = "list" | "http-form" | "managed-add" | "managed-form"

export const SettingsServersV2: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const controller = useServerManagementController()
  const [store, setStore] = createStore({
    filter: "",
    view: "list" as ServerSettingsView,
    managedEditId: null as string | null,
  })
  const [managedAddTitle, setManagedAddTitle] = createSignal<string | null>(null)
  const wslServers = useFilteredWslServers(() => store.filter)
  const editingManaged = createMemo(() => wslServers().find((item) => item.config.id === store.managedEditId))

  const showSearch = createMemo(
    () =>
      store.view === "list" &&
      controller.sortedItems().filter((item) => !isWslServer(item)).length + wslServers().length > 1,
  )

  const filtered = createMemo(() => {
    const items = controller.sortedItems().filter((item) => !isWslServer(item))
    const query = store.filter.trim()
    if (!query) return items
    return fuzzysort
      .go(query, items, {
        keys: [(item) => serverName(item), (item) => item.http.url],
      })
      .map((result) => result.obj)
  })

  const backToList = () => {
    controller.resetForm()
    setManagedAddTitle(null)
    setStore({ view: "list", managedEditId: null })
  }

  const handleManagedAdded = () => {
    backToList()
  }

  const openHttpAdd = () => {
    controller.startAdd()
    setStore({ view: "http-form", managedEditId: null })
  }

  const openEdit = (server: ServerConnection.Http) => {
    controller.startEdit(server)
    setStore({ view: "http-form", managedEditId: null })
  }

  const openManagedAdd = () => {
    controller.resetForm()
    setManagedAddTitle(null)
    setStore({ view: "managed-add", managedEditId: null })
  }

  const openManagedEdit = (item: WslServerItem) => {
    controller.resetForm()
    setStore({ view: "managed-form", managedEditId: item.config.id })
  }

  createEffect(() => {
    if (store.view === "http-form" && !controller.isFormMode()) backToList()
  })

  createEffect(() => {
    if (store.view !== "managed-form" || !store.managedEditId) return
    if (editingManaged()) return
    backToList()
  })

  const title = createMemo(() => {
    if (store.view === "http-form") {
      return controller.isAddMode() ? language.t("dialog.server.add.title") : language.t("dialog.server.edit.title")
    }
    if (store.view === "managed-add") return managedAddTitle() ?? language.t("wsl.server.add")
    if (store.view === "managed-form") return language.t("dialog.server.edit.title")
    return language.t("status.popover.tab.servers")
  })

  return (
    <>
      <div
        class="settings-v2-tab-header settings-v2-servers-header"
        classList={{ "settings-v2-tab-header--stacked": showSearch() }}
      >
        <div class="settings-v2-tab-header-row">
          <div class="settings-v2-tab-title-row">
            <Show when={store.view !== "list"}>
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="outline-chevron-down" size="large" style={{ transform: "rotate(90deg)" }} />}
                aria-label={language.t("common.goBack")}
                onClick={backToList}
              />
            </Show>
            <h2 class="settings-v2-tab-title">{title()}</h2>
          </div>
          <Show when={store.view === "list"}>
            <MenuV2 gutter={4} modal={false} placement="bottom-end">
              <MenuV2.Trigger
                as={IconButtonV2}
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="plus" size="large" />}
                aria-label={language.t("dialog.server.add.button")}
              />
              <MenuV2.Portal>
                <MenuV2.Content>
                  <MenuV2.Group>
                    <MenuV2.GroupLabel>{language.t("dialog.server.add.button")}</MenuV2.GroupLabel>
                    <MenuV2.Item onSelect={openHttpAdd}>{language.t("dialog.server.add.remote")}</MenuV2.Item>
                    <Show when={platform.wslServers}>
                      <MenuV2.Item onSelect={openManagedAdd}>{language.t("dialog.server.add.managed")}</MenuV2.Item>
                    </Show>
                  </MenuV2.Group>
                </MenuV2.Content>
              </MenuV2.Portal>
            </MenuV2>
          </Show>
        </div>
        <Show when={showSearch()}>
          <div class="settings-v2-tab-search">
            <TextInputV2
              type="search"
              appearance="base"
              value={store.filter}
              onInput={(event) => setStore("filter", event.currentTarget.value)}
              placeholder={language.t("dialog.server.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              aria-label={language.t("dialog.server.search.placeholder")}
            />
            <Show when={store.filter}>
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                size="small"
                class="settings-v2-tab-search-clear"
                icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
                onClick={() => setStore("filter", "")}
              />
            </Show>
          </div>
        </Show>
      </div>

      <div class="settings-v2-tab-body settings-v2-servers">
        <Switch>
          <Match when={store.view === "http-form"}>
            <ServerConnectionInlineForm controller={controller} onBack={backToList} />
          </Match>
          <Match when={store.view === "managed-add"}>
            <div class="settings-v2-managed-add">
              <DialogAddWslServer
                onAdded={handleManagedAdded}
                onCancel={backToList}
                onTitleChange={setManagedAddTitle}
              />
            </div>
          </Match>
          <Match when={store.view === "managed-form" && editingManaged()}>
            {(item) => <ManagedServerInlineForm item={item()} onBack={backToList} />}
          </Match>
          <Match when={true}>
            <Show
              when={filtered().length > 0 || wslServers().length > 0}
              fallback={
                <div class="settings-v2-servers-status">
                  <span>{store.filter ? language.t("palette.empty") : language.t("dialog.server.empty")}</span>
                  <Show when={store.filter}>
                    <span class="settings-v2-servers-status-filter">&quot;{store.filter}&quot;</span>
                  </Show>
                </div>
              }
            >
              <SettingsListV2>
                <WslServerSettings
                  controller={controller}
                  servers={wslServers}
                  onEdit={openManagedEdit}
                />
                <For each={filtered()}>
                  {(item) => {
                    const key = ServerConnection.key(item)
                    const health = () => controller.status()[key]
                    const isDefault = () => controller.defaultKey() === key
                    return (
                      <div class="settings-v2-servers-row">
                        <div class="settings-v2-servers-lead">
                          <ServerHealthIndicator health={health()} />
                          <div class="settings-v2-servers-copy">
                            <span class="settings-v2-servers-name">{serverName(item)}</span>
                            <span class="settings-v2-servers-meta">
                              <Show when={health()?.version}>v{health()?.version}</Show>
                            </span>
                          </div>
                        </div>
                        <div class="settings-v2-servers-actions">
                          <Show when={controller.canDefault() && isDefault()}>
                            <Tag>{language.t("dialog.server.status.default")}</Tag>
                          </Show>
                          <ServerRowMenu server={item} controller={controller} onEdit={openEdit} />
                        </div>
                      </div>
                    )
                  }}
                </For>
              </SettingsListV2>
            </Show>
          </Match>
        </Switch>
      </div>
    </>
  )
}

function ServerConnectionInlineForm(props: {
  controller: ReturnType<typeof useServerManagementController>
  onBack: () => void
}) {
  const language = useLanguage()
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      props.onBack()
      return
    }
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    props.controller.submitForm()
  }

  return (
    <div class="settings-v2-server-form">
      <div class="settings-v2-server-form-fields">
        <div class="settings-v2-server-form-field">
          <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.url")}</label>
          <TextInputV2
            type="text"
            appearance="large"
            class="!w-full self-stretch"
            value={props.controller.formValue()}
            placeholder={language.t("dialog.server.add.placeholder")}
            invalid={!!props.controller.formError()}
            disabled={props.controller.formBusy()}
            autofocus
            onInput={(event) => props.controller.handleFormChange()(event.currentTarget.value)}
            onKeyDown={keyDown}
          />
          <Show when={props.controller.formError()}>
            <span class="settings-v2-server-dialog-error">{props.controller.formError()}</span>
          </Show>
        </div>
        <div class="settings-v2-server-form-field">
          <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.name")}</label>
          <TextInputV2
            type="text"
            appearance="large"
            class="!w-full self-stretch"
            value={props.controller.formName()}
            placeholder={language.t("dialog.server.add.namePlaceholder")}
            disabled={props.controller.formBusy()}
            onInput={(event) => props.controller.handleFormNameChange()(event.currentTarget.value)}
            onKeyDown={keyDown}
          />
        </div>
        <div class="settings-v2-server-form-grid">
          <div class="settings-v2-server-form-field">
            <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.username")}</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={props.controller.formUsername()}
              placeholder={language.t("dialog.server.add.usernamePlaceholder")}
              disabled={props.controller.formBusy()}
              onInput={(event) => props.controller.handleFormUsernameChange()(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
          </div>
          <div class="settings-v2-server-form-field">
            <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.password")}</label>
            <TextInputV2
              type="password"
              appearance="large"
              class="!w-full self-stretch"
              value={props.controller.formPassword()}
              placeholder={language.t("dialog.server.add.passwordPlaceholder")}
              disabled={props.controller.formBusy()}
              onInput={(event) => props.controller.handleFormPasswordChange()(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
          </div>
        </div>
      </div>
      <div class="settings-v2-server-form-actions">
        <ButtonV2 variant="neutral" disabled={props.controller.formBusy()} onClick={props.onBack}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={props.controller.formBusy()} onClick={props.controller.submitForm}>
          {props.controller.formBusy()
            ? language.t("dialog.server.add.checking")
            : props.controller.isAddMode()
              ? language.t("dialog.server.add.button")
              : language.t("common.save")}
        </ButtonV2>
      </div>
    </div>
  )
}

function ManagedServerInlineForm(props: { item: WslServerItem; onBack: () => void }) {
  const language = useLanguage()
  const platform = usePlatform()
  const api = platform.wslServers!
  const [port, setPort] = createSignal(props.item.config.port?.toString() ?? "")
  const [username, setUsername] = createSignal(props.item.config.username ?? "opencode")
  const [password, setPassword] = createSignal(props.item.config.password ?? "")
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const address = () => {
    if (port().trim()) return `http://127.0.0.1:${port().trim()}`
    if (props.item.runtime.kind === "ready") return props.item.runtime.url
    return language.t("dialog.server.managed.addressRandom")
  }
  const save = () => {
    const trimmedPort = port().trim()
    const parsedPort = trimmedPort ? Number(trimmedPort) : null
    if (parsedPort !== null && (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
      setError(language.t("wsl.server.access.invalidPort"))
      return
    }
    setSaving(true)
    api
      .updateServer(props.item.config.id, {
        port: parsedPort,
        username: username().trim() || null,
        password: password().trim() || null,
      })
      .then(props.onBack)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : String(requestError)))
      .finally(() => setSaving(false))
  }
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      props.onBack()
      return
    }
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    save()
  }

  return (
    <div class="settings-v2-server-form">
      <div class="settings-v2-server-form-fields">
        <div class="settings-v2-server-form-field">
          <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.url")}</label>
          <TextInputV2 type="text" appearance="large" class="!w-full self-stretch" value={address()} disabled />
        </div>
        <div class="settings-v2-server-form-field">
          <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.name")}</label>
          <TextInputV2
            type="text"
            appearance="large"
            class="!w-full self-stretch"
            value={props.item.config.distro}
            disabled
          />
        </div>
        <div class="settings-v2-server-form-grid">
          <div class="settings-v2-server-form-field">
            <label class="settings-v2-server-dialog-label">{language.t("wsl.server.access.port")}</label>
            <TextInputV2
              type="text"
              inputMode="numeric"
              appearance="large"
              class="!w-full self-stretch"
              value={port()}
              placeholder={language.t("wsl.server.access.portPlaceholder")}
              disabled={saving()}
              onInput={(event) => {
                setError("")
                setPort(event.currentTarget.value)
              }}
              onKeyDown={keyDown}
            />
          </div>
          <div class="settings-v2-server-form-field">
            <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.username")}</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={username()}
              placeholder={language.t("dialog.server.add.usernamePlaceholder")}
              disabled={saving()}
              onInput={(event) => {
                setError("")
                setUsername(event.currentTarget.value)
              }}
              onKeyDown={keyDown}
            />
          </div>
        </div>
        <div class="settings-v2-server-form-field">
          <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.password")}</label>
          <TextInputV2
            type="password"
            appearance="large"
            class="!w-full self-stretch"
            value={password()}
            placeholder={language.t("wsl.server.access.passwordPlaceholder")}
            disabled={saving()}
            onInput={(event) => {
              setError("")
              setPassword(event.currentTarget.value)
            }}
            onKeyDown={keyDown}
          />
          <Show when={error()}>
            <span class="settings-v2-server-dialog-error">{error()}</span>
          </Show>
        </div>
        <div class="settings-v2-server-form-warning">{language.t("dialog.server.managed.restartWarning")}</div>
      </div>
      <div class="settings-v2-server-form-actions">
        <ButtonV2 variant="neutral" disabled={saving()} onClick={props.onBack}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={saving()} onClick={save}>
          {language.t("common.save")}
        </ButtonV2>
      </div>
    </div>
  )
}
