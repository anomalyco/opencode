import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import {
  cardEasings,
  searchBackdrops,
  searchHints,
  voiceOrbModes,
  voiceCaptionModes,
  searchMotions,
  searchResultModes,
  searchStyles,
  searchTints,
  setSearchBackdrop,
  setSearchLook,
  cardInfoLayouts,
  phoneCardContents,
  cardTones,
  cardTransitions,
  cardVideoModes,
  cardHoverModes,
  cardVideoCuts,
  cardHoverEntries,
  mobileCovers,
  productBadgeModes,
  mobileOrbShades,
  cardVideoSpeeds,
  companionStyles,
  consoleHeights,
  consoleLabels,
  consoleLayouts,
  consoleSections,
  copyrightMarks,
  docsNavs,
  docsSubmenus,
  docsSwitchers,
  docsVersionNotices,
  featureClipCounts,
  featureClipStyles,
  footerLayouts,
  footerLinkSets,
  footerWordmarkAnimations,
  footerWordmarkPlays,
  statusBarCounts,
  heroTextModes,
  heroTitleSizes,
  heroInstalls,
  announcementStyles,
  bannerLabels,
  providerLogoStyles,
  subsStyles,
  getStartedStyles,
  phoneFeatureLists,
  installRowStyles,
  stickyTitles,
  heroVariants,
  lightBackgrounds,
  logoAnimations,
  logoLabels,
  logoLayouts,
  logoMenuHovers,
  logoMenuItems,
  pressIconNames,
  logoMenus,
  logoRows,
  logoScales,
  menuActives,
  menuColors,
  buttonHovers,
  productButtons,
  pairStyles,
  menuAligns,
  wideAligns,
  sectionMenuStyles,
  productChevrons,
  navGroups,
  navNumbers,
  sectionColumns,
  spacerStyles,
  ditherDirectionsFor,
  ditherLengths,
  ditherOrientations,
  ditherPatterns,
  setDitherOrientation,
  labelSiteSettings,
  setSiteSetting,
  siteSettings,
  docsVariantComponents,
  docsVariantKeys,
  docsVariantOptionsFor,
  type DocsVariantKey,
  statsModes,
  ossProofs,
  ossVariants,
  avatarAnimations,
  toolsAnimations,
  avatarLinks,
  subtitleWidths,
  themeSwitcherStyles,
  toggles,
  changelogMarkers,
  changelogTitleSizes,
  changelogTitles,
  brandAssetActionStyles,
  badgeFonts,
  badgeLayouts,
  badgeTabStyles,
  strokeDiagrams,
  agentButtonCopiedStyles,
  filmPosters,
  brandPalettes,
  variantBackgrounds,
  pressBoilerplates,
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
  pressCompanyStyles,
  pressContactStyles,
  pressCopyStyles,
  pressMediaLayouts,
  changelogCarousels,
  toolGrids,
  toolTileStyles,
  arcadeCrts,
  arcadeMobileCopies,
  type SiteSettings,
} from "./settings"
import { homeOrderChanged, homeSorting, resetHomeOrder, SectionHandles } from "./home-order"
import { navConfigChanged, navSorting, resetNav } from "./nav-order"
import { navVersionsBusy } from "./nav-versions"
import { productsOrderChanged, productsSorting, resetProductsOrder } from "./products-order"
import { videoSetIds } from "./videos"
import { monoFontLabel, monoFontOptions } from "./mono-font-options"
import {
  copy,
  copyOptions,
  copyVariants,
  designMode,
  editing,
  fallbacks,
  isCopyId,
  saveCopy,
  selectLogoLabel,
  selector,
  setCopy,
  setDesignMode,
  setEditing,
  type CopyId,
} from "./design-mode"

type Control = {
  label: string
  values: () => readonly string[]
  index: () => number
  select: (index: number) => void
  /** Set for copy, where the current option may be one you added. */
  remove?: { allowed: () => boolean; run: () => void }
}

function setting<K extends keyof SiteSettings>(
  key: K,
  label: string,
  options: () => readonly SiteSettings[K][],
): Control {
  return {
    label,
    values: () => options().map(String),
    index: () => options().indexOf(siteSettings[key]),
    select: (index) => setSiteSetting(key, options()[index]),
  }
}

// One control per docs content component (docs-variants.css): data-design="docs-callout" and so on.
function docsVariant(key: DocsVariantKey): Control {
  return {
    label: `Docs ${docsVariantComponents[key].toLowerCase()}`,
    values: () => docsVariantOptionsFor(key),
    index: () => docsVariantOptionsFor(key).indexOf(siteSettings.docsVariants[key]),
    select: (index) =>
      setSiteSetting("docsVariants", { ...siteSettings.docsVariants, [key]: docsVariantOptionsFor(key)[index] }),
  }
}

// Moving a look slider makes the backdrop "custom"; cycling it picks one of the presets.
const backdropPresets = searchBackdrops.filter((value) => value !== "custom")

// Options that remove the element itself ("off") are left out, so the control never strands you.
const settingControls: Record<string, Control> = {
  ...Object.fromEntries(docsVariantKeys.map((key) => [`docs-${key}`, docsVariant(key)])),
  hero: setting("hero", "Hero", () => heroVariants),
  heroText: setting("heroText", "Hero text", () => heroTextModes),
  heroInstall: setting("heroInstall", "Hero install", () => heroInstalls),
  homeAnnouncement: setting("homeAnnouncement", "Announcement", () => toggles),
  announcementStyle: setting("announcementStyle", "Announcement style", () => announcementStyles),
  bannerLabel: setting("bannerLabel", "Banner label", () => bannerLabels),
  providerLogos: setting("providerLogos", "Provider logos", () => providerLogoStyles),
  subsStyle: setting("subsStyle", "Subscriptions style", () => subsStyles),
  getStartedStyle: setting("getStartedStyle", "Get started style", () => getStartedStyles),
  phoneFeatures: setting("phoneFeatures", "Phone feature list", () => phoneFeatureLists),
  installRowStyle: setting("installRowStyle", "Install row style", () => installRowStyles),
  heroTitleSize: setting("heroTitleSize", "Hero title size", () => heroTitleSizes),
  subtitleWidth: setting("subtitleWidth", "Subtitle width", () => subtitleWidths),
  stickyTitle: setting("stickyTitle", "Sticky title", () => stickyTitles),
  logoWall: setting("logoWall", "Logo row", () => logoRows.filter((row) => row !== "off")),
  logoAnimation: setting("logoAnimation", "Logo animation", () => logoAnimations),
  logoStagger: setting("logoStagger", "Logo stagger ms", () => [70, 100, 120, 160, 200, 250, 300]),
  logoLayout: setting("logoLayout", "Logo layout", () => logoLayouts),
  logoDividers: setting("logoDividers", "Logo dividers", () => toggles),
  // Choosing a label clears a Design mode copy choice for it, so the chosen label shows.
  logoLabel: { ...setting("logoLabel", "Logo label", () => logoLabels), select: selectLogoLabel },
  cardTone: setting("cardTone", "Card colour", () => cardTones),
  cardInfo: setting("cardInfo", "Card info", () => cardInfoLayouts),
  phoneCardContent: setting("phoneCardContent", "Card content", () => phoneCardContents),
  cardVideo: setting("cardVideo", "Card videos", () => cardVideoModes),
  cardHover: setting("cardHover", "Card hover", () => cardHoverModes),
  cardHoverEntry: setting("cardHoverEntry", "Card hover entry", () => cardHoverEntries),
  mobileCover: setting("mobileCover", "Mobile cover", () => mobileCovers),
  productBadges: setting("productBadges", "NEW badges", () => productBadgeModes),
  mobileOrbShade: setting("mobileOrbShade", "Orb shade", () => mobileOrbShades),
  cardLoopSpeed: setting("cardLoopSpeed", "Card loop speed", () => cardVideoSpeeds),
  cardVideoCut: setting("cardVideoCut", "Card video cut", () => cardVideoCuts),
  cardTransition: setting("cardTransition", "Card to page", () => cardTransitions),
  cardGrowDuration: setting("cardGrowDuration", "Grow ms", () => [260, 320, 380, 460, 560, 700]),
  cardShrinkDuration: setting("cardShrinkDuration", "Shrink back ms", () => [80, 100, 110, 130, 150, 180, 220]),
  cardEasing: setting("cardEasing", "Card easing", () => cardEasings),
  extensionsCard: setting("extensionsCard", "Extensions card", () => toggles),
  stats: setting("stats", "Stats", () => statsModes),
  ossProof: setting("ossProof", "Open source proof", () => ossProofs),
  ossVariant: setting("ossVariant", "Open source variant", () => ossVariants),
  avatarAnimation: setting("avatarAnimation", "Avatar animation", () => avatarAnimations),
  avatarLink: setting("avatarLink", "Avatar links", () => avatarLinks),
  avatarStagger: setting("avatarStagger", "Avatar stagger ms", () => [20, 30, 35, 40, 50, 60, 80]),
  toolTiles: setting("toolTiles", "Tool tiles", () => toolTileStyles),
  toolGrid: setting("toolGrid", "Tool grid", () => toolGrids),
  toolsAnimation: setting("toolsAnimation", "Tools animation", () => toolsAnimations),
  toolsStagger: setting("toolsStagger", "Tools stagger ms", () => [30, 45, 60, 80, 100, 140]),
  consoleSection: setting("consoleSection", "Console", () => consoleSections.filter((item) => item !== "off")),
  consoleHeight: setting("consoleHeight", "Console height", () => consoleHeights),
  consoleLabel: setting("consoleLabel", "Console label", () => consoleLabels),
  consoleLayout: setting("consoleLayout", "Console layout", () => consoleLayouts),
  // Page-wide, offered on each home section and the logo row.
  spacer: setting("spacer", "Section spacer", () => spacerStyles),
  spacerLength: setting("spacerLength", "Gradient length", () => [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4]),
  spacerCount: setting("spacerCount", "Dash count", () => [6, 8, 12, 16, 20, 24, 30, 40]),
  spacerStartDash: setting("spacerStartDash", "Start dash px", () => [1, 2, 3, 4, 6]),
  spacerStartGap: setting("spacerStartGap", "Start gap px", () => [8, 12, 16, 20, 24, 32, 40]),
  spacerCurve: setting("spacerCurve", "Curve", () => [1, 1.4, 2, 2.5, 3, 4]),
  ditherHeight: setting("ditherHeight", "Dither height", () => [8, 12, 16, 24, 32, 48, 64, 96]),
  // Switching orientation also moves the direction onto one the new orientation offers.
  ditherOrientation: {
    ...setting("ditherOrientation", "Dither orientation", () => ditherOrientations),
    select: (index) => setDitherOrientation(ditherOrientations[index]),
  },
  ditherDirection: setting(
    "ditherDirection",
    "Dither direction",
    () => ditherDirectionsFor[siteSettings.ditherOrientation],
  ),
  ditherLength: setting("ditherLength", "Horizontal length", () => ditherLengths),
  ditherPixel: setting("ditherPixel", "Dither pixel", () => [1, 2, 3, 4]),
  ditherPattern: setting("ditherPattern", "Dither pattern", () => ditherPatterns),
  ditherDensity: setting("ditherDensity", "Dither density", () => [20, 40, 60, 70, 80, 100]),
  ditherOpacity: setting("ditherOpacity", "Dither strength", () => [15, 25, 35, 50, 75, 100]),
  ditherCurve: setting("ditherCurve", "Dither curve", () => [1, 1.5, 2, 3, 4]),
  ditherLine: setting("ditherLine", "Dither line", () => toggles),
  whatColumns: setting("whatColumns", "Body columns", () => sectionColumns),
  toolsColumns: setting("toolsColumns", "Body columns", () => sectionColumns),
  openSourceColumns: setting("openSourceColumns", "Body columns", () => sectionColumns),
  consoleColumns: setting("consoleColumns", "Body columns", () => sectionColumns),
  whatCopyColumns: setting("whatCopyColumns", "Copy columns", () => sectionColumns),
  toolsCopyColumns: setting("toolsCopyColumns", "Copy columns", () => sectionColumns),
  openSourceCopyColumns: setting("openSourceCopyColumns", "Copy columns", () => sectionColumns),
  consoleCopyColumns: setting("consoleCopyColumns", "Copy columns", () => sectionColumns),
  footerLayout: setting("footerLayout", "Footer", () => footerLayouts),
  footerLinks: setting("footerLinks", "Footer links", () => footerLinkSets),
  statusBars: setting("statusBars", "Status bars", () => statusBarCounts),
  copyrightMark: setting("copyrightMark", "Copyright mark", () => copyrightMarks),
  themeSwitcherStyle: setting("themeSwitcherStyle", "Theme switch", () => themeSwitcherStyles),
  footerWordmarkAnimation: setting("footerWordmarkAnimation", "Wordmark animation", () => footerWordmarkAnimations),
  footerWordmarkPlay: setting("footerWordmarkPlay", "Wordmark play", () => footerWordmarkPlays),
  footerWordmarkSpeed: setting("footerWordmarkSpeed", "Wordmark speed ×", () => [0.5, 0.75, 1, 1.25, 1.5, 2]),
  // Page-wide, but offered on the footer, which sits on the bare page background.
  lightBackground: setting("lightBackground", "Light background", () => lightBackgrounds),
  logoScale: setting("logoScale", "Logo size", () => logoScales),
  menuActive: setting("menuActive", "Menu active", () => menuActives),
  menuColor: setting("menuColor", "Menu color", () => menuColors),
  buttonHover: setting("buttonHover", "Button hover", () => buttonHovers),
  productButton: setting("productButton", "Product button", () => productButtons),
  pairStyle: setting("pairStyle", "Pair style", () => pairStyles),
  menuAlign: setting("menuAlign", "Menu align", () => menuAligns),
  // Page-wide, but offered on the sidebar nav, which it moves.
  wideAlign: setting("wideAlign", "Wide align", () => wideAligns),
  // Site-wide, offered on the sidebar nav, which is set in it.
  monoFont: {
    ...setting("monoFont", "Mono font", monoFontOptions),
    values: () => monoFontOptions().map(monoFontLabel),
  },
  sectionMenuStyle: setting("sectionMenuStyle", "Section menu", () => sectionMenuStyles),
  productChevron: setting("productChevron", "Product switcher chevron (Console and Data)", () => productChevrons),
  // On the logo, whose right-click opens the menu: cycle here, then right-click to see it.
  logoMenu: setting("logoMenu", "Logo menu", () => logoMenus),
  logoMenuItem: setting("logoMenuItem", "Logo menu item", () => logoMenuItems),
  logoMenuHover: setting("logoMenuHover", "Logo menu hover", () => logoMenuHovers),
  pressIcon: setting("pressIcon", "Press icon", () => pressIconNames),
  navGroups: setting("navGroups", "Nav groups", () => navGroups),
  navNumbers: setting("navNumbers", "Nav numbers", () => navNumbers),
  productNavDemo: setting("productNavDemo", "Product nav demo", () => toggles),
  productVideos: setting("productVideos", "Product videos", videoSetIds),
  featureClipStyle: setting("featureClipStyle", "Feature clips", () => featureClipStyles),
  featureClipCount: setting("featureClipCount", "Feature clips count", () => featureClipCounts),
  companionStyle: setting("companionStyle", "Works great with OpenCode", () => companionStyles),
  docsSwitcher: setting("docsSwitcher", "Docs switcher", () => docsSwitchers),
  docsSubmenu: setting("docsSubmenu", "Docs submenu", () => docsSubmenus),
  docsNav: setting("docsNav", "Docs nav", () => docsNavs),
  docsVersionNotice: setting("docsVersionNotice", "V1 notice", () => docsVersionNotices),
  changelogSticky: setting("changelogSticky", "Changelog sticky", () => toggles),
  changelogMarker: setting("changelogMarker", "Changelog marker", () => changelogMarkers),
  changelogTitle: setting("changelogTitle", "Changelog title", () => changelogTitles),
  changelogTitleSize: setting("changelogTitleSize", "Changelog title size", () => changelogTitleSizes),
  brandPalette: setting("brandPalette", "Brand colours", () => brandPalettes),
  variantBackground: setting("variantBackground", "Variant background", () => variantBackgrounds),
  brandBadge: setting("brandBadge", "Brand badge", () => toggles),
  badgeFont: setting("badgeFont", "Badge font", () => badgeFonts),
  badgeLayout: setting("badgeLayout", "Badge layout", () => badgeLayouts),
  badgeTabStyle: setting("badgeTabStyle", "Badge tab style", () => badgeTabStyles),
  strokeDiagram: setting("strokeDiagram", "Stroke diagram", () => strokeDiagrams),
  agentButtonCopied: setting("agentButtonCopied", "Agent button copied", () => agentButtonCopiedStyles),
  filmPoster: setting("filmPoster", "Film poster", () => filmPosters),
  brandAssetActions: setting("brandAssetActions", "Brand asset actions", () => brandAssetActionStyles),
  legalHubStyle: setting("legalHubStyle", "Legal list", () => legalHubStyles),
  legalRowHover: setting("legalRowHover", "Legal row hover", () => legalRowHovers),
  legalReviewNotes: setting("legalReviewNotes", "Legal review notes", () => toggles),
  legalHistoryView: setting("legalHistoryView", "Legal history", () => legalHistoryViews),
  legalPrintStyle: setting("legalPrintStyle", "Legal print", () => legalPrintStyles),
  architectCover: setting("architectCover", "Architect cover", () => architectCovers),
  architectInterior: setting("architectInterior", "Architect pages", () => architectInteriors),
  architectRule: setting("architectRule", "Architect dividers", () => architectRules),
  architectLabelCase: setting("architectLabelCase", "Architect labels", () => architectLabelCases),
  architectPattern: setting("architectPattern", "Architect pattern", () => architectPatterns),
  legalSummaryStyle: setting("legalSummaryStyle", "Legal summary", () => legalSummaryStyles),
  pressToc: setting("pressToc", "Press: on this page", () => toggles),
  pressBoilerplate: setting("pressBoilerplate", "Press boilerplate", () => pressBoilerplates),
  pressMilestones: setting("pressMilestones", "Press milestones", () => toggles),
  pressNews: setting("pressNews", "Press latest releases", () => toggles),
  pressMedia: setting("pressMedia", "Press media", () => toggles),
  pressCompany: setting("pressCompany", "Press Anomaly projects", () => pressCompanyStyles),
  pressContact: setting("pressContact", "Press contacts", () => pressContactStyles),
  pressCopyStyle: setting("pressCopyStyle", "Press copy style", () => pressCopyStyles),
  pressMediaLayout: setting("pressMediaLayout", "Press media layout", () => pressMediaLayouts),
  changelogCarousel: setting("changelogCarousel", "Changelog carousel", () => changelogCarousels),
  // On the ⌘K search dialog, which has no element on the page until it is open.
  searchStyle: setting("searchStyle", "Search style", () => searchStyles),
  searchBackdrop: {
    ...setting("searchBackdrop", "Search backdrop", () => backdropPresets),
    select: (index) => setSearchBackdrop(backdropPresets[index]),
  },
  searchMotion: setting("searchMotion", "Search motion", () => searchMotions),
  searchResults: setting("searchResults", "Search results", () => searchResultModes),
  searchHint: setting("searchHint", "Search hint", () => searchHints),
  arcadeCrt: setting("arcadeCrt", "Arcade CRT", () => arcadeCrts),
  arcadeMobileCopy: setting("arcadeMobileCopy", "Arcade phone message", () => arcadeMobileCopies),
  voiceOrb: setting("voiceOrb", "Voice orb", () => voiceOrbModes),
  voiceCaptions: setting("voiceCaptions", "Voice captions", () => voiceCaptionModes),
  voiceOrbShadow: setting("voiceOrbShadow", "Orb shadow %", () => [0, 15, 30, 50, 65, 80, 100]),
  searchBlur: searchLook("searchBlur", "Backdrop blur px", [0, 2, 4, 6, 8, 12, 16, 24]),
  searchDimLight: searchLook("searchDimLight", "Overlay light %", [0, 8, 16, 24, 32, 48, 64, 80]),
  searchDimDark: searchLook("searchDimDark", "Overlay dark %", [0, 16, 32, 44, 56, 64, 72, 80]),
  searchTint: searchLook("searchTint", "Overlay tint", searchTints),
  searchSaturate: searchLook("searchSaturate", "Backdrop saturation %", [50, 75, 100, 125, 150, 200]),
  searchBrightness: searchLook("searchBrightness", "Backdrop brightness %", [50, 70, 85, 100, 110, 120]),
  searchPanelOpacity: searchLook("searchPanelOpacity", "Panel opacity %", [60, 70, 80, 90, 95, 100]),
  searchPanelBlur: searchLook("searchPanelBlur", "Panel blur px", [0, 8, 16, 24, 32, 40]),
  searchShadow: searchLook("searchShadow", "Panel shadow %", [0, 50, 100, 150, 200]),
}

// The undo toast names a setting by its control's label, where only one control has that label.
labelSiteSettings(
  Object.fromEntries(
    Object.entries(settingControls)
      .filter(
        ([, control]) => Object.values(settingControls).filter((item) => item.label === control.label).length === 1,
      )
      .map(([key, control]) => [key, control.label]),
  ),
)

function searchLook<K extends Parameters<typeof setSearchLook>[0]>(
  key: K,
  label: string,
  options: readonly SiteSettings[K][],
): Control {
  return { ...setting(key, label, () => options), select: (index) => setSearchLook(key, options[index]) }
}

function copyControl(id: CopyId): Control {
  const builtIn = copyVariants[id].options.length
  const select = (index: number) => {
    setCopy("choice", id, index)
    saveCopy()
  }
  return {
    label: copyVariants[id].label,
    values: () => [
      "original",
      ...copyVariants[id].options.map((_, index) => `alt ${index + 1}`),
      ...(copy.custom[id] ?? []).map((_, index) => `custom ${index + 1}`),
    ],
    index: () => copy.choice[id] ?? 0,
    select,
    remove: {
      allowed: () => (copy.choice[id] ?? 0) > builtIn,
      run: () => {
        const index = copy.choice[id] ?? 0
        const text = copyOptions(id)[index - 1]
        if (!text || !window.confirm(`Delete this ${copyVariants[id].label.toLowerCase()} option?\n\n${text}`)) return
        setCopy("custom", id, (list) => (list ?? []).filter((_, item) => item !== index - 1 - builtIn))
        select(index - 1)
      },
    },
  }
}

/** Saves edited text: an existing option is selected again, new text becomes a new option. */
function commitCopy(id: CopyId, text: string) {
  if (!text) return
  const existing = [fallbacks[id] ?? "", ...copyOptions(id)].indexOf(text)
  if (existing >= 0) {
    setCopy("choice", id, existing)
    return saveCopy()
  }
  setCopy("custom", id, (list) => [...(list ?? []), text])
  setCopy("choice", id, copyOptions(id).length)
  saveCopy()
}

function readCopy(element: Element, lines: number) {
  const clean = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim()
  if (lines < 2 || element.children.length < lines) return clean(element.textContent)
  // Each child element starts a line; text typed between them belongs to the line before.
  const parts = [""]
  const seen = { element: false }
  for (const node of element.childNodes) {
    if (node instanceof Element && seen.element) parts.push("")
    if (node instanceof Element) seen.element = true
    // Comments (hydration markers) are skipped.
    if (node instanceof Element || node instanceof Text) parts[parts.length - 1] += node.textContent ?? ""
  }
  return parts.map(clean).filter(Boolean).join("\n")
}

// Editing changes the DOM that Solid owns. Keep every original node and its text, and put them
// back afterwards, so the store update that follows reaches the nodes Solid still holds.
function snapshot(root: Node) {
  const saved: { node: Node; children: Node[]; text?: string }[] = []
  const walk = (node: Node) => {
    saved.push({ node, children: [...node.childNodes], text: node instanceof Text ? node.data : undefined })
    node.childNodes.forEach(walk)
  }
  walk(root)
  return () =>
    saved.forEach((item) => {
      if (item.node instanceof Text && item.text !== undefined) item.node.data = item.text
      if (item.node instanceof Element) item.node.replaceChildren(...item.children)
    })
}

function startEdit(element: Element, id: CopyId, x: number, y: number) {
  // Rolling copy renders as plain text while it is edited (see designEditing).
  setEditing(id)
  const live = element.isConnected ? element : document.querySelector(`[data-design-copy="${id}"]`)
  if (!(live instanceof HTMLElement)) return setEditing(undefined)
  const restore = snapshot(live)
  const state = { done: false }
  const finish = (save: boolean) => {
    if (state.done) return
    state.done = true
    live.removeEventListener("keydown", key)
    live.removeEventListener("blur", blur)
    const text = readCopy(live, copyVariants[id].lines)
    live.removeAttribute("contenteditable")
    live.removeAttribute("spellcheck")
    // A caret left in a node that restore() removes would make the browser scroll to wherever the
    // selection lands.
    window.getSelection()?.removeAllRanges()
    restore()
    setEditing(undefined)
    if (save) commitCopy(id, text)
  }
  const key = (event: KeyboardEvent) => {
    // Kept from the page's own shortcuts (Escape also turns Design mode off).
    event.stopPropagation()
    if (event.key === "Enter") {
      event.preventDefault()
      finish(true)
    }
    if (event.key === "Escape") {
      event.preventDefault()
      finish(false)
    }
    // Chrome also scrolls the page on Home and End when the caret is already at the line's edge.
    if ((event.key === "Home" || event.key === "End") && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      window
        .getSelection()
        ?.modify(event.shiftKey ? "extend" : "move", event.key === "End" ? "forward" : "backward", "lineboundary")
    }
  }
  const blur = () => finish(true)
  live.setAttribute("contenteditable", "plaintext-only")
  live.setAttribute("spellcheck", "false")
  live.addEventListener("keydown", key)
  live.addEventListener("blur", blur)
  live.focus()
  const position = document.caretPositionFromPoint?.(x, y)
  const range = document.createRange()
  if (position && live.contains(position.offsetNode)) range.setStart(position.offsetNode, position.offset)
  if (!position || !live.contains(position.offsetNode)) range.selectNodeContents(live)
  range.collapse(!!position && live.contains(position.offsetNode))
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
}

function controlsFor(element: Element) {
  return [
    ...(element.getAttribute("data-design")?.split(" ") ?? [])
      .filter((key) => key in settingControls)
      // The dot gradient's own controls only show while it is the spacer.
      .filter((key) => siteSettings.spacer === "dot gradient" || !/^spacer./.test(key))
      .filter((key) => siteSettings.spacer === "dither gradient" || !key.startsWith("dither"))
      .filter((key) => key !== "ditherLength" || siteSettings.ditherOrientation === "horizontal")
      .map((key) => settingControls[key]),
    ...(element.getAttribute("data-design-copy")?.split(" ") ?? []).filter(isCopyId).map(copyControl),
  ]
}

function step(control: Control, direction: 1 | -1) {
  const count = control.values().length
  if (count === 0) return
  const index = control.index()
  if (index < 0) return control.select(direction > 0 ? 0 : count - 1)
  control.select((index + direction + count) % count)
}

type Box = { top: number; left: number; width: number; height: number; x: number; y: number }

const sameBox = (a: Box | undefined, b: Box | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height &&
    a.x === b.x &&
    a.y === b.y)

/**
 * Where the controls go, just outside the element so they never cover it: above its top-right
 * corner, else below its bottom-right corner, else (a tall element with neither edge in view) at
 * the top of the viewport beside its right edge, else in the viewport's top-right corner. Fixed
 * bars (the sidebar, the small-screen top bar) and the export buttons are kept clear.
 *
 * The controls' padding is the gap (--design-gap) and is transparent, so the controls' box sits
 * flush against the outline: the pointer crosses the gap without leaving the controls.
 */
function place(element: Element, rect: DOMRect, panel: HTMLElement | undefined) {
  const width = panel?.offsetWidth ?? 0
  const height = panel?.offsetHeight ?? 0
  const gap = panel ? parseFloat(getComputedStyle(panel).paddingRight) : 0
  const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight }
  const fixed = [...document.querySelectorAll('[data-component="sidebar"], [data-component="topbar"]')]
    .filter((bar) => !bar.contains(element) && ["fixed", "sticky"].includes(getComputedStyle(bar).position))
    .map((bar) => bar.getBoundingClientRect())
    .filter((bar) => bar.width > 0 && bar.height > 0)
  // A bar across the top pushes the controls down; a column on the left pushes them right, unless
  // the element itself sits in that column (the footer list does, below the sidebar's nav).
  const top = Math.max(
    0,
    ...fixed.filter((bar) => bar.top <= 0 && bar.width >= viewport.width / 2).map((bar) => bar.bottom),
  )
  const left = Math.max(
    0,
    ...fixed
      .filter((bar) => bar.left <= 0 && bar.width < viewport.width / 2 && rect.left >= bar.right)
      .map((bar) => bar.right),
  )
  const clampX = (x: number) => Math.min(Math.max(x, left), viewport.width - width)
  const attached = (() => {
    if (rect.top - height >= top && rect.top <= viewport.height) return rect.top - height
    if (rect.bottom >= top && rect.bottom + height <= viewport.height) return rect.bottom
    return undefined
  })()
  const placed =
    attached !== undefined
      ? { x: clampX(rect.right - width + gap), y: attached }
      : { x: viewport.width - rect.right >= width ? rect.right : viewport.width - width, y: top }
  // Drop the controls below the export buttons when they would meet.
  const buttons = [...document.querySelectorAll('[data-component="design-export"]')]
    .map((button) => button.getBoundingClientRect())
    .filter(
      (button) =>
        placed.x + gap < button.right &&
        placed.x + width - gap > button.left &&
        placed.y + gap < button.bottom &&
        placed.y + height - gap > button.top,
    )
  if (buttons.length === 0) return placed
  return { x: placed.x, y: Math.max(...buttons.map((button) => button.bottom)) }
}

// How long a selection outlives the pointer leaving it, or resting on its way to the controls.
const grace = 350
// The invisible margin around the controls that still counts as on them (matches the CSS).
const reach = 14

function contains(rect: DOMRect, point: { x: number; y: number }, margin = 0) {
  return (
    point.x >= rect.left - margin &&
    point.x <= rect.right + margin &&
    point.y >= rect.top - margin &&
    point.y <= rect.bottom + margin
  )
}

function distanceTo(rect: DOMRect, point: { x: number; y: number }) {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right)
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom)
  return Math.hypot(dx, dy)
}

/** Whether `point` lies in the corridor from `from` to the controls `zone` (their convex hull). */
function towards(from: { x: number; y: number }, zone: DOMRect, point: { x: number; y: number }) {
  if (contains(zone, point, reach)) return true
  const corners = [
    { x: zone.left - reach, y: zone.top - reach },
    { x: zone.right + reach, y: zone.top - reach },
    { x: zone.right + reach, y: zone.bottom + reach },
    { x: zone.left - reach, y: zone.bottom + reach },
  ]
  const side = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
  return corners.some((a, index) =>
    corners.slice(index + 1).some((b) => {
      const signs = [side(from, a), side(a, b), side(b, from)]
      return signs.every((value) => value >= 0) || signs.every((value) => value <= 0)
    }),
  )
}

/** Design mode's hover overlay with its option controls, loaded once Design mode is turned on. */
export default function DesignOverlay() {
  const [target, setTarget] = createSignal<Element>()
  const [box, setBox] = createSignal<Box | undefined>(undefined, { equals: sameBox })
  const [copied, setCopied] = createSignal(false)
  const controls = createMemo(() => {
    const element = target()
    return element ? controlsFor(element) : []
  })
  const customCount = () => Object.values(copy.custom).reduce((sum, list) => sum + list.length, 0)
  let panel: HTMLDivElement | undefined

  onMount(() => {
    const inPanel = (node: EventTarget | null) => node instanceof Node && !!panel?.contains(node)
    const owner = (node: EventTarget | null) => (node instanceof Element ? node.closest(selector) : null)
    // The element that was selected when the pointer went down: copy is edited on the click only
    // once it is selected, so a first tap on a touch screen just selects it.
    const armed: { element?: Element } = {}

    // Hover intent, so the pointer can travel from an element to its controls. Leaving the element
    // keeps it selected for a grace period, and while the pointer heads for the controls (inside
    // the corridor from where it left the element to the controls, and getting closer) other
    // elements it crosses are ignored. Inside the element, nested elements switch at once.
    const intent: { anchor?: { x: number; y: number }; distance: number; timer?: ReturnType<typeof setTimeout> } = {
      distance: Infinity,
    }
    const settle = (next: Element | undefined) => {
      clearTimeout(intent.timer)
      intent.timer = undefined
      intent.distance = Infinity
      setTarget(next)
    }
    const wait = (next: Element | undefined, restart: boolean) => {
      if (intent.timer !== undefined && !restart) return
      clearTimeout(intent.timer)
      intent.timer = setTimeout(() => settle(next), grace)
    }
    const hover = (event: PointerEvent) => {
      if (!designMode() || editing() || event.pointerType !== "mouse") return
      const point = { x: event.clientX, y: event.clientY }
      const current = target()
      if (inPanel(event.target)) {
        clearTimeout(intent.timer)
        intent.timer = undefined
        intent.anchor = point
        return
      }
      const found = owner(event.target) ?? undefined
      const inside = !!current && contains(current.getBoundingClientRect(), point)
      if (found === current || (inside && !found)) {
        clearTimeout(intent.timer)
        intent.timer = undefined
        intent.anchor = point
        intent.distance = Infinity
        return
      }
      if (!current || inside) {
        intent.anchor = point
        return settle(found)
      }
      const zone = panel?.getBoundingClientRect()
      if (zone && intent.anchor && towards(intent.anchor, zone, point)) {
        const distance = distanceTo(zone, point)
        const closer = distance < intent.distance - 1
        intent.distance = Math.min(distance, intent.distance)
        return wait(found, closer)
      }
      if (found) return settle(found)
      wait(undefined, false)
    }
    const press = (event: PointerEvent) => {
      armed.element = target()
      if (!designMode() || editing() || event.pointerType === "mouse" || inPanel(event.target)) return
      setTarget(owner(event.target) ?? undefined)
    }
    const click = (event: MouseEvent) => {
      if (!designMode() || editing() || inPanel(event.target)) return
      const element = event.target instanceof Element ? event.target.closest("[data-design-copy]") : null
      const id = element?.getAttribute("data-design-copy")
      if (!element || !id || !isCopyId(id)) return
      // Copy inside a link (the footer status) is selected, then edited, never followed.
      event.preventDefault()
      event.stopPropagation()
      if (armed.element !== element) return
      startEdit(element, id, event.clientX, event.clientY)
    }
    const focus = (event: FocusEvent) => {
      if (!designMode() || editing() || inPanel(event.target)) return
      const found = owner(event.target)
      // A click focuses the link around selected copy; that must not select the link's owner.
      const current = target()
      if (found && !(current && event.target instanceof Node && event.target.contains(current))) setTarget(found)
    }

    document.addEventListener("pointermove", hover, { passive: true })
    document.addEventListener("pointerdown", press, true)
    document.addEventListener("click", click, true)
    document.addEventListener("focusin", focus)
    onCleanup(() => {
      clearTimeout(intent.timer)
      document.removeEventListener("pointermove", hover)
      document.removeEventListener("pointerdown", press, true)
      document.removeEventListener("click", click, true)
      document.removeEventListener("focusin", focus)
    })
  })

  createEffect(() => {
    if (!designMode()) setTarget(undefined)
  })

  // Follow the element every frame while it is selected: scrolling, resizing and layout changes
  // from the options themselves all move it. A re-rendered element is found again by its attributes.
  createEffect(() => {
    const element = target()
    if (!element) return setBox(undefined)
    const track = () => {
      if (!element.isConnected) {
        const design = element.getAttribute("data-design")
        const copyId = element.getAttribute("data-design-copy")
        const next = [...document.querySelectorAll(selector)].find(
          (item) => item.getAttribute("data-design") === design && item.getAttribute("data-design-copy") === copyId,
        )
        return setTarget(next)
      }
      const rect = element.getBoundingClientRect()
      setBox({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        ...place(element, rect, panel),
      })
      frame = requestAnimationFrame(track)
    }
    let frame = requestAnimationFrame(track)
    onCleanup(() => cancelAnimationFrame(frame))
  })

  const exportCopy = () => {
    void navigator.clipboard.writeText(JSON.stringify(copy.custom, null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <>
      <Show
        when={designMode() && (customCount() > 0 || homeOrderChanged() || navConfigChanged() || productsOrderChanged())}
      >
        <div data-component="design-export">
          <Show when={productsOrderChanged()}>
            <button type="button" onClick={resetProductsOrder}>
              Reset product order
            </button>
          </Show>
          <Show when={navConfigChanged()}>
            <button type="button" onClick={resetNav}>
              Reset nav
            </button>
          </Show>
          <Show when={homeOrderChanged()}>
            <button type="button" onClick={resetHomeOrder}>
              Reset section order
            </button>
          </Show>
          <Show when={customCount() > 0}>
            <button type="button" data-tip="Copy your copy options as JSON" onClick={exportCopy}>
              {copied() ? "Copied" : `Copy edits (${customCount()})`}
            </button>
          </Show>
        </div>
      </Show>

      <Show when={designMode()}>
        <SectionHandles />
      </Show>

      <Show when={designMode() && !homeSorting() && !navSorting() && !navVersionsBusy() && !productsSorting() && box()}>
        {(rect) => (
          <>
            <div
              data-component="design-overlay"
              aria-hidden="true"
              style={{
                top: `${rect().top}px`,
                left: `${rect().left}px`,
                width: `${rect().width}px`,
                height: `${rect().height}px`,
              }}
            />
            <div
              data-component="design-controls"
              data-side={
                rect().y < rect().top ? "above" : rect().y >= rect().top + rect().height - 1 ? "below" : "beside"
              }
              ref={panel}
              style={{ left: `${rect().x}px`, top: `${rect().y}px` }}
            >
              <For each={controls()}>
                {(control) => (
                  <div data-slot="control" role="group" aria-label={`${control.label} options`}>
                    <button
                      type="button"
                      aria-label={`Previous ${control.label.toLowerCase()} option`}
                      onClick={() => step(control, -1)}
                    >
                      <Arrow direction="previous" />
                    </button>
                    <span data-slot="value" aria-live="polite">
                      <span data-slot="label">{control.label}:</span> {control.values()[control.index()] ?? "—"}
                      <span data-slot="count">
                        {control.index() + 1}/{control.values().length}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Next ${control.label.toLowerCase()} option`}
                      onClick={() => step(control, 1)}
                    >
                      <Arrow direction="next" />
                    </button>
                    <Show when={control.remove?.allowed()}>
                      <button
                        type="button"
                        data-slot="remove"
                        aria-label={`Delete this ${control.label.toLowerCase()} option`}
                        onClick={() => control.remove?.run()}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
                          <path d="M2 2L8 8M8 2L2 8" />
                        </svg>
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </>
        )}
      </Show>
    </>
  )
}

function Arrow(props: { direction: "previous" | "next" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true">
      <path d={props.direction === "previous" ? "M7.5 2.5L4 6L7.5 9.5" : "M4.5 2.5L8 6L4.5 9.5"} />
    </svg>
  )
}
