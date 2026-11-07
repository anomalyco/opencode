import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { Chevron } from "./icons"
import { selectLogoLabel } from "./design-mode"
import { LogoAnimationSettings } from "./logo-settings"
import {
  applyCarouselPreset,
  carouselBreakpoints,
  carouselPresetNames,
  cardVideoModes,
  cardHoverModes,
  cardVideoCuts,
  cardHoverEntries,
  mobileCovers,
  productBadgeModes,
  mobileOrbShades,
  cardVideoSpeeds,
  cardInfoLayouts,
  phoneCardContents,
  cardTones,
  cardEasings,
  cardTransitions,
  companionStyles,
  featureClipCounts,
  featureClipStyles,
  productFeatureColumns,
  consoleHeights,
  consoleLabels,
  consoleLayouts,
  cornerButtons,
  consoleSections,
  heroVariants,
  heroTitleSizes,
  heroInstalls,
  announcementStyles,
  bannerLabels,
  providerLogoStyles,
  subsStyles,
  getStartedStyles,
  phoneFeatureLists,
  installRowStyles,
  subtitleWidths,
  heroTextModes,
  logoAnimations,
  logoLabels,
  logoLayouts,
  logoRows,
  statsModes,
  ossProofs,
  ossVariants,
  avatarAnimations,
  toolsAnimations,
  avatarLinks,
  sidebarWidths,
  sectionWidths,
  sectionColumns,
  ditherDirectionsFor,
  ditherLengths,
  ditherOrientations,
  ditherPatterns,
  setDitherOrientation,
  setCarouselSetting,
  setSectionWidth,
  setSiteSetting,
  siteSettings,
  spacerStyles,
  terminalInstalls,
  toggles,
  toolGrids,
  toolTileStyles,
} from "./settings"
import { homeOrderChanged, resetHomeOrder } from "./home-order"
import { SettingsSelect, SettingsSlider, type SettingsSectionID } from "./site"
import { videoSetIds } from "./videos"

const sectionColumnSettings = [
  { key: "whatColumns", label: "What is OpenCode?", copy: "whatCopyColumns" },
  { key: "toolsColumns", label: "Bring your own tools", copy: "toolsCopyColumns" },
  { key: "openSourceColumns", label: "Open source", copy: "openSourceCopyColumns" },
  { key: "consoleColumns", label: "Console", copy: "consoleCopyColumns" },
] as const

/** The home and product page rows for one section of the settings panel. */
export default function PageSettings(props: { home?: boolean; terminal?: boolean; section: SettingsSectionID }) {
  const [width, setWidth] = createSignal(0)

  onMount(() => {
    const resize = () => setWidth(window.innerWidth)
    resize()
    window.addEventListener("resize", resize)
    onCleanup(() => window.removeEventListener("resize", resize))
  })

  return (
    <Switch>
      <Match when={props.section === "hero"}>
        <SettingsSelect
          label="Hero"
          options={heroVariants}
          value={siteSettings.hero}
          onChange={(hero) => setSiteSetting("hero", hero)}
        />
        <Show when={props.home}>
          <SettingsSelect
            label="Hero title size"
            options={heroTitleSizes}
            value={siteSettings.heroTitleSize}
            onChange={(value) => setSiteSetting("heroTitleSize", value)}
          />
        </Show>
        <SettingsSelect
          label="Subtitle width"
          options={subtitleWidths}
          value={siteSettings.subtitleWidth}
          onChange={(value) => setSiteSetting("subtitleWidth", value)}
        />
        <Show when={props.home}>
          <SettingsSelect
            label="Hero text"
            options={heroTextModes}
            value={siteSettings.heroText}
            onChange={(mode) => setSiteSetting("heroText", mode)}
          />
          <SettingsSelect
            label="Announcement"
            options={toggles}
            value={siteSettings.homeAnnouncement}
            onChange={(value) => setSiteSetting("homeAnnouncement", value)}
          />
          <SettingsSelect
            label="Announcement style"
            options={announcementStyles}
            value={siteSettings.announcementStyle}
            onChange={(value) => setSiteSetting("announcementStyle", value)}
          />
          <SettingsSelect
            label="Banner label"
            options={bannerLabels}
            value={siteSettings.bannerLabel}
            onChange={(value) => setSiteSetting("bannerLabel", value)}
          />
          <SettingsSelect
            label="Provider logos"
            options={providerLogoStyles}
            value={siteSettings.providerLogos}
            onChange={(value) => setSiteSetting("providerLogos", value)}
          />
          <SettingsSelect
            label="Subscriptions style"
            options={subsStyles}
            value={siteSettings.subsStyle}
            onChange={(value) => setSiteSetting("subsStyle", value)}
          />
          <SettingsSelect
            label="Get started style"
            options={getStartedStyles}
            value={siteSettings.getStartedStyle}
            onChange={(value) => setSiteSetting("getStartedStyle", value)}
          />
          <SettingsSelect
            label="Phone feature list"
            options={phoneFeatureLists}
            value={siteSettings.phoneFeatures}
            onChange={(value) => setSiteSetting("phoneFeatures", value)}
          />
          <SettingsSelect
            label="Hero install"
            options={heroInstalls}
            value={siteSettings.heroInstall}
            onChange={(value) => setSiteSetting("heroInstall", value)}
          />
          <SettingsSelect
            label="Install row style"
            options={installRowStyles}
            value={siteSettings.installRowStyle}
            onChange={(value) => setSiteSetting("installRowStyle", value)}
          />
        </Show>
      </Match>
      <Match when={props.section === "nav"}>
        <SettingsSelect
          label="Sidebar"
          options={sidebarWidths}
          value={siteSettings.sidebar}
          onChange={(sidebar) => setSiteSetting("sidebar", sidebar)}
        />
      </Match>
      <Match when={props.section === "logos"}>
        <Show when={props.home}>
          <SettingsSelect
            label="Logo row"
            options={logoRows}
            value={siteSettings.logoWall}
            onChange={(value) => setSiteSetting("logoWall", value)}
          />
          <Show when={siteSettings.logoWall !== "off"}>
            <SettingsSelect
              label="Logo layout"
              options={logoLayouts}
              value={siteSettings.logoLayout}
              onChange={(value) => setSiteSetting("logoLayout", value)}
            />
            <Show when={siteSettings.logoLayout !== "8 logos" && siteSettings.logoWall === "companies"}>
              <SettingsSelect
                label="Logo label"
                options={logoLabels}
                value={siteSettings.logoLabel}
                onChange={(value) => selectLogoLabel(logoLabels.indexOf(value))}
              />
            </Show>
            <SettingsSlider
              label="Logo opacity"
              unit="%"
              min={20}
              max={100}
              step={5}
              value={siteSettings.logoOpacity}
              onInput={(value) => setSiteSetting("logoOpacity", value)}
            />
            <SettingsSelect
              label="Logo animation"
              options={logoAnimations}
              value={siteSettings.logoAnimation}
              onChange={(value) => setSiteSetting("logoAnimation", value)}
            />
            <LogoAnimationSettings />
          </Show>
        </Show>
      </Match>
      <Match when={props.section === "carousel"}>
        <SettingsSelect
          label="Preset"
          options={carouselPresetNames}
          value={siteSettings.carouselPreset}
          onChange={applyCarouselPreset}
        />
        <details data-slot="group">
          <summary>
            Cards visible
            <Chevron />
          </summary>
          <For each={carouselBreakpoints}>
            {(breakpoint) => (
              <SettingsSlider
                label={breakpoint.label}
                unit=" cards"
                min={1}
                max={6}
                step={0.05}
                value={siteSettings.carousel[breakpoint.key]}
                onInput={(value) => setCarouselSetting(breakpoint.key, value)}
              />
            )}
          </For>
          <p data-slot="note">
            Window is {width()}px, so the {carouselBreakpoints.find((item) => width() >= item.min)?.label} row applies.
          </p>
        </details>
        <SettingsSelect
          label="Card videos"
          options={cardVideoModes}
          value={siteSettings.cardVideo}
          onChange={(mode) => setSiteSetting("cardVideo", mode)}
        />
        <SettingsSelect
          label="Card hover"
          options={cardHoverModes}
          value={siteSettings.cardHover}
          onChange={(mode) => setSiteSetting("cardHover", mode)}
        />
        <SettingsSelect
          label="Card hover entry"
          options={cardHoverEntries}
          value={siteSettings.cardHoverEntry}
          onChange={(entry) => setSiteSetting("cardHoverEntry", entry)}
        />
        <SettingsSelect
          label="Mobile cover"
          options={mobileCovers}
          value={siteSettings.mobileCover}
          onChange={(cover) => setSiteSetting("mobileCover", cover)}
        />
        <SettingsSelect
          label="NEW badges"
          options={productBadgeModes}
          value={siteSettings.productBadges}
          onChange={(mode) => setSiteSetting("productBadges", mode)}
        />
        <Show when={siteSettings.mobileCover === "orb"}>
          <SettingsSlider
            label="Orb shade"
            unit="%"
            min={0}
            max={100}
            step={25}
            value={siteSettings.mobileOrbShade}
            onInput={(value) =>
              setSiteSetting(
                "mobileOrbShade",
                mobileOrbShades.find((shade) => shade === Math.round(value / 25) * 25) ?? 75,
              )
            }
          />
        </Show>
        <SettingsSelect
          label="Card loop speed"
          options={cardVideoSpeeds.map((speed) => `${speed}×`)}
          value={`${siteSettings.cardLoopSpeed}×`}
          onChange={(speed) =>
            setSiteSetting("cardLoopSpeed", cardVideoSpeeds.find((item) => `${item}×` === speed) ?? 1)
          }
        />
        <SettingsSelect
          label="Card video cut"
          options={cardVideoCuts}
          value={siteSettings.cardVideoCut}
          onChange={(cut) => setSiteSetting("cardVideoCut", cut)}
        />
        <SettingsSelect
          label="Card colour"
          options={cardTones}
          value={siteSettings.cardTone}
          onChange={(tone) => setSiteSetting("cardTone", tone)}
        />
        <SettingsSelect
          label="Card info"
          options={cardInfoLayouts}
          value={siteSettings.cardInfo}
          onChange={(value) => setSiteSetting("cardInfo", value)}
        />
        <SettingsSelect
          label="Card content"
          options={phoneCardContents}
          value={siteSettings.phoneCardContent}
          onChange={(value) => setSiteSetting("phoneCardContent", value)}
        />
        <SettingsSelect
          label="Card to page"
          options={cardTransitions}
          value={siteSettings.cardTransition}
          onChange={(value) => setSiteSetting("cardTransition", value)}
        />
        <Show when={siteSettings.cardTransition === "grow"}>
          <details data-slot="group">
            <summary>
              Card to page speed
              <Chevron />
            </summary>
            <SettingsSlider
              label="Grow"
              unit="ms"
              min={200}
              max={800}
              step={10}
              value={siteSettings.cardGrowDuration}
              onInput={(value) => setSiteSetting("cardGrowDuration", value)}
            />
            <SettingsSlider
              label="Shrink back"
              unit="ms"
              min={70}
              max={800}
              step={10}
              value={siteSettings.cardShrinkDuration}
              onInput={(value) => setSiteSetting("cardShrinkDuration", value)}
            />
            <SettingsSelect
              label="Easing"
              options={cardEasings}
              value={siteSettings.cardEasing}
              onChange={(value) => setSiteSetting("cardEasing", value)}
            />
            <SettingsSlider
              label="Page fade"
              unit="ms"
              min={80}
              max={600}
              step={10}
              value={siteSettings.cardPageFade}
              onInput={(value) => setSiteSetting("cardPageFade", value)}
            />
            <SettingsSlider
              label="Page fade delay"
              unit="ms"
              min={0}
              max={300}
              step={10}
              value={siteSettings.cardPageDelay}
              onInput={(value) => setSiteSetting("cardPageDelay", value)}
            />
            <SettingsSlider
              label="Image fade"
              unit="ms"
              min={60}
              max={400}
              step={10}
              value={siteSettings.cardImageFade}
              onInput={(value) => setSiteSetting("cardImageFade", value)}
            />
          </details>
        </Show>
        <SettingsSelect
          label="Extensions card"
          options={toggles}
          value={siteSettings.extensionsCard}
          onChange={(value) => setSiteSetting("extensionsCard", value)}
        />
      </Match>
      <Match when={props.section === "sections"}>
        <Show when={props.home}>
          <button type="button" data-slot="jump" disabled={!homeOrderChanged()} onClick={resetHomeOrder}>
            Reset section order
          </button>
        </Show>
        <SettingsSelect
          label="Section spacer"
          options={spacerStyles}
          value={siteSettings.spacer}
          onChange={(spacer) => setSiteSetting("spacer", spacer)}
        />
        <Show when={siteSettings.spacer === "dot gradient"}>
          <SettingsSlider
            label="Gradient length"
            unit=" columns"
            min={0.5}
            max={4}
            step={0.25}
            value={siteSettings.spacerLength}
            onInput={(value) => setSiteSetting("spacerLength", value)}
          />
          <SettingsSlider
            label="Dash count"
            unit=""
            min={6}
            max={40}
            step={1}
            value={siteSettings.spacerCount}
            onInput={(value) => setSiteSetting("spacerCount", value)}
          />
          <SettingsSlider
            label="Start dash"
            unit="px"
            min={1}
            max={6}
            step={1}
            value={siteSettings.spacerStartDash}
            onInput={(value) => setSiteSetting("spacerStartDash", value)}
          />
          <SettingsSlider
            label="Start gap"
            unit="px"
            min={2}
            max={40}
            step={1}
            value={siteSettings.spacerStartGap}
            onInput={(value) => setSiteSetting("spacerStartGap", value)}
          />
          <SettingsSlider
            label="Curve"
            unit="×"
            min={1}
            max={4}
            step={0.1}
            value={siteSettings.spacerCurve}
            onInput={(value) => setSiteSetting("spacerCurve", value)}
          />
        </Show>
        <Show when={siteSettings.spacer === "dither gradient"}>
          <SettingsSlider
            label="Dither height"
            unit="px"
            min={4}
            max={96}
            step={1}
            value={siteSettings.ditherHeight}
            onInput={(value) => setSiteSetting("ditherHeight", value)}
          />
          <SettingsSelect
            label="Dither orientation"
            options={ditherOrientations}
            value={siteSettings.ditherOrientation}
            onChange={setDitherOrientation}
          />
          <SettingsSelect
            label="Dither direction"
            options={ditherDirectionsFor[siteSettings.ditherOrientation]}
            value={siteSettings.ditherDirection}
            onChange={(value) => setSiteSetting("ditherDirection", value)}
          />
          <Show when={siteSettings.ditherOrientation === "horizontal"}>
            <SettingsSelect
              label="Horizontal length"
              options={ditherLengths}
              value={siteSettings.ditherLength}
              onChange={(value) => setSiteSetting("ditherLength", value)}
            />
          </Show>
          <SettingsSlider
            label="Dither pixel"
            unit="px"
            min={1}
            max={4}
            step={1}
            value={siteSettings.ditherPixel}
            onInput={(value) => setSiteSetting("ditherPixel", value)}
          />
          <SettingsSelect
            label="Dither pattern"
            options={ditherPatterns}
            value={siteSettings.ditherPattern}
            onChange={(value) => setSiteSetting("ditherPattern", value)}
          />
          <SettingsSlider
            label="Dither density"
            unit="%"
            min={20}
            max={100}
            step={5}
            value={siteSettings.ditherDensity}
            onInput={(value) => setSiteSetting("ditherDensity", value)}
          />
          <SettingsSlider
            label="Dither strength"
            unit="%"
            min={10}
            max={100}
            step={5}
            value={siteSettings.ditherOpacity}
            onInput={(value) => setSiteSetting("ditherOpacity", value)}
          />
          <SettingsSlider
            label="Dither curve"
            unit="×"
            min={1}
            max={4}
            step={0.1}
            value={siteSettings.ditherCurve}
            onInput={(value) => setSiteSetting("ditherCurve", value)}
          />
          <SettingsSelect
            label="Dither line"
            options={toggles}
            value={siteSettings.ditherLine}
            onChange={(value) => setSiteSetting("ditherLine", value)}
          />
        </Show>
        <details data-slot="group">
          <summary>
            Section width
            <Chevron />
          </summary>
          <For each={carouselBreakpoints}>
            {(breakpoint) => (
              <SettingsSelect
                label={breakpoint.label}
                options={sectionWidths}
                value={siteSettings.sectionWidth[breakpoint.key]}
                onChange={(width) => setSectionWidth(breakpoint.key, width)}
              />
            )}
          </For>
          <p data-slot="note">
            At {width()}px the {carouselBreakpoints.find((item) => width() >= item.min)?.label} row applies. 3 columns
            leaves the fourth column blank.
          </p>
        </details>
        <Show when={props.home}>
          <details data-slot="group">
            <summary>
              Section columns
              <Chevron />
            </summary>
            <For each={sectionColumnSettings}>
              {(item) => (
                <>
                  <SettingsSelect
                    label={`${item.label} › Copy`}
                    options={sectionColumns}
                    value={siteSettings[item.copy]}
                    onChange={(value) => setSiteSetting(item.copy, value)}
                  />
                  <SettingsSelect
                    label={`${item.label} › Body`}
                    options={sectionColumns}
                    value={siteSettings[item.key]}
                    onChange={(value) => setSiteSetting(item.key, value)}
                  />
                </>
              )}
            </For>
            <p data-slot="note">From 1280px. Below that the sections follow the section width.</p>
          </details>
        </Show>
        <SettingsSelect
          label="Tools section"
          options={toggles}
          value={siteSettings.toolsSection}
          onChange={(value) => setSiteSetting("toolsSection", value)}
        />
        <SettingsSelect
          label="Tool tiles"
          options={toolTileStyles}
          value={siteSettings.toolTiles}
          onChange={(value) => setSiteSetting("toolTiles", value)}
        />
        <SettingsSelect
          label="Tool grid"
          options={toolGrids}
          value={siteSettings.toolGrid}
          onChange={(value) => setSiteSetting("toolGrid", value)}
        />
        <SettingsSelect
          label="Tools animation"
          options={toolsAnimations}
          value={siteSettings.toolsAnimation}
          onChange={(value) => setSiteSetting("toolsAnimation", value)}
        />
        <Show when={props.home}>
          <SettingsSelect
            label="Stats"
            options={statsModes}
            value={siteSettings.stats}
            onChange={(mode) => setSiteSetting("stats", mode)}
          />
          <SettingsSelect
            label="Open source variant"
            options={ossVariants}
            value={siteSettings.ossVariant}
            onChange={(value) => setSiteSetting("ossVariant", value)}
          />
          <SettingsSelect
            label="Open source proof"
            options={ossProofs}
            value={siteSettings.ossProof}
            onChange={(value) => setSiteSetting("ossProof", value)}
          />
          <SettingsSelect
            label="Avatar animation"
            options={avatarAnimations}
            value={siteSettings.avatarAnimation}
            onChange={(value) => setSiteSetting("avatarAnimation", value)}
          />
          <SettingsSelect
            label="Avatar links"
            options={avatarLinks}
            value={siteSettings.avatarLink}
            onChange={(value) => setSiteSetting("avatarLink", value)}
          />
          <SettingsSelect
            label="Console section"
            options={consoleSections}
            value={siteSettings.consoleSection}
            onChange={(section) => setSiteSetting("consoleSection", section)}
          />
          <SettingsSelect
            label="Console height"
            options={consoleHeights}
            value={siteSettings.consoleHeight}
            onChange={(height) => setSiteSetting("consoleHeight", height)}
          />
          <SettingsSelect
            label="Console label"
            options={consoleLabels}
            value={siteSettings.consoleLabel}
            onChange={(label) => setSiteSetting("consoleLabel", label)}
          />
          <SettingsSelect
            label="Console layout"
            options={consoleLayouts}
            value={siteSettings.consoleLayout}
            onChange={(layout) => setSiteSetting("consoleLayout", layout)}
          />
          <SettingsSlider
            label="Inline fade"
            unit="%"
            min={0}
            max={100}
            step={5}
            value={siteSettings.consoleClearing}
            onInput={(value) => setSiteSetting("consoleClearing", value)}
          />
          <SettingsSelect
            label="Corner button"
            options={cornerButtons}
            value={siteSettings.cornerButton}
            onChange={(style) => setSiteSetting("cornerButton", style)}
          />
        </Show>
      </Match>
      <Match when={props.section === "product"}>
        <Show when={!props.home}>
          <SettingsSelect
            label="Feature clips"
            options={featureClipStyles}
            value={siteSettings.featureClipStyle}
            onChange={(style) => setSiteSetting("featureClipStyle", style)}
          />
          <SettingsSelect
            label="Feature clips count"
            options={featureClipCounts}
            value={siteSettings.featureClipCount}
            onChange={(count) => setSiteSetting("featureClipCount", count)}
          />
          <SettingsSelect
            label="Feature grid"
            options={productFeatureColumns}
            value={siteSettings.productFeatureColumns}
            onChange={(value) => setSiteSetting("productFeatureColumns", value)}
          />
          <SettingsSelect
            label="Works great with OpenCode"
            options={companionStyles}
            value={siteSettings.companionStyle}
            onChange={(value) => setSiteSetting("companionStyle", value)}
          />
        </Show>
        <Show when={props.terminal}>
          <SettingsSelect
            label="Terminal install"
            options={terminalInstalls}
            value={siteSettings.terminalInstall}
            onChange={(value) => setSiteSetting("terminalInstall", value)}
          />
        </Show>
      </Match>
      <Match when={props.section === "video"}>
        <SettingsSelect
          label="Product videos"
          options={videoSetIds()}
          value={siteSettings.productVideos}
          onChange={(set) => setSiteSetting("productVideos", set)}
        />
      </Match>
    </Switch>
  )
}
