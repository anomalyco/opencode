import { Component, Show, createMemo, createResource, type Accessor } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useUpdaterAction } from "../updater-action"
import { useSettings } from "@/context/settings"
import { Link } from "../link"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { LayoutRetirementNotice, LayoutTransitionToggle } from "./interface-transition"
import {
  createAppearanceSettingsController,
  createPermissionScopeController,
  createShellSettingsController,
  createSoundSettingsController,
  type AppearanceSettingsController,
  type PermissionScopeController,
  type ShellSelectOption,
  type ShellSettingsController,
  type SoundSelectOption,
  type SoundSettingsController,
} from "./general-controllers"
import "./settings-v2.css"

const PermissionScopeSetting: Component<{ controller: PermissionScopeController }> = (props) => {
  const language = useLanguage()
  return (
    <PermissionScopeSettingView
      title={language.t("command.permissions.autoaccept.enable")}
      description={language.t("toast.permissions.autoaccept.on.description")}
      checked={props.controller.accepting}
      enabled={props.controller.enabled}
      onChange={(checked) => props.controller.set(checked)}
    />
  )
}

const PermissionScopeSettingView: Component<{
  title: string
  description: string
  checked: Accessor<boolean>
  enabled: Accessor<boolean>
  onChange: (checked: boolean) => void
}> = (props) => (
  <SettingsRowV2 title={props.title} description={props.description}>
    <div data-action="settings-auto-accept-permissions">
      <Switch checked={props.checked()} disabled={!props.enabled()} onChange={props.onChange} />
    </div>
  </SettingsRowV2>
)

const ShellSetting: Component<{ controller: ShellSettingsController }> = (props) => {
  const language = useLanguage()
  return (
    <ShellSettingView
      title={language.t("settings.general.row.shell.title")}
      description={language.t("settings.general.row.shell.description")}
      options={props.controller.options}
      current={props.controller.current}
      onSelect={(option) => props.controller.select(option)}
    />
  )
}

const ShellSettingView: Component<{
  title: string
  description: string
  options: Accessor<ShellSelectOption[]>
  current: Accessor<ShellSelectOption | undefined>
  onSelect: (option: ShellSelectOption | null) => void
}> = (props) => (
  <SettingsRowV2 title={props.title} description={props.description}>
    <SelectV2
      appearance="inline"
      data-action="settings-shell"
      options={props.options()}
      current={props.current()}
      placement="bottom-end"
      gutter={6}
      value={(option) => option.id}
      label={(option) => option.label}
      onSelect={props.onSelect}
    />
  </SettingsRowV2>
)

const AppearanceSection: Component<{ controller: AppearanceSettingsController }> = (props) => {
  const language = useLanguage()
  return (
    <AppearanceSectionView
      t={language.t}
      schemeOptions={props.controller.scheme.options}
      currentScheme={props.controller.scheme.current}
      onSchemeSelect={props.controller.scheme.select}
      themeOptions={props.controller.theme.options}
      currentTheme={props.controller.theme.current}
      onThemeSelect={props.controller.theme.select}
      uiFont={props.controller.fonts.ui}
      codeFont={props.controller.fonts.code}
      terminalFont={props.controller.fonts.terminal}
      onUIFontInput={props.controller.fonts.setUI}
      onCodeFontInput={props.controller.fonts.setCode}
      onTerminalFontInput={props.controller.fonts.setTerminal}
    />
  )
}

type AppearanceSectionViewProps = {
  t: ReturnType<typeof useLanguage>["t"]
  schemeOptions: AppearanceSettingsController["scheme"]["options"]
  currentScheme: AppearanceSettingsController["scheme"]["current"]
  onSchemeSelect: AppearanceSettingsController["scheme"]["select"]
  themeOptions: AppearanceSettingsController["theme"]["options"]
  currentTheme: AppearanceSettingsController["theme"]["current"]
  onThemeSelect: AppearanceSettingsController["theme"]["select"]
  uiFont: AppearanceSettingsController["fonts"]["ui"]
  codeFont: AppearanceSettingsController["fonts"]["code"]
  terminalFont: AppearanceSettingsController["fonts"]["terminal"]
  onUIFontInput: (value: string) => void
  onCodeFontInput: (value: string) => void
  onTerminalFontInput: (value: string) => void
}

const AppearanceSectionView: Component<AppearanceSectionViewProps> = (props) => (
  <div class="settings-v2-section">
    <h3 class="settings-v2-section-title">{props.t("settings.general.section.appearance")}</h3>
    <SettingsListV2>
      <SettingsRowV2
        title={props.t("settings.general.row.colorScheme.title")}
        description={props.t("settings.general.row.colorScheme.description")}
      >
        <SelectV2
          appearance="inline"
          data-action="settings-color-scheme"
          options={props.schemeOptions()}
          current={props.currentScheme()}
          placement="bottom-end"
          gutter={6}
          value={(option) => option.value}
          label={(option) => option.label}
          onSelect={props.onSchemeSelect}
        />
      </SettingsRowV2>

      <SettingsRowV2
        title={props.t("settings.general.row.theme.title")}
        description={
          <>
            {props.t("settings.general.row.theme.description")}{" "}
            <Link class="settings-v2-link" href="https://opencode.ai/docs/themes/">
              {props.t("common.learnMore")}
            </Link>
          </>
        }
      >
        <SelectV2
          appearance="inline"
          data-action="settings-theme"
          options={props.themeOptions()}
          current={props.currentTheme()}
          placement="bottom-end"
          gutter={6}
          value={(option) => option.id}
          label={(option) => option.name}
          onSelect={props.onThemeSelect}
        />
      </SettingsRowV2>

      <FontSettingView
        action="settings-ui-font"
        title={props.t("settings.general.row.uiFont.title")}
        description={props.t("settings.general.row.uiFont.description")}
        font={props.uiFont}
        onInput={props.onUIFontInput}
      />
      <FontSettingView
        action="settings-code-font"
        title={props.t("settings.general.row.font.title")}
        description={props.t("settings.general.row.font.description")}
        font={props.codeFont}
        onInput={props.onCodeFontInput}
      />
      <FontSettingView
        action="settings-terminal-font"
        title={props.t("settings.general.row.terminalFont.title")}
        description={props.t("settings.general.row.terminalFont.description")}
        font={props.terminalFont}
        onInput={props.onTerminalFontInput}
      />
    </SettingsListV2>
  </div>
)

const FontSettingView: Component<{
  action: string
  title: string
  description: string
  font: Accessor<{ value: string; family: string; placeholder: string }>
  onInput: (value: string) => void
}> = (props) => (
  <SettingsRowV2 title={props.title} description={props.description}>
    <div class="w-full sm:w-[220px]">
      <TextInputV2
        data-action={props.action}
        type="text"
        appearance="base"
        value={props.font().value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        placeholder={props.font().placeholder}
        spellcheck={false}
        autocorrect="off"
        autocomplete="off"
        autocapitalize="off"
        aria-label={props.title}
        style={{ "font-family": props.font().family }}
      />
    </div>
  </SettingsRowV2>
)

const SoundsSection: Component<{ controller: SoundSettingsController }> = (props) => {
  const language = useLanguage()
  return (
    <SoundsSectionView
      t={language.t}
      options={props.controller.options}
      label={props.controller.label}
      agentCurrent={props.controller.agent.current}
      onAgentHighlight={(option) => props.controller.agent.highlight(option)}
      onAgentSelect={(option) => props.controller.agent.select(option)}
      permissionsCurrent={props.controller.permissions.current}
      onPermissionsHighlight={(option) => props.controller.permissions.highlight(option)}
      onPermissionsSelect={(option) => props.controller.permissions.select(option)}
      errorsCurrent={props.controller.errors.current}
      onErrorsHighlight={(option) => props.controller.errors.highlight(option)}
      onErrorsSelect={(option) => props.controller.errors.select(option)}
    />
  )
}

const SoundsSectionView: Component<{
  t: ReturnType<typeof useLanguage>["t"]
  options: SoundSelectOption[]
  label: (option: SoundSelectOption) => string
  agentCurrent: Accessor<SoundSelectOption>
  onAgentHighlight: (option: SoundSelectOption | undefined) => void
  onAgentSelect: (option: SoundSelectOption | null) => void
  permissionsCurrent: Accessor<SoundSelectOption>
  onPermissionsHighlight: (option: SoundSelectOption | undefined) => void
  onPermissionsSelect: (option: SoundSelectOption | null) => void
  errorsCurrent: Accessor<SoundSelectOption>
  onErrorsHighlight: (option: SoundSelectOption | undefined) => void
  onErrorsSelect: (option: SoundSelectOption | null) => void
}> = (props) => (
  <div class="settings-v2-section">
    <h3 class="settings-v2-section-title">{props.t("settings.general.section.sounds")}</h3>
    <SettingsListV2>
      <SoundSettingView
        action="settings-sounds-agent"
        title={props.t("settings.general.sounds.agent.title")}
        description={props.t("settings.general.sounds.agent.description")}
        options={props.options}
        label={props.label}
        current={props.agentCurrent}
        onHighlight={props.onAgentHighlight}
        onSelect={props.onAgentSelect}
      />
      <SoundSettingView
        action="settings-sounds-permissions"
        title={props.t("settings.general.sounds.permissions.title")}
        description={props.t("settings.general.sounds.permissions.description")}
        options={props.options}
        label={props.label}
        current={props.permissionsCurrent}
        onHighlight={props.onPermissionsHighlight}
        onSelect={props.onPermissionsSelect}
      />
      <SoundSettingView
        action="settings-sounds-errors"
        title={props.t("settings.general.sounds.errors.title")}
        description={props.t("settings.general.sounds.errors.description")}
        options={props.options}
        label={props.label}
        current={props.errorsCurrent}
        onHighlight={props.onErrorsHighlight}
        onSelect={props.onErrorsSelect}
      />
    </SettingsListV2>
  </div>
)

const SoundSettingView: Component<{
  action: string
  title: string
  description: string
  options: SoundSelectOption[]
  label: (option: SoundSelectOption) => string
  current: Accessor<SoundSelectOption>
  onHighlight: (option: SoundSelectOption | undefined) => void
  onSelect: (option: SoundSelectOption | null) => void
}> = (props) => (
  <SettingsRowV2 title={props.title} description={props.description}>
    <SelectV2
      appearance="inline"
      data-action={props.action}
      options={props.options}
      current={props.current()}
      value={(option) => option.id}
      label={props.label}
      onHighlight={props.onHighlight}
      onSelect={props.onSelect}
      placement="bottom-end"
      gutter={6}
    />
  </SettingsRowV2>
)

export const SettingsGeneralV2: Component<{
  sessionID?: string
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const settings = useSettings()
  const mobile = createMediaQuery("(max-width: 767px)")
  const updater = useUpdaterAction()
  const permissionScope = createPermissionScopeController(() => props.sessionID)
  const shell = createShellSettingsController()
  const appearance = createAppearanceSettingsController()
  const sounds = createSoundSettingsController()
  const desktop = createMemo(() => platform.platform === "desktop")

  const [pinchZoom, { mutate: setPinchZoom }] = createResource(
    () => desktop() && "getPinchZoomEnabled" in platform,
    () => Promise.resolve(platform.getPinchZoomEnabled?.() ?? false).catch(() => false),
    { initialValue: false },
  )

  const onPinchZoomChange = (checked: boolean) => {
    setPinchZoom(checked)
    const update = platform.setPinchZoomEnabled?.(checked)
    if (!update) return
    void update.catch(() => setPinchZoom(!checked))
  }

  const languageOptions = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )

  const InterfaceSection = () => (
    <LayoutTransitionToggle
      title={language.t("settings.general.row.newInterface.title")}
      badge={language.t("settings.general.row.newInterface.badge")}
      description={language.t("settings.general.row.newInterface.description")}
      checked={settings.general.newLayoutDesigns()}
      onChange={(checked) => {
        settings.general.setNewLayoutDesigns(checked)
        if (checked) return
        void import("@/components/dialog-settings").then((module) => {
          void dialog.show(() => <module.DialogSettings />)
        })
      }}
    />
  )

  const InterfaceNoticeSection = () => (
    <LayoutRetirementNotice
      title={language.t("settings.general.row.newInterfaceNotice.title")}
      description={language.t("settings.general.row.newInterfaceNotice.description")}
      dismiss={language.t("settings.general.row.newInterfaceNotice.dismiss")}
      onDismiss={() => settings.general.dismissNewInterfaceNotice()}
    />
  )

  const GeneralSection = () => (
    <div class="settings-v2-section">
      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.row.language.title")}
          description={language.t("settings.general.row.language.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-language"
            options={languageOptions()}
            placement="bottom-end"
            gutter={6}
            current={languageOptions().find((o) => o.value === language.locale())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && language.setLocale(option.value)}
          />
        </SettingsRowV2>

        <PermissionScopeSetting controller={permissionScope} />

        <ShellSetting controller={shell} />

        <SettingsRowV2
          title={language.t("settings.general.row.reasoningSummaries.title")}
          description={language.t("settings.general.row.reasoningSummaries.description")}
        >
          <div data-action="settings-feed-reasoning-summaries">
            <Switch
              checked={settings.general.showReasoningSummaries()}
              onChange={(checked) => settings.general.setShowReasoningSummaries(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.shellToolPartsExpanded.title")}
          description={language.t("settings.general.row.shellToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-shell-tool-parts-expanded">
            <Switch
              checked={settings.general.shellToolPartsExpanded()}
              onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.editToolPartsExpanded.title")}
          description={language.t("settings.general.row.editToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-edit-tool-parts-expanded">
            <Switch
              checked={settings.general.editToolPartsExpanded()}
              onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRowV2>

        <Show when={mobile() && import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"}>
          <SettingsRowV2
            title={language.t("settings.general.row.mobileTitlebarBottom.title")}
            description={language.t("settings.general.row.mobileTitlebarBottom.description")}
          >
            <div data-action="settings-mobile-titlebar-bottom">
              <Switch
                checked={settings.general.mobileTitlebarPosition() === "bottom"}
                onChange={(checked) => settings.general.setMobileTitlebarPosition(checked ? "bottom" : "top")}
              />
            </div>
          </SettingsRowV2>
        </Show>
      </SettingsListV2>
    </div>
  )

  const AdvancedSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.advanced")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.row.showFileTree.title")}
          description={language.t("settings.general.row.showFileTree.description")}
        >
          <div data-action="settings-show-file-tree">
            <Switch
              checked={settings.general.showFileTree()}
              onChange={(checked) => settings.general.setShowFileTree(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.showSearch.title")}
          description={language.t("settings.general.row.showSearch.description")}
        >
          <div data-action="settings-show-search">
            <Switch
              checked={settings.general.showSearch()}
              onChange={(checked) => settings.general.setShowSearch(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.showStatus.title")}
          description={language.t("settings.general.row.showStatus.description")}
        >
          <div data-action="settings-show-status">
            <Switch
              checked={settings.general.showStatus()}
              onChange={(checked) => settings.general.setShowStatus(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.showCustomAgents.title")}
          description={language.t("settings.general.row.showCustomAgents.description")}
        >
          <div data-action="settings-show-custom-agents">
            <Switch
              checked={settings.general.showCustomAgents()}
              onChange={(checked) => settings.general.setShowCustomAgents(checked)}
            />
          </div>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const NotificationsSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.notifications")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.notifications.agent.title")}
          description={language.t("settings.general.notifications.agent.description")}
        >
          <div data-action="settings-notifications-agent">
            <Switch
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.notifications.permissions.title")}
          description={language.t("settings.general.notifications.permissions.description")}
        >
          <div data-action="settings-notifications-permissions">
            <Switch
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.notifications.errors.title")}
          description={language.t("settings.general.notifications.errors.description")}
        >
          <div data-action="settings-notifications-errors">
            <Switch
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            />
          </div>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const UpdatesSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.updates")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.row.releaseNotes.title")}
          description={language.t("settings.general.row.releaseNotes.description")}
        >
          <div data-action="settings-release-notes">
            <Switch
              checked={settings.general.releaseNotes()}
              onChange={(checked) => settings.general.setReleaseNotes(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.updates.row.check.title")}
          description={language.t("settings.updates.row.check.description")}
        >
          <ButtonV2 size="normal" variant="neutral" disabled={!updater.action().run} onClick={() => updater.run()}>
            {language.t(updater.action().label)}
          </ButtonV2>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  // We can probably remove this, right?
  const DisplaySection = () => (
    <Show when={desktop()}>
      <div class="settings-v2-section">
        <h3 class="settings-v2-section-title">{language.t("settings.general.section.display")}</h3>

        <SettingsListV2>
          <SettingsRowV2
            title={language.t("settings.general.row.pinchZoom.title")}
            description={language.t("settings.general.row.pinchZoom.description")}
          >
            <div data-action="settings-pinch-zoom">
              <Switch checked={pinchZoom.latest} onChange={onPinchZoomChange} />
            </div>
          </SettingsRowV2>
        </SettingsListV2>
      </div>
    </Show>
  )

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.general")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <Show when={settings.general.layoutTransitionAvailable()}>
          <InterfaceSection />
        </Show>

        <Show when={settings.general.newInterfaceNoticeVisible()}>
          <InterfaceNoticeSection />
        </Show>

        <GeneralSection />

        <AppearanceSection controller={appearance} />

        <NotificationsSection />

        <SoundsSection controller={sounds} />

        <Show when={desktop()}>
          <UpdatesSection />
        </Show>

        <DisplaySection />

        <AdvancedSection />
      </div>
    </>
  )
}
