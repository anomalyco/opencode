import "./settings-panel.css"
import { createMemo, createSignal, For, type JSX, onMount, Show } from "solid-js"
import { Chevron } from "./icons"
import { monoFontDefault, monoFontsBuiltIn } from "./mono-fonts"
import { canQueryLocalFonts, installedMonoFonts, monoFontLabel, queryLocalMonoFonts } from "./mono-font-options"
import {
  addCustomNavItem,
  navConfigChanged,
  navVersions,
  removeNavItem,
  resetNav,
  restoreNavItem,
  setNavVisible,
} from "./nav-order"
import { siteLinks } from "./links"
import { useI18n } from "~/context/i18n"
import {
  bodyWeights,
  buttonHovers,
  copyrightMarks,
  brandAssetActionStyles,
  badgeFonts,
  badgeLayouts,
  badgeTabStyles,
  strokeDiagrams,
  agentButtonCopiedStyles,
  brandPalettes,
  variantBackgrounds,
  legalHubStyles,
  legalRowHovers,
  legalHistoryViews,
  legalPrintStyles,
  architectCovers,
  architectInteriors,
  architectRules,
  architectLabelCases,
  architectPatterns,
  legalSummaryStyles,
  darkBlues,
  footerLayouts,
  footerWordmarkAnimations,
  footerWordmarkPlays,
  lightBackgrounds,
  linkBlues,
  logoMenuHovers,
  logoMenuItems,
  logoMenus,
  stickyTitles,
  logoScales,
  logoVariants,
  menuActives,
  menuAligns,
  wideAligns,
  sectionMenuStyles,
  productChevrons,
  menuColors,
  navGroups,
  navVariants,
  popoverThemes,
  resetSearchLook,
  resetSiteSettings,
  searchBackdrops,
  searchHints,
  voiceOrbModes,
  voiceCaptionModes,
  searchMotions,
  searchResultModes,
  searchStyles,
  searchTints,
  selectionStyles,
  setSearchBackdrop,
  setSearchLook,
  setSiteSetting,
  siteSettings,
  statusBarCounts,
  statusPreviews,
  themeSwitcherStyles,
  toggles,
} from "./settings"
import { searchOpenEvent } from "./search"
import { devicePreviewAvailable, devicePreviewOpenEvent } from "./device-preview"
import { SettingsTransfer } from "./settings-transfer"
import { SettingsSelect, SettingsSlider, type SettingsSectionID } from "./site"
import type { themes } from "./icons"

/** The development settings panel, loaded the first time Settings opens. */
const navShown = ["shown", "hidden", "deleted"] as const

export default function SettingsPanel(props: {
  onClose: () => void
  /** Page-specific settings for each section. */
  settings?: (section: SettingsSectionID) => JSX.Element
  theme: (typeof themes)[number]
  onTheme: (theme: (typeof themes)[number]) => void
  onFooter: () => void
}) {
  const i18n = useI18n()
  // The nav items' own labels, for the rows of those not renamed.
  const navLabels = createMemo(() =>
    Object.fromEntries(siteLinks(i18n.t, (path) => path).nav.map((item) => [item.id, item.label])),
  )
  const navVersionNames = () => navVersions.all().map((version, index) => `${index + 1}. ${version.name}`)
  let panel: HTMLDivElement | undefined
  // Keyboard users land in the panel that opened, not back at the top of the page.
  onMount(() => panel?.focus({ preventScroll: true }))
  return (
    <>
      <div data-component="settings-backdrop" onClick={() => props.onClose()} />
      <div
        data-component="settings-panel"
        role="dialog"
        aria-label="Settings"
        tabindex="-1"
        ref={panel}
        onScroll={(event) => event.currentTarget.toggleAttribute("data-scrolled", event.currentTarget.scrollTop > 0)}
      >
        <header role="none">
          <span>Settings</span>
          <button type="button" aria-label="Close settings" onClick={() => props.onClose()}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.25"
              aria-hidden="true"
            >
              <path d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5" />
            </svg>
          </button>
        </header>
        {/* Only on the 404 arcade, which supplies its rows (component/site/arcade/settings.tsx). */}
        <Show when={props.settings?.("arcade")}>
          {(rows) => (
            <SettingsSection id="arcade" title="404 arcade">
              {rows()}
            </SettingsSection>
          )}
        </Show>
        <SettingsSection id="theme" title="Theme & colour">
          <SettingsSelect
            label="Link blue"
            options={linkBlues}
            value={siteSettings.linkBlue}
            onChange={(value) => setSiteSetting("linkBlue", value)}
          />
          <SettingsSelect
            label="Dark blue"
            options={darkBlues}
            value={siteSettings.darkBlue}
            onChange={(value) => setSiteSetting("darkBlue", value)}
          />
          <SettingsSelect
            label="Light background"
            options={lightBackgrounds}
            value={siteSettings.lightBackground}
            onChange={(value) => setSiteSetting("lightBackground", value)}
          />
          <SettingsSelect
            label="Logo size"
            options={logoScales}
            value={siteSettings.logoScale}
            onChange={(value) => setSiteSetting("logoScale", value)}
          />
          <SettingsSelect
            label="Menu active"
            options={menuActives}
            value={siteSettings.menuActive}
            onChange={(value) => setSiteSetting("menuActive", value)}
          />
          <SettingsSelect
            label="Menu color"
            options={menuColors}
            value={siteSettings.menuColor}
            onChange={(value) => setSiteSetting("menuColor", value)}
          />
          <SettingsSelect
            label="Button hover"
            options={buttonHovers}
            value={siteSettings.buttonHover}
            onChange={(value) => setSiteSetting("buttonHover", value)}
          />
          <SettingsSelect
            label="Menu align"
            options={menuAligns}
            value={siteSettings.menuAlign}
            onChange={(value) => setSiteSetting("menuAlign", value)}
          />
          <SettingsSelect
            label="Wide align"
            options={wideAligns}
            value={siteSettings.wideAlign}
            onChange={(value) => setSiteSetting("wideAlign", value)}
          />
          <SettingsSelect
            label="Section menu"
            options={sectionMenuStyles}
            value={siteSettings.sectionMenuStyle}
            onChange={(value) => setSiteSetting("sectionMenuStyle", value)}
          />
          <SettingsSelect
            label="Product switcher chevron (Console and Data)"
            options={productChevrons}
            value={siteSettings.productChevron}
            onChange={(value) => setSiteSetting("productChevron", value)}
          />
          <SettingsSelect
            label="Selection"
            options={selectionStyles}
            value={siteSettings.selection}
            onChange={(style) => setSiteSetting("selection", style)}
          />
          <Show when={siteSettings.selection === "muted blue"}>
            <SettingsSlider
              label="Selection opacity"
              unit="%"
              min={5}
              max={100}
              step={5}
              value={siteSettings.selectionOpacity}
              onInput={(value) => setSiteSetting("selectionOpacity", value)}
            />
          </Show>
          <SettingsSelect
            label="Body weight"
            options={bodyWeights}
            value={siteSettings.bodyWeight}
            onChange={(weight) => setSiteSetting("bodyWeight", weight)}
          />
          <MonoFontSetting />
          <SettingsSelect
            label="Pop-ups"
            options={popoverThemes}
            value={siteSettings.popover}
            onChange={(popover) => setSiteSetting("popover", popover)}
          />
          {props.settings?.("theme")}
        </SettingsSection>
        <SettingsSection id="nav" title="Nav & logo">
          <SettingsSelect
            label="Navigation"
            options={navVariants}
            value={siteSettings.nav}
            onChange={(nav) => setSiteSetting("nav", nav)}
          />
          <SettingsSelect
            label="Nav groups"
            options={navGroups}
            value={siteSettings.navGroups}
            onChange={(value) => setSiteSetting("navGroups", value)}
          />
          {/* The nav's items, shown or hidden. Design mode edits them on the nav itself: drag to
              reorder, the eye to show or hide, a click on a label to rename. */}
          <For each={siteSettings.navConfig}>
            {(entry) => (
              <SettingsSelect
                label={`Nav: ${entry.label ?? navLabels()[entry.id]}`}
                options={navShown}
                value={entry.removed ? "deleted" : entry.visible ? "shown" : "hidden"}
                onChange={(value) => {
                  if (value === "deleted") return removeNavItem(entry.id)
                  if (entry.removed) restoreNavItem(entry.id)
                  setNavVisible(entry.id, value === "shown")
                }}
              />
            )}
          </For>
          {/* A link of your own at the end of the nav. */}
          <form
            data-slot="setting"
            data-kind="nav-link"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              if (addCustomNavItem(String(form.get("label")), String(form.get("url")))) event.currentTarget.reset()
            }}
          >
            <span>Add link</span>
            <input name="label" placeholder="Label" aria-label="Link label" required />
            <input name="url" placeholder="URL or /path" aria-label="Link URL" required />
            <button type="submit">Add</button>
          </form>
          <button type="button" data-slot="jump" disabled={!navConfigChanged()} onClick={resetNav}>
            Reset nav
          </button>
          {/* Saved versions of the nav list, as in Design mode's control under the nav. */}
          <SettingsSelect
            label="Nav version"
            options={navVersionNames()}
            value={navVersionNames()[navVersions.all().findIndex((version) => version.id === navVersions.active().id)]}
            onChange={(value) => {
              const version = navVersions.all()[navVersionNames().indexOf(value)]
              if (version) navVersions.switchTo(version.id)
            }}
          />
          <Show when={!navVersions.readOnly(navVersions.active().id)}>
            <label data-slot="setting">
              <span>Version name</span>
              <input
                type="text"
                value={navVersions.active().name}
                onChange={(event) => navVersions.rename(navVersions.active().id, event.currentTarget.value)}
              />
            </label>
          </Show>
          <button type="button" data-slot="jump" onClick={() => navVersions.save()}>
            Save nav as a new version
          </button>
          <button
            type="button"
            data-slot="jump"
            disabled={navVersions.readOnly(navVersions.active().id) || !navVersions.edited()}
            onClick={() => navVersions.update()}
          >
            Update version
          </button>
          <button
            type="button"
            data-slot="jump"
            disabled={navVersions.readOnly(navVersions.active().id)}
            onClick={() => navVersions.remove(navVersions.active().id)}
          >
            Delete version
          </button>
          <SettingsSelect
            label="Product nav demo"
            options={toggles}
            value={siteSettings.productNavDemo}
            onChange={(value) => setSiteSetting("productNavDemo", value)}
          />
          <SettingsSelect
            label="Logo"
            options={logoVariants}
            value={siteSettings.logo}
            onChange={(logo) => setSiteSetting("logo", logo)}
          />
          <SettingsSelect
            label="Logo menu"
            options={logoMenus}
            value={siteSettings.logoMenu}
            onChange={(value) => setSiteSetting("logoMenu", value)}
          />
          <SettingsSelect
            label="Logo menu hover"
            options={logoMenuHovers}
            value={siteSettings.logoMenuHover}
            onChange={(value) => setSiteSetting("logoMenuHover", value)}
          />
          <SettingsSelect
            label="Logo menu item"
            options={logoMenuItems}
            value={siteSettings.logoMenuItem}
            onChange={(value) => setSiteSetting("logoMenuItem", value)}
          />
          {props.settings?.("nav")}
        </SettingsSection>
        <SettingsSection id="hero" title="Hero">
          {props.settings?.("hero")}
          <SettingsSlider
            label="Hero size"
            unit="%"
            min={50}
            max={150}
            step={1}
            value={siteSettings.heroSize}
            onInput={(value) => setSiteSetting("heroSize", value)}
          />
          <SettingsSelect
            label="Sticky title"
            options={stickyTitles}
            value={siteSettings.stickyTitle}
            onChange={(value) => setSiteSetting("stickyTitle", value)}
          />
        </SettingsSection>
        <SettingsSection id="logos" title="Logo row">
          {props.settings?.("logos")}
        </SettingsSection>
        <SettingsSection id="carousel" title="Product carousel">
          {props.settings?.("carousel")}
        </SettingsSection>
        <SettingsSection id="sections" title="Sections">
          {props.settings?.("sections")}
        </SettingsSection>
        <SettingsSection id="product" title="Product pages">
          {props.settings?.("product")}
        </SettingsSection>
        <SettingsSection id="video" title="Video">
          {props.settings?.("video")}
        </SettingsSection>
        <SettingsSection id="docs" title="Docs">
          {props.settings?.("docs")}
        </SettingsSection>
        <SettingsSection id="footer" title="Footer">
          <SettingsSelect
            label="Footer"
            options={footerLayouts}
            value={siteSettings.footerLayout}
            onChange={(value) => setSiteSetting("footerLayout", value)}
          />
          <SettingsSelect
            label="Status bars"
            options={statusBarCounts}
            value={siteSettings.statusBars}
            onChange={(value) => setSiteSetting("statusBars", value)}
          />
          <SettingsSelect
            label="Footer wordmark"
            options={toggles}
            value={siteSettings.footerWordmark}
            onChange={(value) => setSiteSetting("footerWordmark", value)}
          />
          <SettingsSlider
            label="Wordmark hatch"
            unit=""
            min={1}
            max={8}
            step={0.25}
            value={siteSettings.wordmarkHatch}
            onInput={(value) => setSiteSetting("wordmarkHatch", value)}
          />
          <SettingsSelect
            label="Wordmark nodes"
            options={toggles}
            value={siteSettings.wordmarkNodes}
            onChange={(value) => setSiteSetting("wordmarkNodes", value)}
          />
          <SettingsSelect
            label="Wordmark animation"
            options={footerWordmarkAnimations}
            value={siteSettings.footerWordmarkAnimation}
            onChange={(value) => setSiteSetting("footerWordmarkAnimation", value)}
          />
          <SettingsSlider
            label="Wordmark speed"
            unit="×"
            min={0.5}
            max={2}
            step={0.25}
            value={siteSettings.footerWordmarkSpeed}
            onInput={(value) => setSiteSetting("footerWordmarkSpeed", value)}
          />
          <SettingsSelect
            label="Wordmark play"
            options={footerWordmarkPlays}
            value={siteSettings.footerWordmarkPlay}
            onChange={(value) => setSiteSetting("footerWordmarkPlay", value)}
          />
          <SettingsSelect
            label="Theme switch"
            options={toggles}
            value={siteSettings.themeSwitcher}
            onChange={(value) => setSiteSetting("themeSwitcher", value)}
          />
          <SettingsSelect
            label="Theme switch style"
            options={themeSwitcherStyles}
            value={siteSettings.themeSwitcherStyle}
            onChange={(value) => setSiteSetting("themeSwitcherStyle", value)}
          />
          <SettingsSelect
            label="Copyright mark"
            options={copyrightMarks}
            value={siteSettings.copyrightMark}
            onChange={(value) => setSiteSetting("copyrightMark", value)}
          />
          <SettingsSelect
            label="Status"
            options={statusPreviews}
            value={siteSettings.status}
            onChange={(status) => setSiteSetting("status", status)}
          />
          {props.settings?.("footer")}
        </SettingsSection>
        <SettingsSection id="search" title="Search">
          <SettingsSelect
            label="Search style"
            options={searchStyles}
            value={siteSettings.searchStyle}
            onChange={(value) => setSiteSetting("searchStyle", value)}
          />
          <SettingsSelect
            label="Search backdrop"
            options={searchBackdrops}
            value={siteSettings.searchBackdrop}
            onChange={setSearchBackdrop}
          />
          <SettingsSlider
            label="Backdrop blur"
            unit="px"
            min={0}
            max={24}
            step={1}
            value={siteSettings.searchBlur}
            onInput={(value) => setSearchLook("searchBlur", value)}
          />
          <SettingsSlider
            label="Overlay light"
            unit="%"
            min={0}
            max={80}
            step={1}
            value={siteSettings.searchDimLight}
            onInput={(value) => setSearchLook("searchDimLight", value)}
          />
          <SettingsSlider
            label="Overlay dark"
            unit="%"
            min={0}
            max={80}
            step={1}
            value={siteSettings.searchDimDark}
            onInput={(value) => setSearchLook("searchDimDark", value)}
          />
          <SettingsSelect
            label="Overlay tint"
            options={searchTints}
            value={siteSettings.searchTint}
            onChange={(value) => setSearchLook("searchTint", value)}
          />
          <SettingsSlider
            label="Backdrop saturation"
            unit="%"
            min={50}
            max={200}
            step={5}
            value={siteSettings.searchSaturate}
            onInput={(value) => setSearchLook("searchSaturate", value)}
          />
          <SettingsSlider
            label="Backdrop brightness"
            unit="%"
            min={50}
            max={120}
            step={5}
            value={siteSettings.searchBrightness}
            onInput={(value) => setSearchLook("searchBrightness", value)}
          />
          <SettingsSlider
            label="Panel opacity"
            unit="%"
            min={60}
            max={100}
            step={1}
            value={siteSettings.searchPanelOpacity}
            onInput={(value) => setSearchLook("searchPanelOpacity", value)}
          />
          <SettingsSlider
            label="Panel blur"
            unit="px"
            min={0}
            max={40}
            step={1}
            value={siteSettings.searchPanelBlur}
            onInput={(value) => setSearchLook("searchPanelBlur", value)}
          />
          <SettingsSlider
            label="Panel shadow"
            unit="%"
            min={0}
            max={200}
            step={5}
            value={siteSettings.searchShadow}
            onInput={(value) => setSearchLook("searchShadow", value)}
          />
          <SettingsSelect
            label="Search motion"
            options={searchMotions}
            value={siteSettings.searchMotion}
            onChange={(value) => setSiteSetting("searchMotion", value)}
          />
          <SettingsSelect
            label="Search results"
            options={searchResultModes}
            value={siteSettings.searchResults}
            onChange={(value) => setSiteSetting("searchResults", value)}
          />
          <SettingsSelect
            label="Search hint"
            options={searchHints}
            value={siteSettings.searchHint}
            onChange={(value) => setSiteSetting("searchHint", value)}
          />
          <SettingsSelect
            label="Voice orb"
            options={voiceOrbModes}
            value={siteSettings.voiceOrb}
            onChange={(value) => setSiteSetting("voiceOrb", value)}
          />
          <SettingsSelect
            label="Voice captions"
            options={voiceCaptionModes}
            value={siteSettings.voiceCaptions}
            onChange={(value) => setSiteSetting("voiceCaptions", value)}
          />
          <SettingsSlider
            label="Orb shadow"
            unit="%"
            min={0}
            max={100}
            step={5}
            value={siteSettings.voiceOrbShadow}
            onInput={(value) => setSiteSetting("voiceOrbShadow", value)}
          />
          {/* Opens the search under this panel, so the rows above change it live. */}
          <div data-slot="actions">
            <button type="button" data-slot="jump" onClick={() => document.dispatchEvent(new Event(searchOpenEvent))}>
              Preview
            </button>
            <button type="button" data-slot="jump" onClick={resetSearchLook}>
              Reset search look
            </button>
          </div>
        </SettingsSection>
        <SettingsSection id="other" title="Other">
          <SettingsSelect
            label="Console API"
            options={toggles}
            value={siteSettings.consoleApi}
            onChange={(value) => setSiteSetting("consoleApi", value)}
          />
          <SettingsSelect
            label="Brand colours"
            options={brandPalettes}
            value={siteSettings.brandPalette}
            onChange={(value) => setSiteSetting("brandPalette", value)}
          />
          <SettingsSelect
            label="Variant background"
            options={variantBackgrounds}
            value={siteSettings.variantBackground}
            onChange={(value) => setSiteSetting("variantBackground", value)}
          />
          <SettingsSelect
            label="Brand badge"
            options={toggles}
            value={siteSettings.brandBadge}
            onChange={(value) => setSiteSetting("brandBadge", value)}
          />
          <SettingsSelect
            label="Badge font"
            options={badgeFonts}
            value={siteSettings.badgeFont}
            onChange={(value) => setSiteSetting("badgeFont", value)}
          />
          <SettingsSelect
            label="Badge layout"
            options={badgeLayouts}
            value={siteSettings.badgeLayout}
            onChange={(value) => setSiteSetting("badgeLayout", value)}
          />
          <SettingsSelect
            label="Badge tab style"
            options={badgeTabStyles}
            value={siteSettings.badgeTabStyle}
            onChange={(value) => setSiteSetting("badgeTabStyle", value)}
          />
          <SettingsSelect
            label="Stroke diagram"
            options={strokeDiagrams}
            value={siteSettings.strokeDiagram}
            onChange={(value) => setSiteSetting("strokeDiagram", value)}
          />
          <SettingsSelect
            label="Agent button copied"
            options={agentButtonCopiedStyles}
            value={siteSettings.agentButtonCopied}
            onChange={(value) => setSiteSetting("agentButtonCopied", value)}
          />
          <SettingsSelect
            label="Brand asset actions"
            options={brandAssetActionStyles}
            value={siteSettings.brandAssetActions}
            onChange={(value) => setSiteSetting("brandAssetActions", value)}
          />
          <SettingsSelect
            label="Legal list"
            options={legalHubStyles}
            value={siteSettings.legalHubStyle}
            onChange={(value) => setSiteSetting("legalHubStyle", value)}
          />
          <SettingsSelect
            label="Legal row hover"
            options={legalRowHovers}
            value={siteSettings.legalRowHover}
            onChange={(value) => setSiteSetting("legalRowHover", value)}
          />
          <SettingsSelect
            label="Legal review notes"
            options={toggles}
            value={siteSettings.legalReviewNotes}
            onChange={(value) => setSiteSetting("legalReviewNotes", value)}
          />
          <SettingsSelect
            label="Legal history"
            options={legalHistoryViews}
            value={siteSettings.legalHistoryView}
            onChange={(value) => setSiteSetting("legalHistoryView", value)}
          />
          <SettingsSelect
            label="Legal print"
            options={legalPrintStyles}
            value={siteSettings.legalPrintStyle}
            onChange={(value) => setSiteSetting("legalPrintStyle", value)}
          />
          <SettingsSelect
            label="Architect cover"
            options={architectCovers}
            value={siteSettings.architectCover}
            onChange={(value) => setSiteSetting("architectCover", value)}
          />
          <SettingsSelect
            label="Architect pages"
            options={architectInteriors}
            value={siteSettings.architectInterior}
            onChange={(value) => setSiteSetting("architectInterior", value)}
          />
          <SettingsSelect
            label="Architect dividers"
            options={architectRules}
            value={siteSettings.architectRule}
            onChange={(value) => setSiteSetting("architectRule", value)}
          />
          <SettingsSelect
            label="Architect labels"
            options={architectLabelCases}
            value={siteSettings.architectLabelCase}
            onChange={(value) => setSiteSetting("architectLabelCase", value)}
          />
          <SettingsSelect
            label="Architect pattern"
            options={architectPatterns}
            value={siteSettings.architectPattern}
            onChange={(value) => setSiteSetting("architectPattern", value)}
          />
          <SettingsSelect
            label="Legal summary"
            options={legalSummaryStyles}
            value={siteSettings.legalSummaryStyle}
            onChange={(value) => setSiteSetting("legalSummaryStyle", value)}
          />
          {props.settings?.("other")}
        </SettingsSection>

        <div data-slot="actions">
          <button type="button" data-slot="jump" onClick={props.onFooter}>
            Scroll to footer
          </button>
          <Show when={devicePreviewAvailable()}>
            <button
              type="button"
              data-slot="jump"
              onClick={() => {
                props.onClose()
                document.dispatchEvent(new Event(devicePreviewOpenEvent))
              }}
            >
              Device preview ⇧P
            </button>
          </Show>
          <button type="button" data-slot="jump" onClick={resetSiteSettings}>
            Reset all
          </button>
        </div>
        <SettingsTransfer theme={props.theme} onTheme={props.onTheme} />
      </div>
    </>
  )
}

/**
 * Settings › Mono font: the site's fonts, then those installed on this Mac, with a sample in the
 * mono stack as it is now. In Chrome, the installed list can also be read live.
 */
function MonoFontSetting() {
  const [found, setFound] = createSignal<string>()
  return (
    <div data-slot="mono-font">
      <label data-slot="setting">
        <span>Mono font</span>
        <select
          value={siteSettings.monoFont}
          onChange={(event) => setSiteSetting("monoFont", event.currentTarget.value)}
        >
          <optgroup label="Site fonts">
            <For each={monoFontsBuiltIn}>
              {(family) => (
                <option value={family}>{family === monoFontDefault ? `${family} (default)` : family}</option>
              )}
            </For>
          </optgroup>
          <optgroup label="Installed on this Mac">
            <For each={installedMonoFonts()}>{(family) => <option value={family}>{monoFontLabel(family)}</option>}</For>
          </optgroup>
        </select>
      </label>
      <p data-slot="mono-preview" aria-hidden="true">
        [01] Docs · opencode run
      </p>
      <Show when={canQueryLocalFonts()}>
        <button
          type="button"
          data-slot="jump"
          onClick={() =>
            queryLocalMonoFonts().then(
              (count) => setFound(`${count} found`),
              () => setFound("Not allowed"),
            )
          }
        >
          Read installed fonts {found() ? `(${found()})` : ""}
        </button>
      </Show>
    </div>
  )
}

const settingsSectionsKey = "opencode-site-settings-sections"

/** A collapsible section of the settings panel. Its open state persists; sections with no rows hide. */
function SettingsSection(props: { id: SettingsSectionID; title: string; children: JSX.Element }) {
  const stored = () => JSON.parse(localStorage.getItem(settingsSectionsKey) ?? "{}") as Record<string, boolean>
  return (
    <details
      data-slot="section"
      open={stored()[props.id] ?? false}
      onToggle={(event) =>
        localStorage.setItem(settingsSectionsKey, JSON.stringify({ ...stored(), [props.id]: event.currentTarget.open }))
      }
    >
      <summary>
        {props.title}
        <Chevron />
      </summary>
      <div data-slot="section-body">{props.children}</div>
    </details>
  )
}
