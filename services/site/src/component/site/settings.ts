import { isServer } from "solid-js/web"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { z } from "zod"
import { recordHistory, type HistoryChange, type HistoryTarget } from "./history"
import { monoFontDefault } from "./mono-fonts"
import type { PressIconName } from "./press-icons"
import { productPages, type PageSlug } from "./product-data"
import docsChoices from "~/lib/docs-choices.json"
import defaultSettings from "./settings-defaults.json"

export const navVariants = ["index", "rail"] as const
export const logoVariants = ["wordmark", "icon"] as const
export const popoverThemes = ["auto", "light", "dark"] as const
export const statusPreviews = ["live", "operational", "degraded", "outage", "mixed", "unknown"] as const
// The feature list under the clips on product pages: four card columns (4 + 2) or three (3 + 3).
export const productFeatureColumns = ["4 columns", "3 columns"] as const
export const featureClipStyles = ["full UI", "focused"] as const
// How many clips the product page showcase shows: three, or four on the four card columns.
export const featureClipCounts = ["3", "4"] as const
// "More open source products": grey tiles, one ruled grid of hairlines (with full or one-line
// cells), or a ruled list with one app per row.
export const companionStyles = ["tiles", "outline", "outline compact", "list"] as const
// The logo's right-click menu: a plain list, preview cards that spring open, or previews with
// labels that fan out down from the logo like a Dock stack.
export const logoMenus = ["cards", "list", "fan"] as const
// How a logo menu item shows hover and keyboard focus: the shared menu grey (light grey tint and a
// mid-grey bar on the left), the original quiet change, a blue outline and tint (the default), a
// stronger blue fill with a blue label, or a small nudge right with a lifted shadow.
export const logoMenuHovers = ["grey", "subtle", "blue", "blue fill", "lift"] as const
// A fan item: the preview with its label in a pill beside it, or one compact card holding both.
export const logoMenuItems = ["pill", "card"] as const
// The icon on the logo fan's Press item (press-icons.ts draws them).
export const pressIconNames = [
  "newspaper",
  "megaphone",
  "microphone",
  "quote",
  "camera",
  "folder",
  "document",
  "broadcast",
  "monogram",
] as const satisfies readonly PressIconName[]
// Clicking a carousel card: change page as usual, or grow the card into the product page hero.
export const cardTransitions = ["off", "grow"] as const
// The curve the card and hero box moves on. "drawer" is a fast start that settles slowly.
export const cardEasings = ["drawer", "expo out", "ease out", "ease in-out", "linear"] as const
export const cardEasingCurves: Record<(typeof cardEasings)[number], string> = {
  drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
  "expo out": "cubic-bezier(0.16, 1, 0.3, 1)",
  "ease out": "cubic-bezier(0.23, 1, 0.32, 1)",
  "ease in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
  linear: "linear",
}
// The link and accent blue (Settings › Link blue). "console" (the default) is the Console accent;
// "classic" is the old browser blue.
export const linkBlues = ["console", "classic", "open", "azure", "sky", "ocean", "cobalt", "periwinkle"] as const
// The Console blue's dark-mode partner (Settings › Dark blue), by hex.
// The logo mark's size inside its fixed box (the box stays lined up with the nav's brackets).
// "current" fills the box (28.89 × 36.11 beside the nav); the others are whole-pixel 4:5 sizes.
// Shared with the product nav demos (public/nav-demo/switcher.js reads it from localStorage).
export const logoScales = ["current", "28×35", "24×30", "20×25", "16×20"] as const
// How menus mark the current item (the language picker, the docs lockup and the product switcher in
// public/nav-demo/switcher.js, which reads it from localStorage). Compared side by side in the
// active-item mock (opencode/active-item, port 3279).
// "check" is gone: a saved "check" falls back to the bar.
export const menuActives = ["bar", "brackets", "square", "tint", "text"] as const
// The menus' hover tint and hover bar: grey (a light grey tint and a mid-grey bar, keyboard focus
// the same) or the link blue (the default). Shared with public/nav-demo/switcher.js, which reads
// it from localStorage.
export const menuColors = ["grey", "blue"] as const
// How buttons answer hover: a blue ring, a blue fill, or both.
export const buttonHovers = ["ring", "blue", "blue + ring"] as const
// The product pages' and /product' action buttons: the neutral grey button, or the dark one.
export const productButtons = ["grey", "black"] as const
// The Mobile page's "Connect your phone": numbered steps, an explanation beside what you'll see, or a callout card.
export const pairStyles = ["steps", "split", "card"] as const
// Where the nav dropdowns (docs lockup, product switcher) start: shifted left so the item labels
// start at the trigger's text, or with the menu's own edge at the trigger's text.
export const menuAligns = ["labels", "edge"] as const
// Windows wider than the layout (1728px, site.css): the sidebar and content centred as one group,
// with the corner controls at its corners, or kept at the left edge with them at the window's.
export const wideAligns = ["centred", "left"] as const
// The style of the section menus that open from the top-bar chevrons (the Docs lockup and the Data
// and Console product switchers in public/nav-demo/switcher.js, which reads it from localStorage):
// the list pop-up, or a fan of cards that spring out one after another like the logo's fan menu.
export const sectionMenuStyles = ["list", "fan"] as const
// The chevron after the product name in the Data and Console navs (public/nav-demo/switcher.js,
// which reads it from localStorage). Hidden leaves out the switcher menu too, so the name is a plain
// link to the product's home. The Docs lockup keeps its chevron either way.
export const productChevrons = ["shown", "hidden"] as const
// The light theme's page background, from off-white (#fbfbfb, the default) to pure white.
export const lightBackgrounds = ["#fbfbfb", "#fcfcfc", "#fdfdfd", "#fefefe", "#ffffff"] as const
export const darkBlues = ["4f8bff", "6b8fff", "8ea2ff", "7c9dff", "5c8dff", "6aa0ff", "5e9cff"] as const
export const cardVideoModes = ["hover · reverse", "hover · fade", "autoplay"] as const
// How a carousel card hands over from its resting loop to the hover video: an instant cut to the
// video from its start, a plain crossfade, or the short swap tuned for hover videos that start on
// the loop's framing.
export const cardHoverModes = ["cut", "fade", "match"] as const
// Playback speed of the cards' short resting loops. (The hover videos are cut to hold each shot for
// its length, so they always play at 1×.)
export const cardVideoSpeeds = [1, 1.25, 1.5, 1.75, 2] as const
// The card hover video: "cinematic", straight-on locked-off shots joined by hard cuts
// (card-hover/cinematic), or "angled", the same story with the UI on a 3D plane and each shot held
// at its own camera angle (card-hover/angled, made by product-videos/cinematic/angle.py), the
// default. Saved values from older builds ("original", "snappy": panning cuts, now archived) fall
// back to "angled".
export const cardVideoCuts = ["cinematic", "angled"] as const
// What hovering a carousel card shows: "demo" stops the loop and switches to the product demo (a cut
// of the hover video that starts on the product UI); "continue" plays the hover video from the
// loop's framing, so the loop seems to open out into the product.
export const cardHoverEntries = ["demo", "continue"] as const
// The Mobile card's animated cover: OpenCode Mobile's Living Orb in a call, in neutral greys
// (card-loops/mobile-orb-<shade>, rendered from voice/wisp-orb.ts), or the earlier loop of the call
// bar (card-loops/mobile). Each shade, the strength of the sphere shading over the lens, is its own
// rendered loop: 0 is the WispOrb lens as it is.
export const mobileCovers = ["orb", "call bar"] as const
// The "NEW" badge on product cards (home carousel and /product): only Mobile carries one.
export const productBadgeModes = ["show", "hide"] as const
export const mobileOrbShades = [0, 25, 50, 75, 100] as const
// Carousel media at rest: full colour, monochrome, or monochrome with film grain. Hover brings the colour back.
export const cardTones = ["color", "mono", "mono + noise"] as const
// The carousel card's text under the media: title, description and button stacked, or the title
// and button on one row (with a smaller secondary button, or with the description under the row).
export const cardInfoLayouts = ["stacked", "inline", "inline compact", "inline + description"] as const
// On phones and tablets, the home carousel card's title, description and button: over the bottom of the media on
// a dark gradient, so the card is only as tall as its media, or under the media as on wider screens.
export const phoneCardContents = ["overlay", "below"] as const
export const selectionStyles = ["blue", "muted blue"] as const
// The ⌘K site search (search.tsx): a centred command palette, a large Spotlight-style input, a
// right-hand sheet, a panel dropping from the top edge under the nav, or an input with compact rows.
export const searchStyles = ["palette", "spotlight", "sheet", "inline", "minimal"] as const
// The backdrop is a preset of the look sliders below; moving a backdrop slider makes it "custom".
export const searchBackdrops = ["dim", "blur", "none", "custom"] as const
// Backdrop blur in px and the overlay's opacity in percent, in light and dark mode.
export const searchBackdropPresets = {
  dim: { searchBlur: 0, searchDimLight: 24, searchDimDark: 56 },
  blur: { searchBlur: 6, searchDimLight: 8, searchDimDark: 32 },
  none: { searchBlur: 0, searchDimLight: 0, searchDimDark: 0 },
}
// The overlay's colour: black, or a dark tint of the link blue.
export const searchTints = ["neutral", "blue"] as const
export const searchMotions = ["scale", "slide", "none"] as const
export const searchResultModes = ["grouped", "flat"] as const
// The search has no visible trigger; "corner" adds a small ⌘K hint in the bottom-right corner.
export const searchHints = ["off", "corner"] as const
export const toggles = ["off", "on"] as const
// Voice mode (voice/voice-mode.tsx): the orb rests in the bottom-right corner on every page, or not.
// The old "button" (a footer voice button) is gone; a saved "button" falls back to the default.
export const voiceOrbModes = ["always", "off"] as const
// Where voice mode shows its state and captions: a pop-up above the orb, or a line under the waveform
// at the top of the window.
export const voiceCaptionModes = ["popover", "top"] as const
// The 404 arcade: the photographic version or the three.js one, and how its nav sits on the scene.
export const arcadeVersions = ["image", "3D"] as const
// The 404 arcade's mode: painted stills with a three.js coin and a code-drawn screen (hybrid), the
// stills alone (image), the full three.js scene (3D), or the hybrid with the room split into layers
// and its moonlight and dust drawn live (layers, the default).
export const arcadeModes = ["hybrid", "image", "3D", "layers"] as const
export const arcadeNavBlends = ["screen", "plus-lighter", "normal"] as const
// The arcade screen's CRT look (arcade/crt.css): none, subtle (the default) or strong.
export const arcadeCrts = ["off", "subtle", "strong"] as const
// What the arcade screen says on a phone, where the games do not run (arcade/screen.tsx).
export const arcadeMobileCopies = ["not available", "game over"] as const
// How the title screen draws the pixel wordmark in (arcade/screen.tsx): cell by cell, or a column wipe.
export const arcadeLogoReveals = ["pixels", "column wipe"] as const
// The home sections below the hero that Design mode can reorder, in their default order.
export const homeSections = [
  "products",
  "logos",
  "what",
  "getStarted",
  "byos",
  "tools",
  "openSource",
  "faq",
  "console",
] as const
export type HomeSection = (typeof homeSections)[number]
export function normalizeHomeOrder(saved: readonly string[]) {
  return normalizeOrder(homeSections, saved)
}
// The primary nav items (ids in links.ts) in their default order, and which show by default.
// Design mode edits the list (settings navConfig): order, visibility and labels.
export const navDefaults = [
  { id: "docs", visible: true },
  { id: "products", visible: true },
  { id: "data", visible: true },
  { id: "console", visible: true },
  { id: "models", visible: true },
  { id: "subscriptions", visible: true },
  { id: "enterprise", visible: true },
  { id: "changelog", visible: false },
  { id: "github", visible: false },
] as const
export type NavItemId = (typeof navDefaults)[number]["id"]
/**
 * One item of the nav list: a known item by id, or a custom link (an id starting "custom-", with its
 * own label and href). `removed` keeps a deleted item's place so Design mode can add it back.
 */
export type NavEntry = { id: string; visible: boolean; label?: string; href?: string; removed?: boolean }

/**
 * A saved nav list against the known items: each known item once, in the saved order, unknown ids
 * dropped except custom links (which need a label and an href), labels trimmed (an empty one means
 * the default). A known item the list doesn't have yet (one added since) goes right after the item
 * before it in the default order, shown or hidden as it is by default. The pre-paint script inlines
 * this function as source, so it may only use its arguments.
 */
export function normalizeNavConfig(
  defaults: readonly { id: string; visible: boolean }[],
  saved: unknown,
): { id: string; visible: boolean; label?: string; href?: string; removed?: boolean }[] {
  const ids = defaults.map((item) => item.id)
  const text = (entry: object, name: string) => {
    const value = Object.entries(entry).find((field) => field[0] === name)?.[1]
    // trim() keeps zero-width characters, which would make a label look empty or misaligned.
    return typeof value === "string" ? value.replace(/^[\s\u200b-\u200d\u2060]+|[\s\u200b-\u200d\u2060]+$/g, "") : ""
  }
  const known = (Array.isArray(saved) ? saved : []).flatMap((entry, index, list) => {
    if (typeof entry !== "object" || entry === null) return []
    const id = text(entry, "id")
    const custom = id.startsWith("custom-")
    if ((!ids.includes(id) && !custom) || list.findIndex((other) => other?.id === id) !== index) return []
    const label = text(entry, "label")
    const href = text(entry, "href")
    if (custom && (!label || !href)) return []
    const visible = "visible" in entry ? entry.visible !== false : true
    const removed = "removed" in entry && entry.removed === true
    return [{ id, visible, ...(label ? { label } : {}), ...(custom ? { href } : {}), ...(removed ? { removed } : {}) }]
  })
  if (known.length === 0) return defaults.map((item) => ({ id: item.id, visible: item.visible }))
  return ids.reduce((list, id, index) => {
    if (list.some((item) => item.id === id)) return list
    const after = ids.slice(0, index).findLast((previous) => list.some((item) => item.id === previous))
    const at = after ? list.findIndex((item) => item.id === after) + 1 : 0
    return [...list.slice(0, at), { id, visible: defaults[index].visible }, ...list.slice(at)]
  }, known)
}
export const defaultNavConfig = (): NavEntry[] => navDefaults.map((item) => ({ id: item.id, visible: item.visible }))
// The products on /product (product-data.ts), in their default order. Design mode can reorder them;
// the order also drives the product pages' arrow keys. The home carousel keeps its own order.
export const productIds: PageSlug[] = productPages.map((product) => product.slug)
export function normalizeProductsOrder(saved: readonly string[]) {
  return normalizeOrder(productIds, saved)
}
// Known ids once each, in the saved order, then any missing ones in their default place at the end.
// Known ids once each, in the saved order; an id the saved order doesn't have yet (a new section)
// goes in right after the item before it in the default order. homeOrderScript repeats this.
function normalizeOrder<T extends string>(ids: readonly T[], saved: readonly string[]): T[] {
  const known = saved.filter((id, index): id is T => ids.some((item) => item === id) && saved.indexOf(id) === index)
  return ids.reduce((order, id, index) => {
    if (order.includes(id)) return order
    const before = ids
      .slice(0, index)
      .reverse()
      .find((item) => order.includes(item))
    const at = before === undefined ? 0 : order.indexOf(before) + 1
    return [...order.slice(0, at), id, ...order.slice(at)]
  }, known)
}
// The changelog rail: only the entry being read has a blue marker, or a blue line fills the rail
// as you scroll and every marker it passes stays blue.
export const changelogMarkers = ["active square", "progress"] as const
// Changelog entry titles: Inter at the home hero subtitle's size, or the earlier mono titles.
export const changelogTitles = ["sans", "mono"] as const
// Changelog entry titles: size in px · weight. 26 · 500 sets each entry apart from the 15px/500
// subheads under it; 18 · 400 is the earlier home-subtitle size.
export const changelogTitleSizes = ["24 · 500", "26 · 500", "28 · 500", "26 · 600", "18 · 400"] as const
// How a changelog entry's media shows it is a carousel: bars under it, plus a count, arrows, the
// next slide peeking in, or a bar that fills as the slides advance on their own.
export const changelogCarousels = ["bars", "bars + count", "bars + arrows", "peek", "progress"] as const
// The changelog's filter: the product areas in one row (beside Subscribe), or a chip for every
// section heading the release notes have used, one-off headings from old releases too.
export const changelogFilters = ["areas", "all headings"] as const
// The footer theme switch: light, system and dark side by side, or one button that cycles them
// (with a "View as agent" button beside it).
export const themeSwitcherStyles = ["three buttons", "cycle"] as const
// The footer wordmark's entrance: outlines plotted, then the hatch, then the nodes; or the hatch
// and nodes only, over outlines already drawn.
export const footerWordmarkAnimations = ["draw", "hatch only", "off"] as const
// The footer wordmark's letters can be dragged (or moved with the keyboard) into a new order.
export const footerWordmarkPlays = ["drag", "off"] as const
// The logo row under the home hero: company wordmarks, model provider marks, or nothing.
export const logoRows = ["companies", "providers", "off"] as const
// "Bring your own tools": each tile's icon and typed name, or the product's full logo. Tiles with
// gaps, or one ruled grid of hairlines.
export const toolTileStyles = ["icon + name", "logo"] as const
export const toolGrids = ["tiles", "outline"] as const
// How the logo row uses its eight half-card slots: the label in the first card and six logos, a
// short label in the first half and seven logos, eight logos, the label above eight logos, or a
// home section: the label as the section title and six logos in card columns 2–4.
export const logoLayouts = ["label + 6", "label + 7", "8 logos", "label above + 8", "section"] as const
// The logo row's label, in every layout with one. Design mode copy (home.logos.label) can override it.
export const logoLabels = [
  "Trusted by 22M+ developers",
  "Trusted by",
  "Trusted worldwide",
  "Trusted by users worldwide",
] as const
// How a logo in the row hands over to the next one.
export const logoAnimations = [
  "fade",
  "blur",
  "rise",
  "flip",
  "scale",
  "pixel",
  "dither",
  "scanline",
  "type",
  "wipe",
  "glitch",
] as const
// The contributor avatars' reveal (open source proof): the logo row's styles, or whichever it uses.
export const avatarAnimations = ["same as logos", ...logoAnimations] as const
// Where each contributor avatar links: their GitHub profile (the default), their commits to
// OpenCode, their merged pull requests, or nowhere (a decorative, greyscale wall).
export const avatarLinks = ["profile", "commits", "pull requests", "off"] as const
// The "Bring your own tools" tiles' entrance: none (the default), the logo row's style, or one of its styles.
export const toolsAnimations = ["off", "same as logos", ...logoAnimations] as const
// Easing for the logo styles that aren't stepped.
export const logoEasings = ["ease-out", "ease-in-out", "linear", "snap"] as const
export const copyrightMarks = ["logo", "text"] as const
// Brand page colours: the clay and slate fields everywhere, or on-brand blues for the variants
// with clay kept for the "Do not" examples.
// How each Brand asset offers its files: a PNG download plus an SVG copy button (default), a Download
// menu with a square copy button, one Download menu, a split button (PNG, then a menu), icon buttons,
// text links, or the buttons shown only on hover.
export const brandAssetActionStyles = [
  "svg copy",
  "menu copy",
  "menu",
  "split",
  "icons",
  "text links",
  "hover reveal",
] as const
// The /font film plate's poster: white "opencode" on black (default) or the light grid frame.
export const filmPosters = ["inverted", "light"] as const
// The agent rules button once it has copied: the same label with a check (default), or "Rules copied".
export const agentButtonCopiedStyles = ["check only", "copied text"] as const
// How the Brand page's Usage explains one stroke, the unit of its spacing rules.
export const strokeDiagrams = ["off", "highlight", "ruler", "zoom", "tiles", "animated"] as const
// The Brand page's badge text: Inter (default), OpenTUI Mono, or uppercase OpenTUI Mono.
export const badgeFonts = ["sans", "mono", "mono caps"] as const
// How the Brand page lays out its badges: style tabs over one Light and Dark pair (default), or a row per
// style.
export const badgeLayouts = ["tabs", "rows"] as const
// The chosen badge style tab: an ink line under it that slides between tabs (default), colour only, or a
// small ink square before its label.
export const badgeTabStyles = ["underline", "plain", "square"] as const
export const brandPalettes = ["blue + clay", "clay + slate"] as const
// What sits behind the Brand page's Default (transparent) variant tiles, to show the logo blending in.
export const variantBackgrounds = [
  "mesh",
  "aurora",
  "spotlight",
  "halftone",
  "isometric",
  "photo-like",
  "gradient",
  "grain",
  "dither",
  "grid",
  "flat",
] as const
// Press page judgement calls: one or two boilerplates, and the Anomaly projects as a grid or a list.
export const pressBoilerplates = ["long", "long + short"] as const
// The legal index's document list: full-width rows, a two-column grid of cards, one line per
// document (title and date) with the description on hover, rows grouped under small headings, or
// large tiles with a document glyph. Each item is one link.
export const legalHubStyles = ["rows", "cards", "compact list", "grouped", "tiles"] as const
// How a row in the legal list ("rows", "grouped") answers hover: the title strengthens and
// underlines; the title strengthens and an arrow slides in; a neutral grey tint with the arrow
// (grey whatever Settings › Menu colour is); a dark bar at the row's left edge; or the description
// darkens over a hairline under the row.
export const legalRowHovers = ["title", "arrow", "grey", "bar", "lift"] as const
// Where a legal document's History shows: "inline" opens it above the text (it pushes the text
// down); "tabs" swaps the text for it under Document | History tabs; "toggle" swaps them with a
// segmented control beside the dates; "contents" switches from an entry in the Contents rail; and
// "drawer" opens it in a side panel over the page.
export const legalHistoryViews = ["inline", "tabs", "toggle", "contents", "drawer"] as const
// How a legal document prints (legal-print.tsx): "current" is the plain print; the others add a
// cover sheet and a designed page system (running heads, numbered sections, references, colophon).
export const legalPrintStyles = ["current", "exhibit", "architect", "letterhead", "modular", "swiss"] as const
// The "architect" print style's cover and interior concepts (lib/legal/architect.ts). A layout saved
// in the layout editor (/dev/print-editor) takes their place.
export const architectCovers = ["c1", "c2", "c3", "c4", "c5"] as const
export const architectInteriors = ["plain", "i1", "i2", "i3", "i4"] as const
// The architect style's dividers inside the document (summary, sections, colophon): a solid hairline,
// or a terminal-style rule of squares, dashes, a double line, a labelled line or dots.
export const architectRules = ["solid", "squares", "dashes", "double", "labelled", "dots"] as const
// The architect style's mono labels (cover label and form, section numbers, colophon): sentence case,
// or capitals with a little tracking.
export const architectLabelCases = ["sentence", "upper"] as const
// The architect cover's field (lib/legal/cover-pattern.ts): the c3 square grid, the aligned grid,
// David's lines, or a preset from the cover-patterns playground (patterns, then emitters).
export const architectPatterns = [
  "grid",
  "aligned-grid",
  "lines",
  "opencode-grid",
  "molnar-squares",
  "rotating-ticks",
  "moire-grids",
  "phyllotaxis-dots",
  "concentric-rings",
  "sine-field",
  "spiral-lines",
  "interference",
  "turning-crosses",
  "ripple",
  "unfold",
  "echoes",
  "spiral-arms",
  "pixel-bloom",
  "fan",
  "warped-grid",
  "shockwave",
] as const
// The plain-language summary at the top of a legal document: a grey panel, a left rule, plain
// body text, a blue-tinted callout, two columns of points, or a disclosure that starts open.
export const legalSummaryStyles = ["box", "rule", "plain", "callout", "columns", "accordion"] as const
export const pressCompanyStyles = ["grid", "list"] as const
export const pressContactStyles = ["rows", "cards"] as const
// How the boilerplate copies: the label and a copy icon as one button, a mono "Copy" link by the label,
// an icon on hover, the text itself, or a button.
export const pressCopyStyles = ["label", "link", "icon", "click", "button"] as const
// The press media gallery: one image per product in a row (default), a carousel of small thumbnails, a thumbnail grid, a filmstrip with a
// big preview, a large grid, a collage wall, or decks that fan out.
export const pressMediaLayouts = ["products", "strip", "thumbnails", "filmstrip", "grid", "wall", "fan"] as const
// The footer links: one list in the sidebar column, or Next.js-style columns above the wordmark.
export const footerLayouts = ["list", "columns"] as const
// The footer list's social links: "community" (Discord as "Community", no X) or "classic" (X and Discord).
export const footerLinkSets = ["community", "classic"] as const
// How many status bars the footer shows, the most recent first from the right. All six render and
// the site root's data-status-bars hides the older ones, so the count can change before hydration.
export const statusBarCounts = ["3", "4", "5", "6"] as const
// The primary nav: one list, or the open source links first and Anomaly's products under a label.
export const navGroups = ["flat", "grouped"] as const
// The nav item numbers: zero-padded ([01]) or plain ([1]). Plain also re-centres the logo on the
// narrower "[1]", uses "[-]" for the footer's current page and narrows the status bars, all from
// the site root's data-nav-numbers="1" (and the product nav demos' frames, via switcher.js).
export const navNumbers = ["01", "1"] as const
export const bodyWeights = ["400", "450", "500"] as const
export const sidebarWidths = ["fixed", "fifth column"] as const
export const sectionWidths = ["3 columns", "4 columns"] as const
// How many card columns a home section's content spans beside its title (from 80rem up).
export const sectionColumns = ["2 columns", "3 columns"] as const
export const spacerStyles = ["space", "line", "dashed", "hatch", "dot gradient", "dither gradient"] as const
// The "dither gradient" spacer: which way the dots thin out, and the ordered (Bayer) or noise pattern.
export const ditherOrientations = ["vertical", "horizontal"] as const
export const ditherDirections = ["down", "up", "centre", "left to right", "right to left"] as const
// The directions each orientation offers.
export const ditherDirectionsFor = {
  vertical: ["down", "up", "centre"],
  horizontal: ["left to right", "right to left", "centre"],
} as const
// A horizontal fade's length in label columns, or the whole content width.
export const ditherLengths = [
  "0.5 columns",
  "0.75 columns",
  "1 column",
  "1.5 columns",
  "2 columns",
  "2.5 columns",
  "3 columns",
  "4 columns",
  "full width",
] as const
export const ditherPatterns = ["bayer 2×2", "bayer 4×4", "bayer 8×8", "noise"] as const
export const heroVariants = ["current", "two-up", "three-up", "full"] as const
// How many card columns the hero subtitle spans.
export const subtitleWidths = ["2 columns", "3 columns", "4 columns"] as const
// The home hero title: capped at 64px for every hero option, or each option's own fitted size.
export const heroTitleSizes = ["64px", "fitted"] as const
// The press, brand, legal, changelog and download page titles: scroll away, or stick in the
// breadcrumb row and shrink to the breadcrumb's size, over an opaque or frosted bar.
export const stickyTitles = ["off", "shrink", "shrink frosted"] as const
// How the hero title arrives: static, or shuffled in with Kit Langton's rolling-number (rolling
// wheels or split-flap cards).
export const heroTextModes = ["static", "roll", "flap"] as const
// The install command on desktop only: none, under the hero subtitle (the curl command on one line,
// or a tab per install method), a row above the product carousel with the command and a prompt to
// copy for a coding agent, or that row with only the agent prompt.
// The home "New" announcement: a line of blue text with no box, the whole message as its link;
// the same line with "NEW" on a small solid blue chip; a tinted bar with a solid "New" tag; or a
// full-width blue banner across the top of the page, like the footer's letters bar.
export const announcementStyles = ["text", "chip", "bar", "banner"] as const
// The banner announcement's "NEW": a white badge with blue text and the message at 70% white, or
// plain white caps with the message at 60%.
export const bannerLabels = ["badge", "plain"] as const
// "What is OpenCode?": the model providers' marks, as explorations: none, a quiet row, inline in
// a sentence, a dense grid with the count, or a slow marquee.
export const providerLogoStyles = ["none", "row", "inline", "grid", "marquee"] as const
// "Bring your own subs": the providers' grid then the plans, your subscriptions beside the plans,
// or tabs between the two.
export const subsStyles = ["grid", "split", "tabs"] as const
// "Get started": a numbered path, a price ladder, one large sentence, a terminal transcript, or two
// cells in the tools grid's borders.
export const getStartedStyles = ["steps", "ladder", "sentence", "terminal", "cards"] as const
// "What is OpenCode?" on phones: an accordion of titles (the FAQ's rows, all closed), the first
// four in full and the rest as a list of links, the first five and a "Show all" button, the first
// four and a line of the rest, or a swipe deck of cards.
export const phoneFeatureLists = ["accordion", "highlights + list", "show more", "highlights", "swipe deck"] as const
export const heroInstalls = ["off", "line", "tabs", "above carousel", "agent only"] as const
// The "above carousel" install row: where and how the agent prompt action sits beside the command.
// "button" is the earlier neutral button on the right.
export const installRowStyles = [
  "inline",
  "text link right",
  "text link left",
  "icon only",
  "two rows",
  "ghost button left",
  "segmented",
  "button",
] as const
// How the open source stats count up: the original CSS odometer or rolling-number.
// "slot" (the default) shows the final numbers until the stats near the window, then spins each digit
// through random digits like a slot machine and settles it; it never shows a zero first.
export const statsModes = ["slot", "odometer", "rolling"] as const
// Open source proof (live repo numbers, contributor avatars, licence and the GitHub actions): under
// the open source stats, in a section of its own after them, or not shown.
export const ossProofs = ["stats", "section", "off"] as const
// The open source section as it is, or with a "fork it" block (terminal transcript and what a fork
// lets you do) and a "Fork on GitHub" button.
export const ossVariants = ["current", "fork"] as const
// "section" lays the Console out like the other home sections: title, then copy, no dots.
export const consoleSections = ["section", "panel", "inline", "slim", "split", "corner", "off"] as const
export const consoleHeights = ["auto", "card", "half", "compact"] as const
// Where the Console section's name sits: inside the panel above the headline, or in the first card
// column like every other home section's title (panel, inline and slim).
export const consoleLabels = ["inside", "left"] as const
// "block" makes the whole section one dark container across the content width, with the dots edge
// to edge and the copy, under a small "CONSOLE" kicker, from the column-2 line; it sets the panel
// option itself. With the name on the left, "columns" keeps the name on the page in the first card
// column with the panel across columns 2–4, and "standard" keeps the panel as wide as Section
// columns sets.
export const consoleLayouts = ["block", "columns", "standard"] as const
// The corner card's button: the dark primary button, or quieter alternatives.
export const cornerButtons = ["neutral", "outline", "link", "primary"] as const
export const docsSwitchers = ["lockup", "topbar", "list", "tabs", "dropdown"] as const
// The docs lockup's "Docs" versions: a flyout beside the menu, or nested rows under "Docs" (touch
// and narrow screens always nest).
export const docsSubmenus = ["flyout", "nested"] as const
// The docs lockup: one button for the section word and its chevron that opens the menu, or split
// like the Data and Console headers, where the word goes to the section's home and the chevron
// alone opens the menu.
export const docsNavs = ["combined", "split"] as const
// Design mode options for every docs content component (docs-variants.css), five each; "1" is the
// style the docs have today. Shown on /dev/docs-components, applied on every docs page. Keep the
// chosen ones and delete the rest when the docs design settles.
export const docsVariantComponents = {
  typography: "Typography",
  lists: "Lists",
  blockquote: "Blockquote",
  callout: "Callout",
  tabs: "Tabs",
  code: "Code block",
  codeTitle: "Titled code",
  codeLines: "Line numbers",
  codeDiff: "Diff",
  terminal: "Terminal",
  fileTree: "File tree",
  steps: "Steps",
  cards: "Cards",
  tables: "Tables",
  badges: "Badges",
  details: "Details",
  media: "Images and video",
  api: "API reference",
  config: "Config reference",
  cli: "CLI reference",
  pagination: "Prev / next",
  contents: "Contents rail",
  breadcrumbs: "Breadcrumbs",
  search: "Search box",
  switchers: "Switchers",
  editLink: "Edit on GitHub",
  feedback: "Feedback",
  kbd: "Keys",
  inlineCode: "Inline code",
} as const
export type DocsVariantKey = keyof typeof docsVariantComponents
export const docsVariantKeys = Object.keys(docsVariantComponents) as DocsVariantKey[]
export const docsVariantOptions = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const
export type DocsVariantOption = (typeof docsVariantOptions)[number]
// Option 6, "Vercel square", is the one code surface David chose (5 Nov 2026): a white body (lifted in
// dark), a tinted header row with the label and copy button, a 1px border and square corners. Only
// the code components have it.
export const docsVariantSquare: readonly DocsVariantKey[] = [
  "tabs",
  "code",
  "codeTitle",
  "codeLines",
  "codeDiff",
  "terminal",
  "fileTree",
  "api",
  "config",
  "cli",
  "inlineCode",
]
// Options beyond the first five: Vercel square on the code components, the site type scale for
// typography (6) and the endpoint card for the API reference (7).
// The proposals for the components David hasn't reviewed yet (option 6, built overnight on 5 Nov 2026
// from his rules). They aren't defaults; he approves or rejects them.
export const docsVariantProposed: Partial<Record<DocsVariantKey, DocsVariantOption>> = {
  cards: "6",
  badges: "6",
  pagination: "6",
  contents: "6",
  kbd: "6",
}
// New options waiting for David's pick on a component he has already chosen: shown beside the chosen
// one on /dev/docs-components, not folded away as old.
export const docsVariantNew: Partial<Record<DocsVariantKey, readonly DocsVariantOption[]>> = {
  fileTree: ["7", "8", "9"],
}
const docsVariantCount: Partial<Record<DocsVariantKey, number>> = {
  ...Object.fromEntries(docsVariantSquare.map((key) => [key, 6])),
  ...Object.fromEntries(Object.keys(docsVariantProposed).map((key) => [key, 6])),
  tables: 6,
  fileTree: 9,
  search: 6,
  typography: 6,
  api: 7,
}
export const docsVariantOptionsFor = (key: DocsVariantKey) => docsVariantOptions.slice(0, docsVariantCount[key] ?? 5)
export const docsVariantOptionName = (key: DocsVariantKey, value: DocsVariantOption) => {
  if (key === "typography" && value === "6") return "Site scale"
  if (key === "api" && value === "7") return "Endpoint card"
  if (key === "fileTree" && value === "7") return "Indent only"
  if (key === "fileTree" && value === "8") return "Guide lines"
  if (key === "fileTree" && value === "9") return "Plain code block"
  if (value === "6" && docsVariantSquare.includes(key)) return "Vercel square"
  if (value === docsVariantProposed[key]) return "Proposed"
  return undefined
}
// David's locked option for each docs component: src/lib/docs-choices.json, written by the Choose
// button on /dev/docs-components (routes/dev/api/docs-choices.ts, development only). They're the
// defaults for everyone; components with no entry haven't been reviewed yet.
export const docsVariantRecommended = parseDocsChoices(docsChoices)

export function parseDocsChoices(value: unknown) {
  if (typeof value !== "object" || value === null) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [DocsVariantKey, DocsVariantOption] =>
        docsVariantKeys.some((key) => key === entry[0]) &&
        docsVariantOptionsFor(entry[0] as DocsVariantKey).some((option) => option === entry[1]),
    ),
  ) as Partial<Record<DocsVariantKey, DocsVariantOption>>
}
// The V1 docs notice, which stays at the top of the content column while the article scrolls
// behind it: the bordered box, the box with a page-coloured band below it so nothing touches its
// border, a borderless bar with only a bottom rule, a box over a soft fade, a frosted bar, a dark
// inverted bar, a link-blue tint, a callout that scrolls away with the article, or a line in the
// logo row beside the lockup's "| V1". "frosted top" is the frosted bar stuck flush to the top of
// the window (under the top bar on phones).
export const docsVersionNotices = [
  "frosted top",
  "boxed",
  "spaced",
  "hairline",
  "frosted",
  "inverted",
  "blue",
  "inline",
  "docked",
] as const
// The Terminal page's install action: the Install button and its menu, or the commands shown openly in tabs.
export const terminalInstalls = ["button", "exposed"] as const
// Cards visible in the home carousel at each screen width. Fractions show part of the next card.
export const carouselBreakpoints = [
  { key: "xl", label: "≥ 1600px", min: 1600 },
  { key: "lg", label: "1280–1599px", min: 1280 },
  { key: "md", label: "960–1279px", min: 960 },
  { key: "sm", label: "640–959px", min: 640 },
  { key: "xs", label: "< 640px", min: 0 },
] as const

export type CarouselConfig = Record<(typeof carouselBreakpoints)[number]["key"], number>

export const carouselPresets = {
  default: { xl: 4, lg: 4, md: 2.5, sm: 2.2, xs: 1.1 },
  "four across": { xl: 4, lg: 3.5, md: 2.5, sm: 2.5, xs: 1.15 },
  "all four": { xl: 4, lg: 4, md: 3.5, sm: 2.5, xs: 1.25 },
  roomy: { xl: 3, lg: 2.5, md: 2, sm: 1.5, xs: 1.1 },
  dense: { xl: 4.5, lg: 4, md: 3, sm: 2, xs: 1.25 },
} satisfies Record<string, CarouselConfig>

export const carouselPresetNames = [
  ...(Object.keys(carouselPresets) as (keyof typeof carouselPresets)[]),
  "custom",
] as const

// The settings and how each one falls back, as a zod schema. It is built on first use, by the
// development server, Settings and tests: production renders the defaults from
// settings-defaults.json, so the browser's bundle never builds it and leaves zod out.
function createSchema() {
  // Per-style tuning for the logo row's animations (Settings › Logo animation). Every style has a
  // duration (the arriving logo's; the leaving one takes 60% of it) and a delay before the new logo
  // arrives; the rest are the style's own.
  const number = (min: number, max: number, value: number) => z.number().min(min).max(max).catch(value)
  const timing = (duration: number, delay: number) => ({
    duration: number(80, 1500, duration),
    delay: number(0, 1000, delay),
  })
  const eased = (duration: number, delay: number, easing: (typeof logoEasings)[number] = "ease-out") => ({
    ...timing(duration, delay),
    easing: z.enum(logoEasings).catch(easing),
  })
  function tuning<T extends z.ZodRawShape>(shape: T) {
    const style = z.object(shape)
    return style.catch(style.parse({}))
  }
  const docsVariant = (key: DocsVariantKey) =>
    z
      .enum(docsVariantOptions)
      .refine((value) => docsVariantOptionsFor(key).includes(value))
      .catch(docsVariantRecommended[key] ?? "1")
  const docsVariants = z.object(
    Object.fromEntries(docsVariantKeys.map((key) => [key, docsVariant(key)])) as Record<
      DocsVariantKey,
      ReturnType<typeof docsVariant>
    >,
  )
  const logoTuning = z.object({
    fade: tuning(eased(450, 200)),
    blur: tuning({ ...eased(450, 200), blur: number(0, 16, 6) }),
    rise: tuning({ ...eased(550, 0), rise: number(0, 32, 12), blur: number(0, 16, 4) }),
    scale: tuning({ ...eased(450, 200), scale: number(50, 100, 85) }),
    flip: tuning({ ...eased(450, 250), perspective: number(100, 1200, 320), axis: z.enum(["x", "y"]).catch("x") }),
    pixel: tuning({ ...timing(300, 120), block: number(2, 8, 4), steps: number(2, 16, 8) }),
    dither: tuning({
      ...timing(280, 90),
      dot: number(1, 4, 3),
      pattern: z.enum(["bayer 4×4", "bayer 2×2"]).catch("bayer 2×2"),
      steps: number(2, 16, 8),
    }),
    scanline: tuning({
      ...timing(400, 200),
      spacing: number(2, 8, 2),
      direction: z.enum(["down", "up"]).catch("down"),
      steps: number(2, 16, 8),
    }),
    type: tuning({
      ...timing(420, 240),
      steps: number(2, 20, 10),
      direction: z.enum(["left to right", "right to left"]).catch("left to right"),
    }),
    wipe: tuning({
      ...eased(520, 0, "ease-in-out"),
      thickness: number(1, 4, 1),
      direction: z.enum(["left to right", "right to left"]).catch("left to right"),
      line: z.enum(toggles).catch("on"),
    }),
    glitch: tuning({ ...timing(420, 220), slices: number(2, 6, 4), offset: number(1, 12, 4) }),
  })

  // Each field falls back on its own, so one stale or renamed value doesn't reset everything.
  return z.object({
    nav: z.enum(navVariants).catch("index"),
    logo: z.enum(logoVariants).catch("icon"),
    status: z.enum(statusPreviews).catch("live"),
    // Pop-ups follow the page theme by default; light or dark forces one (the ⌘K search always follows).
    popover: z.enum(popoverThemes).catch("auto"),
    hero: z.enum(heroVariants).catch("three-up"),
    subtitleWidth: z.enum(subtitleWidths).catch("3 columns"),
    heroTitleSize: z.enum(heroTitleSizes).catch("fitted"),
    heroText: z.enum(heroTextModes).catch("static"),
    heroInstall: z.enum(heroInstalls).catch("off"),
    // The "New" bar at the top of the home page, level with the logo. ⌘N (Ctrl+N) toggles it there.
    homeAnnouncement: z.enum(toggles).catch("off"),
    announcementStyle: z.enum(announcementStyles).catch("text"),
    bannerLabel: z.enum(bannerLabels).catch("badge"),
    providerLogos: z.enum(providerLogoStyles).catch("none"),
    subsStyle: z.enum(subsStyles).catch("grid"),
    getStartedStyle: z.enum(getStartedStyles).catch("steps"),
    phoneFeatures: z.enum(phoneFeatureLists).catch("accordion"),
    installRowStyle: z.enum(installRowStyles).catch("inline"),
    // Page title size, in percent of the 48px default.
    heroSize: z.number().min(50).max(150).catch(100),
    stickyTitle: z.enum(stickyTitles).catch("off"),
    stats: z.enum(statsModes).catch("slot"),
    ossProof: z.enum(ossProofs).catch("stats"),
    ossVariant: z.enum(ossVariants).catch("current"),
    avatarAnimation: z.enum(avatarAnimations).catch("same as logos"),
    avatarLink: z.enum(avatarLinks).catch("commits"),
    // Milliseconds between one avatar's reveal and the next, in the diagonal wash.
    avatarStagger: z.number().min(10).max(120).catch(30),
    spacer: z.enum(spacerStyles).catch("line"),
    // The "dot gradient" spacer: where the dashes end (in label columns), how many there are, the
    // first dash and gap in px (gaps shrink to nothing), and the easing exponent the dashes grow by
    // (higher stays dotty for longer).
    spacerLength: z.number().min(0.5).max(4).catch(2),
    spacerCount: z.number().int().min(6).max(40).catch(20),
    spacerStartDash: z.number().int().min(1).max(6).catch(4),
    spacerStartGap: z.number().int().min(2).max(40).catch(16),
    spacerCurve: z.number().min(1).max(4).catch(1),
    // The "dither gradient" spacer: band height and dot size in px, the density at the dense end and
    // the dots' strength (both percent), the falloff exponent, and a solid line on the dense edge.
    ditherHeight: z.number().int().min(4).max(96).catch(4),
    ditherOrientation: z.enum(ditherOrientations).catch("horizontal"),
    ditherDirection: z.enum(ditherDirections).catch("right to left"),
    ditherLength: z.enum(ditherLengths).catch("full width"),
    ditherPixel: z.number().int().min(1).max(4).catch(1),
    ditherPattern: z.enum(ditherPatterns).catch("bayer 4×4"),
    ditherDensity: z.number().min(20).max(100).catch(50),
    ditherOpacity: z.number().min(10).max(100).catch(20),
    ditherCurve: z.number().min(1).max(4).catch(1),
    ditherLine: z.enum(toggles).catch("off"),
    // The Console section between the FAQ and the footer on the home page.
    consoleSection: z.enum(consoleSections).catch("panel"),
    consoleHeight: z.enum(consoleHeights).catch("compact"),
    consoleLabel: z.enum(consoleLabels).catch("left"),
    consoleLayout: z.enum(consoleLayouts).catch("block"),
    cornerButton: z.enum(cornerButtons).catch("neutral"),
    // Inline Console: how much the dots thin out behind the copy, in percent.
    consoleClearing: z.number().min(0).max(100).catch(65),
    sidebar: z.enum(sidebarWidths).catch("fifth column"),
    bodyWeight: z.enum(bodyWeights).catch("400"),
    // The mono stack's first family (mono-fonts.ts): OpenTUI Mono, IBM Plex Mono, or a monospaced
    // font installed on this computer, by its family name.
    monoFont: z
      .string()
      .regex(/^[\w .+&()-]{1,64}$/)
      .catch(monoFontDefault),
    // Footer wordmark: gap between hatch lines (drawing units) and corner node points.
    wordmarkHatch: z.number().min(1).max(8).catch(1),
    wordmarkNodes: z.enum(toggles).catch("on"),
    // The large OpenCode wordmark at the bottom of the footer.
    footerWordmark: z.enum(toggles).catch("on"),
    footerWordmarkAnimation: z.enum(footerWordmarkAnimations).catch("draw"),
    // A multiplier on the entrance's timing: 2 plays it in half the time.
    footerWordmarkSpeed: z.number().min(0.5).max(2).catch(1),
    footerWordmarkPlay: z.enum(footerWordmarkPlays).catch("drag"),
    // window.opencode, its DevTools greeting and OpenCode Lite starting when DevTools opens
    // (lib/console-api.ts), loaded once the page is idle.
    consoleApi: z.enum(toggles).catch("on"),
    // The light, dark and system switch at the bottom of the footer.
    themeSwitcher: z.enum(toggles).catch("on"),
    themeSwitcherStyle: z.enum(themeSwitcherStyles).catch("cycle"),
    logoMenu: z.enum(logoMenus).catch("fan"),
    logoMenuHover: z.enum(logoMenuHovers).catch("blue"),
    logoMenuItem: z.enum(logoMenuItems).catch("card"),
    pressIcon: z.enum(pressIconNames).catch("folder"),
    // Sends the Data and Console nav items to the /data-demo and /console-demo header demos.
    // On by default only in dev: production links the real products, and the setting turns the demos on.
    productNavDemo: z.enum(toggles).catch(import.meta.env.DEV ? "on" : "off"),
    footerLayout: z.enum(footerLayouts).catch("list"),
    footerLinks: z.enum(footerLinkSets).catch("community"),
    statusBars: z.enum(statusBarCounts).catch("4"),
    navGroups: z.enum(navGroups).catch("flat"),
    navNumbers: z.enum(navNumbers).catch("1"),
    // Design mode: the primary nav's items, in order, each shown or hidden and optionally renamed.
    navConfig: z
      .array(z.unknown())
      .transform((saved) => normalizeNavConfig(navDefaults, saved) as NavEntry[])
      .catch(defaultNavConfig()),
    // Design mode: saved versions of the nav list (versions.ts), and the active one ("default" is the
    // built-in Default). navConfig holds the live list; switching copies a version into it.
    navVersions: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          config: z
            .array(z.unknown())
            .transform((saved) => normalizeNavConfig(navDefaults, saved) as NavEntry[])
            .catch(defaultNavConfig()),
        }),
      )
      .catch([]),
    navVersion: z.string().catch("default"),
    // Design mode: the /product grid, dragged into this order.
    productsOrder: z
      .array(z.string())
      .transform(normalizeProductsOrder)
      .catch([...productIds]),
    linkBlue: z.enum(linkBlues).catch("console"),
    darkBlue: z.enum(darkBlues).catch("6b8fff"),
    logoScale: z.enum(logoScales).catch("20×25"),
    menuActive: z.enum(menuActives).catch("bar"),
    menuColor: z.enum(menuColors).catch("grey"),
    buttonHover: z.enum(buttonHovers).catch("blue"),
    productButton: z.enum(productButtons).catch("grey"),
    pairStyle: z.enum(pairStyles).catch("steps"),
    menuAlign: z.enum(menuAligns).catch("edge"),
    wideAlign: z.enum(wideAligns).catch("centred"),
    sectionMenuStyle: z.enum(sectionMenuStyles).catch("list"),
    productChevron: z.enum(productChevrons).catch("hidden"),
    lightBackground: z.enum(lightBackgrounds).catch("#fbfbfb"),
    // Footer copyright: the Anomaly signature logo or the word "Anomaly".
    copyrightMark: z.enum(copyrightMarks).catch("text"),
    brandPalette: z.enum(brandPalettes).catch("blue + clay"),
    variantBackground: z.enum(variantBackgrounds).catch("mesh"),
    // Brand page judgement calls: the "Works with OpenCode" badge.
    brandBadge: z.enum(toggles).catch("on"),
    badgeFont: z.enum(badgeFonts).catch("sans"),
    badgeLayout: z.enum(badgeLayouts).catch("tabs"),
    badgeTabStyle: z.enum(badgeTabStyles).catch("underline"),
    strokeDiagram: z.enum(strokeDiagrams).catch("off"),
    agentButtonCopied: z.enum(agentButtonCopiedStyles).catch("check only"),
    filmPoster: z.enum(filmPosters).catch("inverted"),
    brandAssetActions: z.enum(brandAssetActionStyles).catch("svg copy"),
    // How the legal index lists the documents (see legalHubStyles).
    legalHubStyle: z.enum(legalHubStyles).catch("grouped"),
    legalRowHover: z.enum(legalRowHovers).catch("grey"),
    // Shows the notes to legal reviewers in the draft legal documents. Off for readers.
    legalReviewNotes: z.enum(toggles).catch("off"),
    legalHistoryView: z.enum(legalHistoryViews).catch("tabs"),
    legalPrintStyle: z.enum(legalPrintStyles).catch("architect"),
    architectCover: z.enum(architectCovers).catch("c3"),
    architectInterior: z.enum(architectInteriors).catch("plain"),
    architectRule: z.enum(architectRules).catch("solid"),
    architectLabelCase: z.enum(architectLabelCases).catch("sentence"),
    architectPattern: z.enum(architectPatterns).catch("aligned-grid"),
    legalSummaryStyle: z.enum(legalSummaryStyles).catch("box"),
    // Press page judgement calls (see the press page's Settings rows).
    pressToc: z.enum(toggles).catch("on"),
    pressBoilerplate: z.enum(pressBoilerplates).catch("long + short"),
    pressMilestones: z.enum(toggles).catch("on"),
    pressNews: z.enum(toggles).catch("on"),
    pressMedia: z.enum(toggles).catch("on"),
    pressCompany: z.enum(pressCompanyStyles).catch("grid"),
    pressContact: z.enum(pressContactStyles).catch("rows"),
    pressCopyStyle: z.enum(pressCopyStyles).catch("label"),
    // Renamed from pressMediaStyle, so older saved values (the filmstrip with a big image) no longer
    // mask the new default.
    pressMediaLayout: z.enum(pressMediaLayouts).catch("products"),
    // Text selection: solid blue with white text, or a translucent blue that keeps the text colour.
    selection: z.enum(selectionStyles).catch("blue"),
    selectionOpacity: z.number().min(0).max(100).catch(10),
    searchStyle: z.enum(searchStyles).catch("palette"),
    searchBackdrop: z.enum(searchBackdrops).catch("none"),
    searchMotion: z.enum(searchMotions).catch("scale"),
    searchResults: z.enum(searchResultModes).catch("grouped"),
    searchHint: z.enum(searchHints).catch("off"),
    // On in development; off in production until it ships.
    // On everywhere, production included: for launch the orb is the Hex promo (voice/flag.ts).
    voiceOrb: z.enum(voiceOrbModes).catch("always"),
    voiceCaptions: z.enum(voiceCaptionModes).catch("popover"),
    // The orb's layered shadow, percent: 0 none, 50 the designed look, 100 strong but still soft.
    voiceOrbShadow: z.number().min(0).max(100).catch(50),
    // The search's look. The defaults are the "dim" backdrop on a solid pop-up panel. Blur is px, the
    // rest percent; saturation and brightness filter the page behind the backdrop.
    searchBlur: z.number().min(0).max(24).catch(0),
    searchDimLight: z.number().min(0).max(80).catch(0),
    searchDimDark: z.number().min(0).max(80).catch(0),
    searchTint: z.enum(searchTints).catch("neutral"),
    searchSaturate: z.number().min(50).max(200).catch(100),
    searchBrightness: z.number().min(50).max(120).catch(100),
    // Below 100 the panel shows the page through it, blurred by the panel blur (frosted glass).
    searchPanelOpacity: z.number().min(60).max(100).catch(100),
    searchPanelBlur: z.number().min(0).max(40).catch(16),
    searchShadow: z.number().min(0).max(200).catch(100),
    // A product video set id from public/product-videos.
    productVideos: z.string().catch("locked"),
    cardVideo: z.enum(cardVideoModes).catch("hover · fade"),
    cardHover: z.enum(cardHoverModes).catch("fade"),
    cardLoopSpeed: z.literal(cardVideoSpeeds).catch(1),
    cardVideoCut: z.enum(cardVideoCuts).catch("angled"),
    // Marks settings saved after angled became the default card cut (see migrateSettings).
    cardVideoRevision: z.literal(2).catch(2),
    cardHoverEntry: z.enum(cardHoverEntries).catch("demo"),
    mobileCover: z.enum(mobileCovers).catch("orb"),
    productBadges: z.enum(productBadgeModes).catch("hide"),
    mobileOrbShade: z.literal(mobileOrbShades).catch(75),
    cardTone: z.enum(cardTones).catch("color"),
    cardInfo: z.enum(cardInfoLayouts).catch("stacked"),
    phoneCardContent: z.enum(phoneCardContents).catch("overlay"),
    // A fifth carousel card for the editor extensions (VS Code, and Zed and others through ACP).
    extensionsCard: z.enum(toggles).catch("off"),
    // Home: the logo row under the hero, and "Bring your own tools".
    logoWall: z.enum(logoRows).catch("companies"),
    // The section dividers above the logo row and below it (on whichever section follows it).
    logoDividers: z.enum(toggles).catch("off"),
    logoLayout: z.enum(logoLayouts).catch("label + 6"),
    logoLabel: z.enum(logoLabels).catch("Trusted by 22M+ developers"),
    logoAnimation: z.enum(logoAnimations).catch("dither"),
    // How strong the one-colour logos and their label are, in percent of the strong text colour. 60
    // keeps the label at 4.7:1 on the light background (WCAG AA); 55 was 4.0:1.
    logoOpacity: z.number().min(20).max(100).catch(30),
    logoTuning: logoTuning.catch(logoTuning.parse({})),
    docsVariants: docsVariants.catch(docsVariants.parse({})),
    // Milliseconds between one logo's entrance and the next, in the left-to-right wash when the row
    // first scrolls into view.
    // With only two to six logos on show, a wide stagger is what makes the wash readable.
    logoStagger: z.number().min(20).max(400).catch(160),
    // Seconds between swaps.
    logoInterval: z.number().min(1).max(8).catch(2.2),
    toolsSection: z.enum(toggles).catch("on"),
    homeOrder: z
      .array(z.string())
      .transform(normalizeHomeOrder)
      .catch([...homeSections]),
    toolTiles: z.enum(toolTileStyles).catch("logo"),
    toolsAnimation: z.enum(toolsAnimations).catch("same as logos"),
    // Milliseconds between one tile's entrance and the next, in the diagonal wash.
    toolsStagger: z.number().min(20).max(300).catch(60),
    toolGrid: z.enum(toolGrids).catch("outline"),
    cardTransition: z.enum(cardTransitions).catch("grow"),
    // Card to page timing, in ms: the card growing into the hero and the hero shrinking back, the
    // new page fading in (and how long after the start), and the image the box changes into. The
    // durations are for a long trip; shorter ones take down to three quarters of it. Going back is
    // quicker than opening: the system answering, not the user choosing.
    cardGrowDuration: z.number().min(200).max(800).catch(380),
    cardShrinkDuration: z.number().min(70).max(800).catch(340),
    cardEasing: z.enum(cardEasings).catch("drawer"),
    cardPageFade: z.number().min(80).max(600).catch(220),
    cardPageDelay: z.number().min(0).max(300).catch(60),
    cardImageFade: z.number().min(60).max(400).catch(160),
    // Product page feature clips: the full app UI, or only the UI that tells each feature's story
    // (Desktop only for now; other products keep the full clips).
    featureClipStyle: z.enum(featureClipStyles).catch("focused"),
    featureClipCount: z.enum(featureClipCounts).catch("4"),
    companionStyle: z.enum(companionStyles).catch("outline"),
    // Changelog timeline: an entry's date and title stay in view while its notes scroll past.
    changelogSticky: z.enum(toggles).catch("on"),
    changelogMarker: z.enum(changelogMarkers).catch("active square"),
    changelogTitle: z.enum(changelogTitles).catch("sans"),
    changelogTitleSize: z.enum(changelogTitleSizes).catch("26 · 500"),
    changelogCarousel: z.enum(changelogCarousels).catch("bars"),
    changelogFilters: z.enum(changelogFilters).catch("areas"),
    productFeatureColumns: z.enum(productFeatureColumns).catch("4 columns"),
    // Per screen width, like the carousel: "3 columns" leaves the fourth column blank.
    sectionWidth: z
      .object({
        xl: z.enum(sectionWidths),
        lg: z.enum(sectionWidths),
        md: z.enum(sectionWidths),
        sm: z.enum(sectionWidths),
        xs: z.enum(sectionWidths),
      })
      .catch({ xl: "4 columns", lg: "4 columns", md: "4 columns", sm: "4 columns", xs: "4 columns" }),
    // Per home section, from 80rem up: the content beside the title spans two or three card columns.
    whatColumns: z.enum(sectionColumns).catch("2 columns"),
    toolsColumns: z.enum(sectionColumns).catch("2 columns"),
    openSourceColumns: z.enum(sectionColumns).catch("2 columns"),
    faqColumns: z.enum(sectionColumns).catch("2 columns"),
    consoleColumns: z.enum(sectionColumns).catch("2 columns"),
    // The intro copy (lead or Console headline) beside the body columns above; the section body is
    // as wide as the wider of the two.
    whatCopyColumns: z.enum(sectionColumns).catch("2 columns"),
    toolsCopyColumns: z.enum(sectionColumns).catch("2 columns"),
    openSourceCopyColumns: z.enum(sectionColumns).catch("2 columns"),
    consoleCopyColumns: z.enum(sectionColumns).catch("2 columns"),
    docsSwitcher: z.enum(docsSwitchers).catch("lockup"),
    docsSubmenu: z.enum(docsSubmenus).catch("flyout"),
    docsNav: z.enum(docsNavs).catch("split"),
    docsVersionNotice: z.enum(docsVersionNotices).catch("frosted top"),
    terminalInstall: z.enum(terminalInstalls).catch("button"),
    carouselPreset: z.enum(carouselPresetNames).catch("four across"),
    carousel: z
      .object({ xl: z.number(), lg: z.number(), md: z.number(), sm: z.number(), xs: z.number() })
      .catch({ ...carouselPresets["four across"] }),
    // The 404 arcade (component/site/arcade). Keys stay prefixed `arcade`; the three.js version adds
    // its own here too. Volumes and amounts are percent, multipliers are ×, times are ms.
    arcadeVersion: z.enum(arcadeVersions).catch("3D"),
    // Supersedes arcadeVersion, which stays only so older saved settings still parse.
    arcadeMode: z.enum(arcadeModes).catch("layers"),
    // Marks settings saved after layers became the default mode (see migrateSettings).
    arcadeModeRevision: z.literal(2).catch(2),
    // Marks settings saved after OpenTUI Mono became the default mono font (see migrateSettings).
    monoFontRevision: z.literal(2).catch(2),
    // The locked docs choices these settings last took (migrateSettings applies the ones that changed).
    docsChoicesApplied: z.record(z.string(), z.string()).catch({ ...docsVariantRecommended }),
    arcadeCrt: z.enum(arcadeCrts).catch("subtle"),
    arcadeMobileCopy: z.enum(arcadeMobileCopies).catch("not available"),
    arcadeLogoReveal: z.enum(arcadeLogoReveals).catch("pixels"),
    // The colour grade (arcade/tone.ts): percent of the paintings' saturation, and white balance from
    // −100 (cool) to 100 (warm).
    arcadeSaturation: z.number().min(0).max(100).catch(35),
    arcadeWhiteBalance: z.number().min(-100).max(100).catch(0),
    arcadeVolume: z.number().min(0).max(100).catch(80),
    arcadeAmbience: z.number().min(0).max(100).catch(100),
    arcadeSfx: z.number().min(0).max(100).catch(100),
    arcadeCoinSize: z.number().min(0.5).max(3).catch(1),
    arcadeGlisten: z.number().min(0).max(100).catch(100),
    // Seconds between twinkles.
    arcadeGlistenRate: z.number().min(1).max(8).catch(2.8),
    arcadeCameraSpeed: z.number().min(0.5).max(2).catch(1),
    arcadeDoorZoom: z.number().min(0.6).max(1.6).catch(1),
    arcadeScreenZoom: z.number().min(0.7).max(1.4).catch(1),
    arcadeScanlines: z.number().min(0).max(100).catch(100),
    arcadeFlicker: z.number().min(0).max(100).catch(0),
    arcadeGlitch: z.number().min(300).max(2000).catch(900),
    arcadeBoot: z.number().min(2000).max(8000).catch(4600),
    // 0 waits for a press.
    arcadeStartDelay: z.number().min(0).max(10000).catch(3200),
    arcadeNavBlend: z.enum(arcadeNavBlends).catch("screen"),
    arcadeShade: z.number().min(0).max(100).catch(100),
    // The three.js version's live controls (arcade3d/tuning.ts validates them).
    arcade3d: z.record(z.string(), z.unknown()).catch({}),
  })
}

export type SiteSettings = z.infer<ReturnType<typeof createSchema>>

// A saved preset name follows the preset, so changing a preset's values reaches everyone using it.
function withPreset(settings: SiteSettings): SiteSettings {
  const search =
    settings.searchBackdrop === "custom" ? settings : { ...settings, ...searchBackdropPresets[settings.searchBackdrop] }
  if (search.carouselPreset === "custom") return search
  return { ...search, carousel: { ...carouselPresets[search.carouselPreset] } }
}

// Bump the version when defaults change so old saved values do not mask them.
const key = "opencode-site-settings-v3"
let schema: ReturnType<typeof createSchema> | undefined
// For tests that walk every setting (test/preload-settings.test.ts).
export function siteSettingsSchema() {
  return (schema ??= createSchema())
}
// The same values as parsing nothing (test/settings-defaults.test.ts). Regenerate the file with
// `bun script/settings-defaults.ts` after changing a default.
export const siteSettingsDefaults: SiteSettings = import.meta.env.PROD
  ? (defaultSettings as SiteSettings)
  : siteSettingsSchema().parse({})
const defaults = siteSettingsDefaults

/**
 * Development settings for the new site, saved in localStorage so they survive reloads. Production
 * has no Settings panel or Design mode, so it always uses the defaults: a designer's saved settings
 * never change what visitors see.
 */
// Production reads every setting as its default's constant (script/fold-settings.ts, which fails the
// build on any other read), so its store starts empty and the defaults stay out of the bundle.
export const [siteSettings, setStore] = createStore<SiteSettings>(
  import.meta.env.DEV ? structuredClone(defaults) : ({} as SiteSettings),
)

// Set once the saved settings are loaded in full, after hydration.
let loaded = false
// The values as of the last save, load or undo, so a save can record what it changed.
let recorded = /* @__PURE__ */ structuredClone(defaults)

export function loadSiteSettings() {
  loaded = true
  if (!import.meta.env.DEV) return
  const raw = localStorage.getItem(key)
  if (!raw) return
  const migrated = migrateSettings(parseJson(raw))
  // Saves the migration, so a cut picked after it isn't migrated again on the next load.
  if (typeof migrated === "object" && migrated !== null && JSON.stringify(migrated) !== raw)
    localStorage.setItem(key, JSON.stringify(migrated))
  const parsed = siteSettingsSchema().safeParse(migrated)
  if (!parsed.success) return
  // Hydration keeps the server's attribute values while the bindings remember the values they saw,
  // so a setting that was already loaded before hydration never reaches the DOM. Pass through the
  // defaults, let the bindings run, then apply the saved values in a microtask (before paint).
  const saved = withPreset(parsed.data)
  setStore(reconcile(structuredClone(defaults)))
  queueMicrotask(() => {
    setStore(reconcile(saved))
    recorded = structuredClone(unwrap(siteSettings))
  })
}

// Settings that only change attributes and CSS can load before hydration, so the first client
// render already matches the pre-paint script and nothing resizes. Settings that switch which
// elements render (logo, nav, status, docs switcher, product videos, wordmark nodes and play) or that no pre-paint script
// applies (console section and height) wait for mount to keep hydration aligned.
if (import.meta.env.DEV && !isServer) {
  const parsed = siteSettingsSchema().safeParse(migrateSettings(parseJson(localStorage.getItem(key) ?? "")))
  if (parsed.success) {
    const {
      nav,
      logo,
      changelogFilters,
      status,
      docsSwitcher,
      terminalInstall,
      productVideos,
      cardVideoCut,
      cardHoverEntry,
      mobileCover,
      mobileOrbShade,
      featureClipStyle,
      featureClipCount,
      consoleSection,
      consoleHeight,
      heroText,
      stats,
      ossProof,
      avatarLink,
      cornerButton,
      wordmarkNodes,
      footerWordmark,
      footerWordmarkPlay,
      themeSwitcher,
      themeSwitcherStyle,
      logoMenu,
      productNavDemo,
      footerLayout,
      footerLinks,
      extensionsCard,
      logoWall,
      logoLayout,
      logoLabel,
      toolsSection,
      toolTiles,
      toolGrid,
      navGroups,
      navConfig,
      productsOrder,
      pairStyle,
      copyrightMark,
      changelogCarousel,
      legalHubStyle,
      legalRowHover,
      legalReviewNotes,
      legalHistoryView,
      legalPrintStyle,
      architectCover,
      architectInterior,
      architectRule,
      architectLabelCase,
      architectPattern,
      legalSummaryStyle,
      pressToc,
      pressBoilerplate,
      pressMilestones,
      pressNews,
      pressMedia,
      pressCompany,
      pressCopyStyle,
      pressMediaLayout,
      // The 404 renders the default mode on the server; another saved mode swaps in after mount.
      arcadeMode,
      ...layout
    } = withPreset(parsed.data)
    setStore(layout)
    recorded = structuredClone(unwrap(siteSettings))
  }
  // Follow changes made in another tab or in the product nav demos' frames. Before the full load
  // only the logo size follows, as the rest could switch what renders during hydration.
  window.addEventListener("storage", (event) => {
    if (event.key !== key) return
    const next = siteSettingsSchema().safeParse(migrateSettings(parseJson(event.newValue ?? "{}")))
    if (!next.success) return
    if (loaded) setStore(reconcile(withPreset(next.data)))
    if (!loaded) setStore("logoScale", next.data.logoScale)
    recorded = structuredClone(unwrap(siteSettings))
  })
}

/**
 * The "dot gradient" divider as a CSS rule. Dashes grow from the start dash and gaps shrink from the
 * start gap to nothing along the easing curve, filling the gradient length exactly; then the line
 * runs solid. Each edge is a fixed px offset plus a share of the length, rounded to a whole pixel
 * in CSS, so the rule follows the label column at every width. The pre-paint script inlines this
 * function as source, so it may only use its arguments.
 */
export function spacerGradientRule(
  s: Pick<SiteSettings, "spacerLength" | "spacerCount" | "spacerStartDash" | "spacerStartGap" | "spacerCurve">,
  prefix: string,
) {
  const count = Math.max(1, Math.round(s.spacerCount))
  const eases = Array.from({ length: count }, (_, index) => (count > 1 ? index / (count - 1) : 1) ** s.spacerCurve)
  const total = eases.reduce((sum, ease) => sum + ease, 0) || 1
  const gaps = eases.reduce((sum, ease) => sum + s.spacerStartGap * (1 - ease), 0)
  // A dash is the start dash plus its share of what the dashes and gaps leave of the length.
  const fixed = (gaps + count * s.spacerStartDash) / total
  const edges = eases.reduce<{ px: number; share: number; stops: [number, number][] }>(
    (acc, ease) => {
      const dash = { px: acc.px + s.spacerStartDash - ease * fixed, share: acc.share + ease / total }
      const gap = { px: dash.px + s.spacerStartGap * (1 - ease), share: dash.share }
      return { ...gap, stops: [...acc.stops, [dash.px, dash.share], [gap.px, gap.share]] }
    },
    { px: 0, share: 0, stops: [] },
  ).stops
  const length = `min(100%, var(--spacer-label) * ${s.spacerLength})`
  const stops = edges.map(
    ([px, share], index) =>
      `${index % 2 ? "transparent" : "var(--border)"} 0 round(calc(${px.toFixed(3)}px + ${length} * ${share.toFixed(5)}), 1px)`,
  )
  return `@supports (width: round(1%, 1px)) { ${prefix}[data-site][data-spacer="dot gradient"] :is([data-component="block"], [data-component="logo-wall"]:not([data-layout="section"])) { background-image: linear-gradient(to right, ${stops.join(", ")}, var(--border) 0); } }`
}

/**
 * The "dither gradient" divider as CSS custom properties: a band of whole-pixel dots, dense at one
 * end, as a mask image plus the line's place. A vertical fade is one pattern-wide tile (one SVG unit
 * per dot, scaled by the pixel size) repeated across the band. A horizontal fade is an SVG without a
 * size, so it draws at whatever size the mask gives it: bands at percentages of its width, each
 * filled with that density's dot pattern on the px grid, so CSS alone sets its length from the label
 * column and it is right on first paint. The pre-paint script inlines this function as source, so
 * it may only use its arguments.
 */
export function ditherGradientRule(
  s: Pick<
    SiteSettings,
    | "ditherHeight"
    | "ditherOrientation"
    | "ditherDirection"
    | "ditherLength"
    | "ditherPixel"
    | "ditherPattern"
    | "ditherDensity"
    | "ditherOpacity"
    | "ditherCurve"
    | "ditherLine"
  >,
  prefix: string,
) {
  const pixel = s.ditherPixel
  const height = s.ditherHeight
  const size =
    s.ditherPattern === "bayer 2×2" ? 2 : s.ditherPattern === "bayer 8×8" ? 8 : s.ditherPattern === "noise" ? 16 : 4
  // Bayer matrices double from [[0]]: each quadrant is 4 × the smaller matrix plus 0, 2, 3 or 1.
  const bayer = Array.from({ length: Math.log2(size) }).reduce<number[][]>(
    (matrix) =>
      Array.from({ length: matrix.length * 2 }, (_, y) =>
        Array.from(
          { length: matrix.length * 2 },
          (_, x) =>
            4 * matrix[y % matrix.length][x % matrix.length] +
            [
              [0, 2],
              [3, 1],
            ][Math.floor(y / matrix.length)][Math.floor(x / matrix.length)],
        ),
      ),
    [[0]],
  )
  const threshold = (x: number, y: number) => {
    if (s.ditherPattern !== "noise") return (bayer[y % size][x % size] + 0.5) / (size * size)
    const value = Math.sin((x % size) * 12.9898 + (y % size) * 78.233) * 43758.5453
    return value - Math.floor(value)
  }
  const horizontal = s.ditherOrientation === "horizontal"
  // A direction left over from the other orientation falls back to that orientation's first one.
  const direction = horizontal
    ? ["left to right", "right to left", "centre"].includes(s.ditherDirection)
      ? s.ditherDirection
      : "left to right"
    : ["down", "up", "centre"].includes(s.ditherDirection)
      ? s.ditherDirection
      : "down"
  // How dense the fade is at `at` (0 to 1 along it): full at the dense end, eased off by the curve.
  const strength = (at: number) => {
    const near =
      direction === "up" || direction === "right to left"
        ? at
        : direction === "centre"
          ? 1 - Math.abs(at * 2 - 1)
          : 1 - at
    return (s.ditherDensity / 100) * near ** s.ditherCurve
  }
  // Dots on in a `columns` × `rows` grid, as one path with each row's neighbours merged into runs.
  const dots = (columns: number, rows: number, on: (x: number, y: number) => boolean) =>
    Array.from({ length: rows }, (_, y) =>
      Array.from({ length: columns }, (_, x) => on(x, y))
        .reduce<[number, number][]>((runs, lit, x) => {
          if (!lit) return runs
          const last = runs[runs.length - 1]
          if (last && last[0] + last[1] === x) return [...runs.slice(0, -1), [last[0], last[1] + 1]]
          return [...runs, [x, 1]]
        }, [])
        .map(([x, length]) => `M${x} ${y}h${length}v1h-${length}z`)
        .join(""),
    ).join("")
  const sel = `${prefix}[data-site][data-spacer="dither gradient"] :is([data-component="block"], [data-component="logo-wall"]:not([data-layout="section"]))`
  const span =
    s.ditherLength === "full width" ? "100%" : `min(100%, var(--spacer-label) * ${parseFloat(s.ditherLength)})`
  const line =
    s.ditherLine === "off"
      ? "--dither-line: none;"
      : `--dither-line: block; ${
          horizontal
            ? `--dither-line-top: 0; --dither-line-left: ${direction === "left to right" ? "0px" : direction === "right to left" ? "calc(100% - 1px)" : "50%"}; --dither-line-width: 1px; --dither-line-height: ${height}px;`
            : `--dither-line-top: ${direction === "down" ? "0" : direction === "up" ? `${height - 1}px` : `${Math.floor(height / 2)}px`}; --dither-line-left: 0; --dither-line-width: 100%; --dither-line-height: 1px;`
        }`
  const base = `--dither-height: ${height}px; --dither-color: color-mix(in srgb, var(--text-strong) ${s.ditherOpacity}%, transparent); ${line}`
  const encode = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  if (!horizontal) {
    const rows = Math.ceil(height / pixel)
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size * pixel}' height='${rows * pixel}' viewBox='0 0 ${size} ${rows}' shape-rendering='crispEdges'><path d='${dots(size, rows, (x, y) => strength((y + 0.5) / rows) > threshold(x, y))}'/></svg>`
    return `${sel} { ${base} --dither-mask: ${encode(svg)}; --dither-mask-size: ${size * pixel}px ${rows * pixel}px; --dither-mask-repeat: repeat-x; --dither-mask-position: ${direction === "up" ? "0 100%" : direction === "centre" ? "0 50%" : "0 0"}; }`
  }
  // Each density level is a pattern; the fade is 48 bands, neighbours of one level merged.
  const levels = s.ditherPattern === "noise" ? 16 : size * size
  const bands = Array.from({ length: 48 }, (_, index) => Math.round(strength((index + 0.5) / 48) * levels))
    .reduce<[number, number, number][]>((runs, level, index) => {
      const last = runs[runs.length - 1]
      if (last && last[2] === level) return [...runs.slice(0, -1), [last[0], last[1] + 1, level]]
      return [...runs, [index, 1, level]]
    }, [])
    .filter((band) => band[2] > 0)
  const patterns = [...new Set(bands.map((band) => band[2]))]
    .map(
      (level) =>
        `<pattern id='l${level}' width='${size * pixel}' height='${size * pixel}' patternUnits='userSpaceOnUse'><path transform='scale(${pixel})' d='${dots(size, size, (x, y) => threshold(x, y) < level / levels)}'/></pattern>`,
    )
    .join("")
  const rects = bands
    .map(
      ([start, length, level]) =>
        `<rect x='${((start / 48) * 100).toFixed(4)}%' width='${((length / 48) * 100).toFixed(4)}%' height='100%' fill='url(#l${level})'/>`,
    )
    .join("")
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' shape-rendering='crispEdges'><defs>${patterns}</defs>${rects}</svg>`
  return `${sel} { ${base} --dither-mask: ${encode(svg)}; --dither-mask-size: ${span} 100%; --dither-mask-repeat: no-repeat; --dither-mask-position: ${direction === "left to right" ? "0 0" : direction === "right to left" ? "100% 0" : "50% 0"}; }`
}

/**
 * Brings settings saved by an older build forward: a "left to right" dither direction from before
 * the orientation setting means a horizontal fade. The pre-paint script inlines this function as
 * source, so it may only use its argument.
 */
// The pre-paint script inlines this function as source, so it may only use its arguments: it passes
// the recommended docs variants in as `recommended` (a module constant here would be undefined there
// and stop every saved setting from applying before first paint).
export function migrateSettings(saved: unknown, recommended = docsVariantRecommended) {
  if (typeof saved !== "object" || saved === null) return saved
  // Angled became the default card cut (Nov 3 2026): settings saved before that switch to it once;
  // a cut picked after it (saved with cardVideoRevision) stays.
  // A newly locked (or unlocked) docs choice becomes the saved option once, for that component only;
  // a variant previewed after it stays. Settings from before the lock file take every choice once.
  const prior =
    "docsChoicesApplied" in saved && typeof saved.docsChoicesApplied === "object" && saved.docsChoicesApplied !== null
      ? Object.fromEntries(Object.entries(saved.docsChoicesApplied))
      : undefined
  const choices: Record<string, string | undefined> = { ...recommended }
  const changed = Object.keys({ ...choices, ...prior }).filter((name) => !prior || prior[name] !== choices[name])
  const square =
    changed.length === 0
      ? saved
      : {
          ...saved,
          docsVariants: {
            ...("docsVariants" in saved && typeof saved.docsVariants === "object" && saved.docsVariants !== null
              ? saved.docsVariants
              : {}),
            ...Object.fromEntries(changed.map((name) => [name, choices[name] ?? "1"])),
          },
          docsChoicesApplied: { ...recommended },
        }
  const cut = "cardVideoRevision" in square ? square : { ...square, cardVideoCut: "angled", cardVideoRevision: 2 }
  // Layers became the 404 arcade's default mode (Nov 5 2026): a saved "hybrid" from before that
  // moves to it once; a mode picked after it (saved with arcadeModeRevision) stays.
  const arcade =
    "arcadeModeRevision" in cut
      ? cut
      : {
          ...cut,
          arcadeMode: "arcadeMode" in cut && cut.arcadeMode !== "hybrid" ? cut.arcadeMode : "layers",
          arcadeModeRevision: 2,
        }
  const dithered =
    "ditherOrientation" in arcade || !("ditherDirection" in arcade) || arcade.ditherDirection !== "left to right"
      ? arcade
      : { ...arcade, ditherOrientation: "horizontal" }
  // OpenTUI Mono became the site's mono font for every visitor (Nov 5 2026), replacing a face that
  // is no longer served: a mono font saved before that resets to it once; one picked after it stays.
  const dither =
    "monoFontRevision" in dithered
      ? dithered
      : {
          ...dithered,
          // A literal, not monoFontDefault: the pre-paint script inlines this function's source.
          monoFont: "OpenTUI Mono",
          monoFontRevision: 2,
        }
  // The nav list (navConfig, Nov 4 2026) replaces the nav order and the Nav items, Download nav and
  // Console nav options: the saved order, Products unless the items were "current", Models and
  // Subscriptions with "with models" or Console nav on, and Download with Download nav on.
  const old = ["navOrder", "navItems", "navDownload", "consoleNav"].filter((name) => name in dither)
  if ("navConfig" in dither || old.length === 0) return dither
  const value = (name: string) => (Object.entries(dither).find((entry) => entry[0] === name) ?? [])[1]
  const order = value("navOrder")
  const ids = ["products", "docs", "data", "models", "subscriptions", "console", "download"]
  const models = value("navItems") === "with models" || value("consoleNav") === "on"
  const shown: Record<string, boolean> = {
    products: value("navItems") !== "current",
    models,
    subscriptions: models,
    download: value("navDownload") === "on",
  }
  const kept: string[] = Array.isArray(order) ? order.filter((id) => ids.includes(id)) : []
  return {
    ...dither,
    navConfig: [...kept, ...ids.filter((id) => !kept.includes(id))].map((id) => ({ id, visible: shown[id] ?? true })),
  }
}

// Saves the keys and records them for undo. `label` names the step in the undo toast.
function save(names: readonly (keyof SiteSettings)[], label?: string) {
  recordHistory(settingsHistory, changesSince(names), { label, group: names.join(" ") })
  write(names)
}

// Writes only the changed keys over what is saved, so a tab or frame with an older copy of the
// settings doesn't overwrite values saved elsewhere, and keys this build doesn't know survive.
function write(names: readonly (keyof SiteSettings)[]) {
  names.forEach((name) => Object.assign(recorded, { [name]: structuredClone(unwrap(siteSettings[name])) }))
  const saved = parseJson(localStorage.getItem(key) ?? "")
  localStorage.setItem(
    key,
    JSON.stringify({
      ...(typeof saved === "object" && saved !== null && !Array.isArray(saved) ? saved : {}),
      ...Object.fromEntries(names.map((name) => [name, siteSettings[name]])),
      // A first save from defaults must not read as pre-angled settings on the next load.
      cardVideoRevision: siteSettings.cardVideoRevision,
      arcadeModeRevision: siteSettings.arcadeModeRevision,
      monoFontRevision: siteSettings.monoFontRevision,
      docsChoicesApplied: siteSettings.docsChoicesApplied,
    }),
  )
}

// localStorage can hold anything, including invalid JSON from an older build.
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function setSiteSetting<K extends keyof SiteSettings>(name: K, value: SiteSettings[K]) {
  setStore(name, value as never)
  save([name])
}

export function setLogoTuning<
  S extends keyof SiteSettings["logoTuning"],
  K extends keyof SiteSettings["logoTuning"][S],
>(style: S, name: K, value: SiteSettings["logoTuning"][S][K]) {
  setStore("logoTuning", style, name as never, value as never)
  save(["logoTuning"])
}

/**
 * Reads settings from an export: an object with at least one known key. Each invalid or missing
 * key falls back to its default, as on load.
 */
export function parseSiteSettings(raw: unknown) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined
  if (!Object.keys(raw).some((name) => name in defaults)) return undefined
  const parsed = siteSettingsSchema().safeParse(migrateSettings(raw))
  if (!parsed.success) return undefined
  return withPreset(parsed.data)
}

/** Applies and saves settings from an export. */
export function importSiteSettings(raw: unknown) {
  const parsed = parseSiteSettings(raw)
  if (!parsed) return false
  setStore(reconcile(parsed))
  recordHistory(settingsHistory, changesSince(settingNames()), { label: "Import settings" })
  recorded = structuredClone(unwrap(siteSettings))
  localStorage.setItem(key, JSON.stringify(siteSettings))
  return true
}

// Saved nav versions survive Reset all; the nav goes back to Default.
export function resetSiteSettings() {
  const versions = structuredClone(unwrap(siteSettings.navVersions))
  setStore(reconcile({ ...structuredClone(defaults), navVersions: versions }))
  recordHistory(settingsHistory, changesSince(settingNames()), { label: "Reset all" })
  recorded = structuredClone(unwrap(siteSettings))
  localStorage.removeItem(key)
  if (versions.length > 0) write(["navVersions"])
}

// Human labels for the undo toast, from Design mode's controls; other keys are spelled out.
const settingLabels: Partial<Record<string, string>> = {
  homeOrder: "Section order",
  navConfig: "Nav",
  navVersions: "Nav versions",
  navVersion: "Nav version",
  productsOrder: "Product order",
}

export function labelSiteSettings(labels: Partial<Record<keyof SiteSettings, string>>) {
  Object.assign(settingLabels, labels)
}

const settingsHistory: HistoryTarget = {
  apply: (values) => {
    const names = values.map((item) => item.key as keyof SiteSettings)
    values.forEach((item) => setStore(item.key as keyof SiteSettings, reconcile(structuredClone(item.value)) as never))
    // Back to the defaults throughout (undoing everything, or redoing Reset all) clears the save.
    const pristine = settingNames().every((name) => same(siteSettings[name], defaults[name]))
    if (!pristine) return write(names)
    recorded = structuredClone(defaults)
    localStorage.removeItem(key)
  },
  describe: (change, value) => {
    if (Array.isArray(value)) return ""
    const leaf = (change.path ?? []).reduce<unknown>(
      (item, part) => (typeof item === "object" && item !== null ? field(item, part) : undefined),
      value,
    )
    return typeof leaf === "object" ? "" : String(leaf)
  },
}

const settingNames = () => Object.keys(defaults) as (keyof SiteSettings)[]

function changesSince(names: readonly (keyof SiteSettings)[]): HistoryChange[] {
  return names.map((name) => {
    const before = structuredClone(recorded[name])
    const after = structuredClone(unwrap(siteSettings[name]))
    const path = changedPath(before, after)
    return { key: name, label: [labelFor(name), ...path].join(" "), before, after, path }
  })
}

// The first nested key that differs, so "Carousel lg → 3" rather than the whole object.
function changedPath(before: unknown, after: unknown): string[] {
  if (typeof before !== "object" || typeof after !== "object" || before === null || after === null) return []
  if (Array.isArray(before) || Array.isArray(after)) return []
  const name = Object.keys({ ...before, ...after }).find((item) => !same(field(before, item), field(after, item)))
  if (name === undefined) return []
  return [name, ...changedPath(field(before, name), field(after, name))]
}

function field(item: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(item, name)?.value
}

function labelFor(name: string) {
  const spelled = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
  return settingLabels[name] ?? spelled.charAt(0).toUpperCase() + spelled.slice(1)
}

function same(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

export function setCarouselSetting(name: keyof CarouselConfig, value: number) {
  setStore("carousel", name, value)
  setStore("carouselPreset", "custom")
  save(["carousel", "carouselPreset"])
}

export function setSectionWidth(name: keyof CarouselConfig, value: (typeof sectionWidths)[number]) {
  setStore("sectionWidth", name, value)
  save(["sectionWidth"])
}

/** Switches the dither's orientation, moving the direction to the new orientation's first one if needed. */
export function setDitherOrientation(value: (typeof ditherOrientations)[number]) {
  const directions: readonly string[] = ditherDirectionsFor[value]
  setStore("ditherOrientation", value)
  if (!directions.includes(siteSettings.ditherDirection)) setStore("ditherDirection", ditherDirectionsFor[value][0])
  save(["ditherOrientation", "ditherDirection"])
}

/** Applies a search backdrop preset's slider values; "custom" keeps the current ones. */
export function setSearchBackdrop(value: (typeof searchBackdrops)[number]) {
  if (value !== "custom") setStore(searchBackdropPresets[value])
  setStore("searchBackdrop", value)
  save(searchLookKeys)
}

const searchLookKeys = [
  "searchBackdrop",
  "searchBlur",
  "searchDimLight",
  "searchDimDark",
  "searchTint",
  "searchSaturate",
  "searchBrightness",
  "searchPanelOpacity",
  "searchPanelBlur",
  "searchShadow",
] as const

/** Sets a search look value. A value that a backdrop preset sets moves the backdrop to "custom". */
export function setSearchLook<K extends Exclude<(typeof searchLookKeys)[number], "searchBackdrop">>(
  name: K,
  value: SiteSettings[K],
) {
  setStore(name, value as never)
  if (name in searchBackdropPresets.dim) setStore("searchBackdrop", "custom")
  save([name, "searchBackdrop"])
}

export function resetSearchLook() {
  setStore(Object.fromEntries(searchLookKeys.map((name) => [name, defaults[name]])))
  save(searchLookKeys, "Reset search look")
}

export function applyCarouselPreset(name: (typeof carouselPresetNames)[number]) {
  if (name !== "custom") setStore("carousel", reconcile({ ...carouselPresets[name] }))
  setStore("carouselPreset", name)
  save(["carousel", "carouselPreset"])
}
