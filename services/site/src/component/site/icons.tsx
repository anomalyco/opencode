import { useI18n } from "~/context/i18n"
import { createUniqueId, Match, Show, Switch } from "solid-js"
import type { OS } from "~/lib/download"

export const themes = ["system", "light", "dark"] as const

export function PlatformIcon(props: { platform: NonNullable<OS> | "iOS" | "Android" | "TestFlight" }) {
  // The TestFlight blades' trail gradient, unique per icon so several on a page don't share one.
  const trail = createUniqueId()
  return (
    <svg
      data-slot="platform-icon"
      data-icon={props.platform === "TestFlight" ? "testflight" : undefined}
      width="14"
      height="14"
      // TestFlight's propeller is drawn about 4px larger than the other marks in the same box, its
      // hub at the box's centre, and its blades run over the box's edge.
      viewBox={props.platform === "TestFlight" ? "2.8 2.8 18.4 18.4" : "0 0 24 24"}
      overflow={props.platform === "TestFlight" ? "visible" : undefined}
      fill="currentColor"
      aria-hidden="true"
    >
      <Switch>
        <Match when={props.platform === "macOS" || props.platform === "iOS"}>
          <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
        </Match>
        {/* The iPhone beta's links: TestFlight's three-blade propeller, each blade trailing a fading
            wedge as if spinning clockwise. */}
        <Match when={props.platform === "TestFlight"}>
          <defs>
            <linearGradient id={trail} gradientUnits="userSpaceOnUse" x1="12.5" y1="3" x2="5" y2="7.5">
              <stop offset="0" stop-color="currentColor" stop-opacity="0.75" />
              <stop offset="1" stop-color="currentColor" stop-opacity="0" />
            </linearGradient>
          </defs>
          <g data-slot="propeller">
            {[0, 120, 240].map((angle) => (
              <g transform={`rotate(${angle} 12 12)`}>
                <path d="M12 12 12 1.4A10.6 10.6 0 0 0 3.9 5.2Z" fill={`url(#${trail})`} />
                <path d="M12 12C8.9 9.2 8.7 4.1 12 .7c3.3 3.4 3.1 8.5 0 11.3Z" />
              </g>
            ))}
            <circle cx="12" cy="12" r="2.7" />
          </g>
        </Match>
        <Match when={props.platform === "Windows"}>
          <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
        </Match>
        <Match when={props.platform === "Linux"}>
          <path
            fill-rule="evenodd"
            d="M12 1C9.4 1 7.9 3.1 7.9 5.8c0 1.5-.5 2.6-1.4 3.9C5.3 11.5 4.4 13.4 4.4 15.7c0 1.7.6 3.1 1.6 4.2L4.2 21.2c-.6.5-.3 1.5.5 1.6l3.6.2c.6 0 1.1-.3 1.3-.8.8.2 1.6.3 2.4.3s1.6-.1 2.4-.3c.2.5.7.8 1.3.8l3.6-.2c.8-.1 1.1-1.1.5-1.6L18 19.9c1-1.1 1.6-2.5 1.6-4.2 0-2.3-.9-4.2-2.1-6-.9-1.3-1.4-2.4-1.4-3.9C16.1 3.1 14.6 1 12 1zm0 9.8c-2.2 0-3.9 2.3-3.9 5.1s1.7 4.6 3.9 4.6 3.9-1.8 3.9-4.6-1.7-5.1-3.9-5.1zM10.5 5.2a.9.9 0 100 1.8.9.9 0 000-1.8zm3 0a.9.9 0 100 1.8.9.9 0 000-1.8z"
          />
        </Match>
        <Match when={props.platform === "Android"}>
          <path d="M17.6 9.48l1.84-3.18a.38.38 0 00-.66-.38l-1.86 3.22A11.4 11.4 0 0012 8.08c-1.77 0-3.43.4-4.92 1.06L5.22 5.92a.38.38 0 10-.66.38L6.4 9.48A10.78 10.78 0 001 18h22a10.78 10.78 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 111.25-1.25A1.25 1.25 0 017 15.25zm10 0A1.25 1.25 0 1118.25 14 1.25 1.25 0 0117 15.25z" />
        </Match>
      </Switch>
    </svg>
  )
}

export function ThemeIcon(props: { theme: (typeof themes)[number] }) {
  return (
    // A small round sun with eight long rays. The "View as agent" robot uses the same size and stroke.
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      aria-hidden="true"
    >
      <Show when={props.theme === "light"}>
        <circle cx="8" cy="8" r="2" />
        <path d="M8 1V4M8 12V15M1 8H4M12 8H15M3.125 3.125L5.125 5.125M10.875 10.875L12.875 12.875M12.875 3.125L10.875 5.125M5.125 10.875L3.125 12.875" />
      </Show>
      <Show when={props.theme === "dark"}>
        <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5A5.5 5.5 0 1 0 13.5 9.5Z" stroke-linejoin="round" />
      </Show>
      <Show when={props.theme === "system"}>
        <rect x="2" y="2.75" width="12" height="8.5" />
        <path d="M5.5 14H10.5M8 11.25V14" />
      </Show>
    </svg>
  )
}

export function ExternalArrow() {
  return (
    <svg data-slot="external" width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
      <path d="M0 0.5H5.5V6M5.5 0.5L0.25 5.75" stroke="currentColor" />
    </svg>
  )
}

/** Tells screen readers that a `target="_blank"` link opens a new tab; hidden on screen. */
export function NewTab() {
  const i18n = useI18n()
  return <span data-slot="sr-only">{i18n.t("site.newTabSuffix")}</span>
}

export function Chevron() {
  return (
    <svg data-slot="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="square"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  )
}

/**
 * A right chevron for links that lead on (the home announcement), drawn light to sit with 13px mono
 * text: a 1px stroke on half pixels, 5px tall, about the x-height, so it reads like a typed "›".
 */
export function ChevronRight() {
  return (
    <svg data-slot="chevron-right" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M3.5 2.5L6 5L3.5 7.5" stroke="currentColor" stroke-width="1" stroke-linecap="square" />
    </svg>
  )
}

/**
 * A magnifying glass for search buttons, a 1.5px stroke at any size: a lens and a short handle in a 16px ink box,
 * the width of the menu lines, so it sits with them and the chevrons. search-palette.tsx draws the same.
 */
export function SearchIcon() {
  return (
    <svg data-slot="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle
        cx="7.43"
        cy="7.43"
        r="5.06"
        stroke="currentColor"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
      />
      <path
        d="M11 11L13.33 13.33"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="square"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  )
}

/** A light ×: a 1.5px stroke in a 16px box, about the GitHub mark's visual size beside it. */
export function CloseIcon() {
  return (
    <svg data-slot="close-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
    </svg>
  )
}

/** Button icons, the brand page's set: a 1.5px stroke in a 20-unit box drawn at 16px. */
export function DownloadIcon() {
  return (
    <svg data-slot="button-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="square"
      />
    </svg>
  )
}

export function CopyIcon() {
  return (
    <svg data-slot="button-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7.5 7.5V3.75H16.25V12.5H12.5M3.75 7.5H12.5V16.25H3.75V7.5Z" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg data-slot="button-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10.5L8 14.5L16 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
    </svg>
  )
}

/**
 * The Hex mark: two hexagon rings around a solid hexagon. Hex has no vector logo, so this is its app
 * icon's mark (anomalyco/hex app/AppIcon.icon/Assets/Image.png) rebuilt from that image's measured
 * edges and corner radii.
 */
export function HexMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 1488 1672" fill="currentColor" aria-hidden="true">
      <path
        fill-rule="evenodd"
        d="M669 20A149 149 0 0 1 819 20L1413 363A149 149 0 0 1 1488 493L1488 1179A149 149 0 0 1 1413 1309L819 1652A149 149 0 0 1 669 1652L75 1309A149 149 0 0 1 0 1179L0 493A149 149 0 0 1 75 363ZM673 123A142 142 0 0 1 815 123L1326 418A142 142 0 0 1 1397 541L1397 1131A142 142 0 0 1 1326 1254L815 1549A142 142 0 0 1 673 1549L162 1254A142 142 0 0 1 91 1131L91 541A142 142 0 0 1 162 418ZM676 307A136 136 0 0 1 812 307L1168 513A136 136 0 0 1 1236 631L1236 1041A136 136 0 0 1 1168 1159L812 1365A136 136 0 0 1 676 1365L320 1159A136 136 0 0 1 252 1041L252 631A136 136 0 0 1 320 513ZM686 407A117 117 0 0 1 802 407L1087 571A117 117 0 0 1 1145 672L1145 1000A117 117 0 0 1 1087 1101L802 1265A117 117 0 0 1 686 1265L401 1101A117 117 0 0 1 343 1000L343 672A117 117 0 0 1 401 571ZM718 596A53 53 0 0 1 770 596L939 693A53 53 0 0 1 965 739L965 933A53 53 0 0 1 939 979L770 1076A53 53 0 0 1 718 1076L549 979A53 53 0 0 1 523 933L523 739A53 53 0 0 1 549 693Z"
      />
    </svg>
  )
}

/** Browse's mark: a plain arrow pointer, flat like the other marks in the product list. The view box
 * centres the arrow's visual mass (its centroid, about 10,13), not its bounding box, so the
 * pointer looks centred in the tile. */
export function BrowseMark() {
  return (
    <svg width="20" height="20" viewBox="1.5 2.5 17 21" fill="currentColor" aria-hidden="true">
      <path d="M5 2.5v16.8l4.3-4.1 2.8 6.3 3-1.3-2.8-6.2h6.1Z" />
    </svg>
  )
}

/** The OpenTunnel mark (David's, 6 Nov 2026; also public/apps/opentunnel-mark.svg): nested arches. */
export function OpenTunnelMark() {
  return (
    <svg width="20" height="20" viewBox="127 63 946 1040" fill="currentColor" aria-hidden="true">
      <path
        fill-rule="evenodd"
        d="M127 1103V536a473 473 0 0 1 946 0v567zM204 1025V537a396 396 0 0 1 792 0v488zM282 1025V567a318 318 0 0 1 636 0v458zM359 1025V567a241 241 0 0 1 482 0v458zM437 1025V598a163 163 0 0 1 326 0v427zM515 1025V598a85 85 0 0 1 170 0v427z"
      />
    </svg>
  )
}

/** The OpenTUI mark, from its site's favicon (anomalyco/opentui packages/web): a frame with a cursor cut out. */
export function OpenTUIMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path fill-rule="evenodd" d="M2 3h20v18H2Zm4 5v8h3V8Z" />
    </svg>
  )
}

/** The GitHub mark (Octicons mark-github). */
export function GitHubMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  )
}
