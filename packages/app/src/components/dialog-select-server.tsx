import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { Show } from "solid-js"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/servers"
import { ServerCollectionController } from "@/components/server/server-management-controller"

type ServerConnectionFormController = {
  state: {
    adding: () => boolean
    busy: () => boolean
    value: () => string
    name: () => string
    username: () => string
    password: () => string
    error: () => string
    status: () => boolean | undefined
  }
  change: {
    value: (value: string) => void
    name: (value: string) => void
    username: (value: string) => void
    password: (value: string) => void
  }
  reset: () => void
  submit: () => void
}

interface ServerFormProps {
  value: string
  name: string
  username: string
  password: string
  placeholder: string
  busy: boolean
  error: string
  status: boolean | undefined
  onChange: (value: string) => void
  onNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onBack: () => void
}

function ServerForm(props: ServerFormProps) {
  const language = useLanguage()
  const keyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      props.onBack()
      return
    }
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    props.onSubmit()
  }

  return (
    <div>
      <div class="bg-surface-base rounded-md p-5 flex flex-col gap-3">
        <div class="flex-1 min-w-0 [&_[data-slot=input-wrapper]]:relative">
          <TextField
            type="text"
            label={language.t("dialog.server.add.url")}
            placeholder={props.placeholder}
            value={props.value}
            autofocus
            validationState={props.error ? "invalid" : "valid"}
            error={props.error}
            disabled={props.busy}
            onChange={props.onChange}
            onKeyDown={keyDown}
          />
        </div>
        <TextField
          type="text"
          label={language.t("dialog.server.add.name")}
          placeholder={language.t("dialog.server.add.namePlaceholder")}
          defaultValue={props.name}
          disabled={props.busy}
          onChange={props.onNameChange}
          onKeyDown={keyDown}
        />
        <div class="grid grid-cols-2 gap-2 min-w-0">
          <TextField
            type="text"
            label={language.t("dialog.server.add.username")}
            placeholder={language.t("dialog.server.add.usernamePlaceholder")}
            defaultValue={props.username}
            disabled={props.busy}
            onChange={props.onUsernameChange}
            onKeyDown={keyDown}
          />
          <TextField
            type="password"
            label={language.t("dialog.server.add.password")}
            placeholder={language.t("dialog.server.add.passwordPlaceholder")}
            defaultValue={props.password}
            disabled={props.busy}
            onChange={props.onPasswordChange}
            onKeyDown={keyDown}
          />
        </div>
      </div>
    </div>
  )
}

export function ServerConnectionList(props: {
  domain: ServerCollectionController
  onAdd: () => void
  onEdit: (server: ServerConnection.Http) => void
}) {
  const language = useLanguage()

  return (
    <div class="flex flex-1 min-h-0 flex-col gap-4">
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-search-wrapper]]:w-full [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:overflow-y-auto [&_[data-slot=list-items]]:bg-surface-base [&_[data-slot=list-items]]:rounded-md [&_[data-slot=list-item]]:min-h-14 [&_[data-slot=list-item]]:p-3 [&_[data-slot=list-item]]:!bg-transparent"
        search={{
          placeholder: language.t("dialog.server.search.placeholder"),
          autofocus: false,
        }}
        noInitialSelection
        emptyMessage={language.t("dialog.server.empty")}
        items={props.domain.collection.items}
        key={(x) => x.http.url}
        divider={true}
      >
        {(i) => {
          const key = ServerConnection.key(i)
          return (
            <div class="flex items-center gap-3 min-w-0 flex-1 w-full group/item">
              <div class="flex flex-col h-full items-center w-5">
                <ServerHealthIndicator health={props.domain.collection.health()[key]} />
              </div>
              <ServerRow
                conn={i}
                dimmed={props.domain.collection.health()[key]?.healthy === false}
                status={props.domain.collection.health()[key]}
                class="flex items-center gap-3 min-w-0 flex-1"
                badge={
                  <Show when={props.domain.defaults.key() === ServerConnection.key(i)}>
                    <span class="text-text-base bg-surface-base text-14-regular px-1.5 rounded-xs">
                      {language.t("dialog.server.status.default")}
                    </span>
                  </Show>
                }
                showCredentials
              />
              <div class="flex items-center justify-center gap-4 pl-4">
                <Show when={i.type === "http"}>
                  <DropdownMenu>
                    <DropdownMenu.Trigger
                      as={IconButton}
                      icon="dot-grid"
                      variant="ghost"
                      class="shrink-0 size-8 hover:bg-surface-base-hover data-[expanded]:bg-surface-base-active"
                      onClick={(e: MouseEvent) => e.stopPropagation()}
                      onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                    />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="mt-1">
                        <DropdownMenu.Item
                          onSelect={() => {
                            if (i.type !== "http") return
                            props.onEdit(i)
                          }}
                        >
                          <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.edit")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <Show when={props.domain.defaults.available() && props.domain.defaults.key() !== key}>
                          <DropdownMenu.Item onSelect={() => props.domain.defaults.set(key)}>
                            <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.default")}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>
                        <Show when={props.domain.defaults.available() && props.domain.defaults.key() === key}>
                          <DropdownMenu.Item onSelect={() => props.domain.defaults.set(null)}>
                            <DropdownMenu.ItemLabel>
                              {language.t("dialog.server.menu.defaultRemove")}
                            </DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>
                        <Show when={props.domain.connection.canRemove(key)}>
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item
                            onSelect={() => props.domain.connection.remove(key)}
                            class="text-text-on-critical-base hover:bg-surface-critical-weak"
                          >
                            <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.delete")}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </Show>
              </div>
            </div>
          )
        }}
      </List>

      <div class="shrink-0 pb-5">
        <Button
          variant="secondary"
          icon="plus-small"
          size="large"
          onClick={props.onAdd}
          class="py-1.5 pl-1.5 pr-3 flex items-center gap-1.5"
        >
          {language.t("dialog.server.add.button")}
        </Button>
      </div>
    </div>
  )
}

export function ServerConnectionForm(props: { form: ServerConnectionFormController }) {
  const language = useLanguage()

  return (
    <div class="flex flex-1 min-h-0 flex-col gap-4">
      <ServerForm
        value={props.form.state.value()}
        name={props.form.state.name()}
        username={props.form.state.username()}
        password={props.form.state.password()}
        placeholder={language.t("dialog.server.add.placeholder")}
        busy={props.form.state.busy()}
        error={props.form.state.error()}
        status={props.form.state.status()}
        onChange={props.form.change.value}
        onNameChange={props.form.change.name}
        onUsernameChange={props.form.change.username}
        onPasswordChange={props.form.change.password}
        onSubmit={props.form.submit}
        onBack={props.form.reset}
      />
      <div class="shrink-0 pb-5">
        <Button
          variant="primary"
          size="large"
          onClick={props.form.submit}
          disabled={props.form.state.busy()}
          class="px-3 py-1.5"
        >
          {props.form.state.busy()
            ? language.t("dialog.server.add.checking")
            : props.form.state.adding()
              ? language.t("dialog.server.add.button")
              : language.t("common.save")}
        </Button>
      </div>
    </div>
  )
}
