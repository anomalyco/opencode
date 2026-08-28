import { Button } from "@opencode-ai/ui/button"
import { Dialog, DialogFooter } from "@opencode-ai/ui/dialog"
import { Field } from "@opencode-ai/ui/field"
import { Icon } from "@opencode-ai/ui/icon"
import { ProjectAvatar, PROJECT_AVATAR_VARIANTS } from "@opencode-ai/ui/project-avatar"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Textarea } from "@opencode-ai/ui/textarea"
import { TextInput } from "@opencode-ai/ui/text-input"
import { For, Show, createSignal, startTransition } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { getProjectAvatarVariant, type LocalProject } from "@/shell/state/layout"
import { ServerConnection } from "@/runtime/server/registry"
import { LocationProvider } from "@/workspaces/location"
import { displayName } from "@/shell/layout/helpers"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { createEditProjectModel } from "./project-model"
import { ProjectSettingsExtensions } from "./project-extensions"
import { SettingsServerDataScope } from "@/settings/server-scope"
import "@/settings/settings.css"
import "./project-dialog.css"

export function DialogEditProject(props: { project: LocalProject; server: ServerConnection.Any }) {
  return (
    <SettingsServerDataScope server={props.server}>
      <LocationProvider directory={props.project.worktree}>
        <ProjectSettingsDialog project={props.project} server={props.server} />
      </LocationProvider>
    </SettingsServerDataScope>
  )
}

function ProjectSettingsDialog(props: { project: LocalProject; server: ServerConnection.Any }) {
  const language = useLanguage()
  const model = createEditProjectModel(props)
  const projectName = () => displayName(props.project)
  const [tab, setTab] = createSignal("general")

  const Footer = () => (
    <DialogFooter>
      <Button type="button" variant="neutral" disabled={model.save.isPending} onClick={model.close}>
        {language.t("common.cancel")}
      </Button>
      <Button type="submit" variant="contrast" disabled={model.save.isPending}>
        {model.save.isPending ? language.t("common.saving") : language.t("common.save")}
      </Button>
    </DialogFooter>
  )

  return (
    <Dialog size="x-large" variant="settings" class="project-settings-dialog">
      <Tabs
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class="project-settings-v2"
      >
        <Tabs.List>
          <div class="project-settings-nav">
            <Tabs.Trigger value="general">
              <ProjectIcon project={props.project} class="!size-4 shrink-0" />
              <span class="truncate">{projectName()}</span>
            </Tabs.Trigger>
            <Tabs.Trigger value="scripts">
              <Icon name="code" size="small" />
              {language.t("project.settings.scripts")}
            </Tabs.Trigger>
            <Tabs.Trigger value="extensions">
              <Icon name="extensions" size="small" />
              {language.t("settings.tab.extensions")}
            </Tabs.Trigger>
          </div>
        </Tabs.List>

        <Tabs.Content value="general" class="project-settings-panel">
          <form onSubmit={model.submit} class="project-settings-form">
            <div class="project-settings-scroll">
              <div class="project-settings-page-header">
                <h2>{language.t("dialog.project.edit.title")}</h2>
                <span>{language.t("project.settings.general.description")}</span>
              </div>

              <Field>
                <Field.Label>{language.t("dialog.project.edit.name")}</Field.Label>
                <TextInput
                  autofocus
                  appearance="large"
                  class="!w-full"
                  value={model.store.name}
                  placeholder={model.folderName()}
                  onInput={(event) => model.setStore("name", event.currentTarget.value)}
                />
              </Field>

              <div class="flex w-full flex-col gap-2">
                <div class="select-none text-[13px] font-[530] leading-text-compact tracking-[-0.04px] text-v2-text-text-base">
                  {language.t("dialog.project.edit.icon")}
                </div>
                <div class="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label={language.t("dialog.project.edit.icon.alt")}
                    class="relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-[6px] outline outline-1 outline-transparent transition-[background-color,outline-color] focus-visible:outline-v2-border-border-focus"
                    classList={{
                      "bg-v2-overlay-simple-overlay-hover outline-v2-border-border-focus": model.store.dragOver,
                    }}
                    onMouseEnter={() => model.setStore("iconHover", true)}
                    onMouseLeave={() => model.setStore("iconHover", false)}
                    onDrop={model.drop}
                    onDragOver={model.dragOver}
                    onDragLeave={model.dragLeave}
                    onClick={model.iconClick}
                  >
                    <ProjectIcon
                      project={props.project}
                      fallback={model.store.name || model.defaultName()}
                      icon={{
                        color: model.store.color,
                        url: props.project.icon?.url,
                        override: model.store.iconOverride,
                      }}
                      class="!size-16 [&_[data-slot=project-avatar-surface]]:!rounded-[6px] [&_[data-slot=project-avatar-surface]]:!text-[32px]"
                    />
                    <span
                      class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[6px] bg-v2-background-bg-contrast/80 text-v2-icon-icon-contrast backdrop-blur-[2px] transition-opacity"
                      classList={{
                        "opacity-100": model.store.iconHover,
                        "opacity-0": !model.store.iconHover,
                      }}
                    >
                      <Icon name={model.store.iconOverride ? "close" : "share"} />
                    </span>
                  </button>
                  <input
                    ref={(element) => model.setIconInput(element)}
                    type="file"
                    accept="image/*"
                    class="hidden"
                    onChange={model.inputChange}
                  />
                  <div class="flex select-none flex-col gap-[6px] text-[11px] font-[440] leading-none tracking-[0.05px] text-v2-text-text-muted">
                    <span>{language.t("dialog.project.edit.icon.hint")}</span>
                    <span>{language.t("dialog.project.edit.icon.recommended")}</span>
                  </div>
                </div>
                <Show when={model.icons.data?.length}>
                  <div class="-ml-1 flex flex-wrap gap-1.5">
                    <For each={model.icons.data}>
                      {(candidate) => (
                        <button
                          type="button"
                          aria-label={language.t("dialog.project.edit.icon.select", { path: candidate.path })}
                          aria-pressed={model.store.iconOverride === candidate.url}
                          class="flex size-8 items-center justify-center rounded-[10px] p-1 outline outline-1 outline-transparent transition-[background-color,outline-color] hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-v2-border-border-focus"
                          classList={{
                            "bg-v2-overlay-simple-overlay-hover [box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]":
                              model.store.iconOverride === candidate.url,
                          }}
                          onClick={() => model.setStore("iconOverride", candidate.url)}
                        >
                          <ProjectAvatar
                            fallback={model.store.name || model.defaultName()}
                            src={candidate.url}
                            variant={getProjectAvatarVariant(model.store.color)}
                            class="!size-6 [&_[data-slot=project-avatar-surface]]:!rounded-[6px]"
                          />
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <Show when={!model.store.iconOverride}>
                <div class="flex w-full flex-col gap-2">
                  <div class="select-none text-[13px] font-[530] leading-text-compact tracking-[-0.04px] text-v2-text-text-base">
                    {language.t("dialog.project.edit.color")}
                  </div>
                  <div class="-ml-1 flex gap-1.5">
                    <For each={PROJECT_AVATAR_VARIANTS}>
                      {(color) => (
                        <button
                          type="button"
                          aria-label={language.t("dialog.project.edit.color.select", { color })}
                          aria-pressed={getProjectAvatarVariant(model.store.color) === color}
                          class="flex size-8 items-center justify-center rounded-[10px] p-1 outline outline-1 outline-transparent transition-[background-color,outline-color] hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-v2-border-border-focus"
                          classList={{
                            "bg-v2-overlay-simple-overlay-hover [box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]":
                              getProjectAvatarVariant(model.store.color) === color,
                          }}
                          onClick={() => {
                            if (getProjectAvatarVariant(model.store.color) === color && !props.project.icon?.url) return
                            model.setStore(
                              "color",
                              getProjectAvatarVariant(model.store.color) === color ? undefined : color,
                            )
                          }}
                        >
                          <ProjectAvatar
                            fallback={model.store.name || model.defaultName()}
                            variant={getProjectAvatarVariant(color)}
                            class="!size-6 [&_[data-slot=project-avatar-surface]]:!rounded-[6px]"
                          />
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
            <Footer />
          </form>
        </Tabs.Content>

        <Tabs.Content value="scripts" class="project-settings-panel">
          <form onSubmit={model.submit} class="project-settings-form">
            <div class="project-settings-scroll">
              <div class="project-settings-page-header">
                <h2>{language.t("project.settings.scripts")}</h2>
                <span>{language.t("project.settings.scripts.description")}</span>
              </div>
              <Field>
                <Field.Label>{language.t("dialog.project.edit.worktree.startup")}</Field.Label>
                <Field.Prefix>{language.t("dialog.project.edit.worktree.startup.description")}</Field.Prefix>
                <Textarea
                  class="!w-full [&_[data-slot=textarea-v2-textarea]]:font-mono"
                  rows={5}
                  value={model.store.startup}
                  placeholder={language.t("dialog.project.edit.worktree.startup.placeholder")}
                  spellcheck={false}
                  onInput={(event) => model.setStore("startup", event.currentTarget.value)}
                />
              </Field>
            </div>
            <Footer />
          </form>
        </Tabs.Content>

        <Tabs.Content value="extensions" class="project-settings-panel">
          <ProjectSettingsExtensions />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
