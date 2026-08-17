import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@opencode-ai/ui/v2/dialog-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Icon } from "@opencode-ai/ui/icon"
import { ProjectAvatar, PROJECT_AVATAR_VARIANTS } from "@opencode-ai/ui/v2/project-avatar-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { For, Show, createSignal, startTransition } from "solid-js"
import { useLanguage } from "@/context/language"
import { getProjectAvatarVariant, type LocalProject } from "@/context/layout"
import { ServerConnection } from "@/context/servers"
import { LocationProvider } from "@/context/location"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
import { createEditProjectModel } from "./edit-project"
import { ProjectSettingsExtensions } from "./project-settings-extensions"
import { SettingsServerDataScope } from "./settings-server-picker"
import "./settings-v2/settings-v2.css"
import "./dialog-edit-project-v2.css"

export function DialogEditProjectV2(props: { project: LocalProject; server: ServerConnection.Any }) {
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
      <ButtonV2 type="button" variant="neutral" disabled={model.save.isPending} onClick={model.close}>
        {language.t("common.cancel")}
      </ButtonV2>
      <ButtonV2 type="submit" variant="contrast" disabled={!model.supported || model.save.isPending}>
        {model.save.isPending ? language.t("common.saving") : language.t("common.save")}
      </ButtonV2>
    </DialogFooter>
  )

  return (
    <Dialog size="x-large" variant="settings" class="project-settings-v2-dialog">
      <TabsV2
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class="project-settings-v2"
      >
        <TabsV2.List>
          <div class="project-settings-v2-nav">
            <TabsV2.Trigger value="general">
              <ProjectAvatar
                fallback={projectName()}
                variant={getProjectAvatarVariant(props.project.icon?.color)}
                class="!size-4 shrink-0"
              />
              <span class="truncate">{projectName()}</span>
            </TabsV2.Trigger>
            <TabsV2.Trigger value="scripts">
              <Icon name="code" size="small" />
              {language.t("project.settings.scripts")}
            </TabsV2.Trigger>
            <TabsV2.Trigger value="extensions">
              <Icon name="extensions" size="small" />
              {language.t("settings.tab.extensions")}
            </TabsV2.Trigger>
          </div>
        </TabsV2.List>

        <TabsV2.Content value="general" class="project-settings-v2-panel">
          <form onSubmit={model.submit} class="project-settings-v2-form">
            <div class="project-settings-v2-scroll">
              <div class="project-settings-page-header">
                <h2>{language.t("dialog.project.edit.title")}</h2>
                <span>{language.t("project.settings.general.description")}</span>
              </div>

              <Field>
                <Field.Label>{language.t("dialog.project.edit.name")}</Field.Label>
                <TextInputV2
                  autofocus
                  appearance="large"
                  class="!w-full"
                  value={model.store.name}
                  placeholder={model.folderName()}
                  onInput={(event) => model.setStore("name", event.currentTarget.value)}
                />
              </Field>

              <div class="flex w-full flex-col gap-2">
                <div class="select-none text-[13px] font-[530] leading-none tracking-[-0.04px] text-v2-text-text-base">
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
                    <ProjectAvatar
                      fallback={model.store.name || model.defaultName()}
                      src={getProjectAvatarSource(props.project.id, {
                        color: model.store.color,
                        url: props.project.icon?.url,
                        override: model.store.iconOverride,
                      })}
                      variant={getProjectAvatarVariant(model.store.color)}
                      class="!size-16 [&_[data-slot=project-avatar-surface]]:!rounded-[6px] [&_[data-slot=project-avatar-surface]]:!text-[32px]"
                    />
                    <span
                      class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[6px] bg-v2-background-bg-contrast/80 text-v2-icon-icon-contrast backdrop-blur-[2px] transition-opacity"
                      classList={{
                        "opacity-100": model.store.iconHover,
                        "opacity-0": !model.store.iconHover,
                      }}
                    >
                      <IconV2 name={model.store.iconOverride ? "close" : "share"} />
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
              </div>

              <Show when={!model.store.iconOverride}>
                <div class="flex w-full flex-col gap-2">
                  <div class="select-none text-[13px] font-[530] leading-none tracking-[-0.04px] text-v2-text-text-base">
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
        </TabsV2.Content>

        <TabsV2.Content value="scripts" class="project-settings-v2-panel">
          <form onSubmit={model.submit} class="project-settings-v2-form">
            <div class="project-settings-v2-scroll">
              <div class="project-settings-page-header">
                <h2>{language.t("project.settings.scripts")}</h2>
                <span>{language.t("project.settings.scripts.description")}</span>
              </div>
              <Field>
                <Field.Label>{language.t("dialog.project.edit.worktree.startup")}</Field.Label>
                <Field.Prefix>{language.t("dialog.project.edit.worktree.startup.description")}</Field.Prefix>
                <TextareaV2
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
        </TabsV2.Content>

        <TabsV2.Content value="extensions" class="project-settings-v2-panel">
          <ProjectSettingsExtensions />
        </TabsV2.Content>
      </TabsV2>
    </Dialog>
  )
}
