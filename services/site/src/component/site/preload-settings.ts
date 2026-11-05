import {
  carouselBreakpoints,
  carouselPresets,
  ditherGradientRule,
  docsVariantRecommended,
  migrateSettings,
  navDefaults,
  normalizeNavConfig,
  siteSettingsDefaults,
  spacerGradientRule,
  type SiteSettings,
} from "./settings"
import { navConfigRules, navFlags, navSequence } from "./nav-config"
import { monoFontPreloads } from "./mono-fonts"

// The server always renders the default settings, and hydration keeps the server's attributes, so
// saved settings would otherwise only show once the page's code has loaded, resizing the title, the
// logo row and the cards a moment after first paint. Each rule repeats one binding, keyed by the
// element's selector ("" is the site root); names starting with "data-" are attributes, the rest
// inline styles, and `undefined` removes them. The functions are inlined into the pre-paint script
// as source, so they may only use their arguments.
const preloadRules: [string, string, (s: SiteSettings, el: HTMLElement, d: SiteSettings) => unknown][] = [
  ["", "data-popover", (s) => s.popover],
  ["", "data-spacer", (s, el) => (el.hasAttribute("data-spacer") ? s.spacer : undefined)],
  ["", "data-hero-install", (s, el) => (el.hasAttribute("data-hero-install") ? s.heroInstall : undefined)],
  [
    "",
    "data-home-announcement",
    (s, el) => (el.hasAttribute("data-home-announcement") ? s.homeAnnouncement : undefined),
  ],
  ["", "data-logo", (s) => s.logo],
  ["", "font-weight", (s) => s.bodyWeight],
  // monoFontChoice (mono-fonts.ts), repeated.
  [
    "",
    "--mono-choice",
    (s) => (s.monoFont === "OpenTUI Mono" ? undefined : `"${String(s.monoFont).replace(/["\\]/g, "")}",`),
  ],
  ["", "--selection-alpha", (s) => `${s.selectionOpacity}%`],
  ["", "--voice-orb-shadow", (s) => s.voiceOrbShadow / 100],
  ["", "--hero-scale", (s) => s.heroSize / 100],
  ["", "data-selection", (s) => (s.selection === "muted blue" ? "muted" : undefined)],
  ["", "data-blue", (s) => (s.linkBlue === "console" ? undefined : s.linkBlue)],
  ["", "data-dark-blue", (s) => (s.darkBlue === "4f8bff" ? undefined : s.darkBlue)],
  ["", "data-logo-size", (s) => (s.logoScale === "current" ? undefined : s.logoScale)],
  ["", "data-menu-active", (s) => s.menuActive.replace(" ", "-")],
  ["", "data-menu-color", (s) => s.menuColor],
  ["", "data-button-hover", (s) => (s.buttonHover === "ring" ? undefined : s.buttonHover.replace(" + ", "-"))],
  ["", "data-product-button", (s) => (s.productButton === "grey" ? undefined : s.productButton)],
  ["", "data-product-badges", (s) => (s.productBadges === "show" ? "show" : undefined)],
  ["", "data-menu-align", (s) => (s.menuAlign === "edge" ? "edge" : undefined)],
  ["", "data-wide-align", (s) => (s.wideAlign === "left" ? "left" : undefined)],
  ["", "data-nav-numbers", (s) => (s.navNumbers === "1" ? "1" : undefined)],
  ["", "data-docs-nav", (s) => s.docsNav],
  ["", "data-section-menu", (s) => s.sectionMenuStyle],
  [
    "",
    "data-docs-variants",
    (s, el) =>
      el.hasAttribute("data-docs-fixed")
        ? el.getAttribute("data-docs-variants")
        : Object.entries(s.docsVariants)
            .filter((entry) => entry[1] !== "1")
            .map((entry) => entry[0] + "-" + entry[1])
            .join(" ") || undefined,
  ],
  ["", "data-status-bars", (s) => s.statusBars],
  ["", "data-logo-menu-hover", (s) => s.logoMenuHover],
  ["", "data-light-bg", (s) => (s.lightBackground === "#ffffff" ? undefined : s.lightBackground.slice(1))],
  ["", "data-sidebar", (s) => (s.sidebar === "fifth column" ? "column" : undefined)],
  ['[data-slot="logo"]', "data-variant", (s) => s.logo],
  // The architect print's label case; ?labels= on a legal page overrides it (legal.tsx).
  [
    '[data-component^="legal-print-"]',
    "data-label-case",
    (s) => (new URLSearchParams(location.search).get("labels") === "upper" ? "upper" : s.architectLabelCase),
  ],
  // The architect cover's pattern; ?pattern= (an id or playground params) overrides it (legal.tsx).
  [
    '[data-component="legal-print-cover"]',
    "data-pattern",
    (s) => (new URLSearchParams(location.search).get("pattern") ? "custom" : s.architectPattern),
  ],
  ['nav[data-component="nav"]', "data-variant", (s) => s.nav],
  ['[data-component="hero"][data-design~="hero"]', "data-variant", (s) => s.hero],
  ['[data-section="openSource"]', "data-oss-variant", (s) => s.ossVariant],
  ['[data-component="announcement"]', "data-style", (s) => s.announcementStyle],
  ['[data-component="announcement-banner"]', "data-label", (s) => s.bannerLabel],
  ['[data-component="provider-logos"]', "data-variant", (s) => s.providerLogos],
  ['section[data-section="getStarted"]', "data-style", (s) => s.getStartedStyle],
  ['section[data-section="what"]', "data-phone-features", (s) => s.phoneFeatures],
  ['section[data-section="byos"]', "data-style", (s) => s.subsStyle],
  ["", "data-banner", (s) => (s.homeAnnouncement === "on" && s.announcementStyle === "banner" ? "" : undefined)],
  ['[data-component="hero-install"][data-mode="row"]', "data-style", (s) => s.installRowStyle],
  ['[data-component="hero"][data-design~="hero"]', "data-title-size", (s) => s.heroTitleSize],
  ['h1[data-component="page-title"]', "data-sticky", (s) => (s.stickyTitle === "off" ? undefined : s.stickyTitle)],
  ['[data-component="hero"][data-design~="hero"] p[data-width]', "data-width", (s) => s.subtitleWidth.charAt(0)],
  ['[data-component="logo-wall"]', "--logo-opacity", (s) => s.logoOpacity / 100],
  ['[data-component="logo-wall"]', "display", (s) => (s.logoWall === "off" ? "none" : undefined)],
  ['[data-component="docs-version-notice"]', "data-variant", (s) => s.docsVersionNotice],
  ['[data-component="products"]', "data-tone", (s) => s.cardTone],
  ['[data-page="brand"] [data-component="badges"]', "data-style", (s) => s.badgeFont],
  ['[data-page="brand"] [data-component="badges"]', "data-layout", (s) => s.badgeLayout],
  ['[data-page="brand"] [data-component="badges"]', "data-tab-style", (s) => s.badgeTabStyle],
  ['[data-component="products"]', "data-card-info", (s) => s.cardInfo],
  ['[data-component="products"]', "data-phone-content", (s) => s.phoneCardContent],
  ['[data-component="products-skeleton"]', "data-phone-content", (s) => s.phoneCardContent],
  [
    'section[data-component="block"][data-columns]',
    "data-columns",
    (s, el) =>
      (s[el.dataset.design?.split(" ").find((name) => name.endsWith("Columns")) as "whatColumns"] ?? "2").charAt(0),
  ],
  [
    'section[data-component="block"][data-columns]',
    "data-copy-columns",
    (s, el) => {
      const names = el.dataset.design?.split(" ") ?? []
      const copy = s[names.find((name) => name.endsWith("CopyColumns")) as "whatCopyColumns"]
      const body = s[names.find((name) => name.endsWith("Columns")) as "whatColumns"]
      return !copy || copy === body ? undefined : copy.charAt(0)
    },
  ],
  ['ul[data-component="tools"]', "data-grid", (s) => s.toolGrid],
  ['section[data-design~="toolsColumns"]', "display", (s) => (s.toolsSection === "off" ? "none" : undefined)],
  ["section[data-console-height]", "data-console-height", (s) => s.consoleHeight],
  // Console layout "block" always has the name on the left (and the panel option; see the home page).
  [
    "section[data-console-height]",
    "data-console-label",
    (s) => (s.consoleLayout === "block" ? "left" : s.consoleLabel),
  ],
  ["section[data-console-height]", "data-console-layout", (s) => s.consoleLayout],
  ["section[data-console-height]", "--clearing-strength", (s) => s.consoleClearing / 100],
  ['[data-component="product-features"]', "data-columns", (s) => s.productFeatureColumns.charAt(0)],
  ['[data-component="companions"]', "data-style", (s) => s.companionStyle],
  ['[data-component="changelog-timeline"]', "data-sticky", (s) => (s.changelogSticky === "on" ? "" : undefined)],
  [
    '[data-component="changelog-timeline"]',
    "data-marker",
    (s) => (s.changelogMarker === "progress" ? "progress" : "active"),
  ],
  ['[data-component="changelog-timeline"]', "data-title-size", (s) => s.changelogTitleSize.replace(" · ", "-")],
  ['[data-component="wordmark"]', "data-hidden", (s) => (s.footerWordmark === "off" ? "" : undefined)],
  ['[data-component="wordmark"]', "data-entrance", (s) => (s.footerWordmarkAnimation === "off" ? undefined : "")],
  // Settings that change which elements render can't be drawn before the page's code runs. Hide
  // what they change until mount (the space stays), then fade it in, rather than swap it in view.
  ['[data-slot="logo"]', "data-settling", (s, el, d) => (s.logo !== d.logo ? "" : undefined)],
  // A custom nav link isn't in the server's markup, so the nav waits for it rather than grow on mount.
  [
    'nav[data-component="nav"], #site-menu nav',
    "data-settling",
    (s, el, d) =>
      s.navGroups !== d.navGroups ||
      (Array.isArray(s.navConfig) && s.navConfig.some((entry) => !!entry && !!entry.href && !entry.removed))
        ? ""
        : undefined,
  ],
  [
    '[data-component="hero"][data-design~="hero"] h1',
    "data-settling",
    (s, el, d) => (s.heroText !== d.heroText ? "" : undefined),
  ],
  [
    '[data-component="logo-wall"]',
    "data-settling",
    (s, el, d) =>
      s.logoWall !== d.logoWall || s.logoLayout !== d.logoLayout || s.logoLabel !== d.logoLabel ? "" : undefined,
  ],
  [
    '[data-component="products"] [data-slot="track"]',
    "data-settling",
    (s, el, d) => (s.extensionsCard !== d.extensionsCard || s.productVideos !== d.productVideos ? "" : undefined),
  ],
  ['ul[data-component="tools"]', "data-settling", (s, el, d) => (s.toolTiles !== d.toolTiles ? "" : undefined)],
  ['dl[data-component="stats"]', "data-settling", (s, el, d) => (s.stats !== d.stats ? "" : undefined)],
  ['section[data-section="signup"]', "data-off", (s) => (s.signupSection === "off" ? "" : undefined)],
  ['[data-component="signup"]', "data-settling", (s, el, d) => (s.signupStyle !== d.signupStyle ? "" : undefined)],
  [
    "section[data-console-height]",
    "data-settling",
    (s, el, d) =>
      (s.consoleLayout === "block" && s.consoleSection !== "off" ? "panel" : s.consoleSection) !==
      (d.consoleLayout === "block" && d.consoleSection !== "off" ? "panel" : d.consoleSection)
        ? ""
        : undefined,
  ],
  [
    '[data-component="site-footer"]',
    "data-settling",
    (s, el, d) =>
      (
        [
          "footerLayout",
          "footerLinks",
          "themeSwitcher",
          "themeSwitcherStyle",
          "copyrightMark",
          "wordmarkNodes",
          "footerWordmarkPlay",
        ] as const
      ).some((name) => s[name] !== d[name])
        ? ""
        : undefined,
  ],
]

// Runs while the page is parsed, before first paint: applies the rules above to the root now and to
// the rest of the page as the parser adds it (mutation callbacks run before the next paint), until
// the settings store takes over on mount. A picked web mono font's file is preloaded. The server also renders the default carousel, so this
// writes the same per-width rules the carousel component writes, one step more specific.
/**
 * The pre-paint script: Site renders it as an inline script on the development server only, as saved
 * settings are a development tool; test/preload-settings.test.ts runs it.
 */
export const preloadSettings = `(()=>{try{const saved=(${String(migrateSettings)})(JSON.parse(localStorage.getItem("opencode-site-settings-v3")||"null"),${JSON.stringify(docsVariantRecommended)});if(!saved)return;const d=${JSON.stringify(siteSettingsDefaults)};const s=Object.assign({},d,saved);const w=s.sectionWidth&&typeof s.sectionWidth==="object"?s.sectionWidth:d.sectionWidth;const b=${JSON.stringify(
  carouselBreakpoints.map((breakpoint) => [breakpoint.key, breakpoint.min]),
)};const P=${JSON.stringify(carouselPresets)};const c=P[s.carouselPreset]||s.carousel||{};const css=b.map(([k,m])=>{const v=c[k];if(typeof v!=="number")return"";const r='html [data-site][data-page] [data-component="content"]{--visible:'+v+';--gaps:'+(Math.ceil(v)-1)+';--body-cards:'+(w[k]==="4 columns"?99:2)+'}';return m?"@media (min-width:"+m+"px){"+r+"}":r}).reverse().join("");const e=document.createElement("style");e.id="site-settings-preload";e.textContent=css+(${String(spacerGradientRule)})(s,"html ")+(s.spacer==="dither gradient"?(${String(ditherGradientRule)})(s,"html "):"")+(${String(navConfigRules)})(${String(normalizeNavConfig)},${String(navSequence)},${JSON.stringify(navDefaults)},${JSON.stringify(navFlags)},s);document.head.appendChild(e);const u=${JSON.stringify(monoFontPreloads)}[s.monoFont];if(typeof u==="string"){const l=document.createElement("link");l.rel="preload";l.as="font";l.type="font/woff2";l.crossOrigin="anonymous";l.href=u;document.head.appendChild(l)}const p=document.currentScript.parentElement;const R=${JSON.stringify(
  preloadRules.map((rule) => [rule[0], rule[1]]),
)};const F=[${preloadRules.map((rule) => String(rule[2])).join(",")}];const set=(el,i)=>{const n=R[i][1];let v;try{v=F[i](s,el,d)}catch{return}if(n.startsWith("data-")){if(v===undefined)el.removeAttribute(n);else el.setAttribute(n,String(v))}else if(v===undefined)el.style.removeProperty(n);else el.style.setProperty(n,String(v))};R.forEach(([q],i)=>{if(!q)set(p,i)});const patch=(node)=>R.forEach(([q],i)=>{if(!q)return;if(node.matches(q))set(node,i);node.querySelectorAll(q).forEach((el)=>set(el,i))});new MutationObserver((records,observer)=>{if(!e.isConnected)return observer.disconnect();records.forEach((record)=>record.addedNodes.forEach((node)=>{if(node.nodeType===1)patch(node)}))}).observe(p,{childList:true,subtree:true})}catch{}})()`

/**
 * The visitor's saved theme before first paint, on the site root, and the theme-color and
 * color-scheme tags that follow it (Site renders it right after preloadSettings). With `settings`
 * (the development server, where Site also renders preloadSettings) the light theme-color follows
 * the saved Settings › Light background; production keeps the default.
 */
export const themeScript = (settings: boolean) =>
  `(()=>{const t=localStorage.getItem("opencode-theme");if(t==="light"||t==="dark"||t==="system")document.currentScript.parentElement.dataset.theme=t;let l="${siteSettingsDefaults.lightBackground}";${settings ? `try{const b=JSON.parse(localStorage.getItem("opencode-site-settings-v3")||"null")?.lightBackground;if(/^#[0-9a-f]{6}$/i.test(b))l=b}catch{}` : ""}document.querySelectorAll('meta[name="theme-color"]').forEach((m)=>{m.content=t==="dark"||(t!=="light"&&m.media.includes("dark"))?"#0c0c0c":l});const c=document.querySelector('meta[name="color-scheme"]');if(c)c.content=t==="light"||t==="dark"?t:"light dark"})()`

/**
 * The site root's settings attributes with the default settings, the only values production
 * renders (Settings and Design mode are development tools): `null` for an attribute it leaves off.
 * script/css-variants.ts writes them to css-variants.json, from which the production build drops the
 * CSS for every other value (vite.config.ts); test/css-variants.test.ts keeps the file current.
 */
export function defaultRootAttributes() {
  // The root as production renders it: every settings attribute present, docs variants not fixed.
  const root = { hasAttribute: (name: string) => name !== "data-docs-fixed" } as unknown as HTMLElement
  return Object.fromEntries(
    preloadRules
      .filter((rule) => rule[0] === "" && rule[1].startsWith("data-"))
      .map((rule) => {
        const value = rule[2](siteSettingsDefaults, root, siteSettingsDefaults)
        return [rule[1], value === undefined ? null : String(value)]
      }),
  )
}
