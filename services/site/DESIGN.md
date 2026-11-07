# Rules for agents

Design-system rules for the opencode.ai site (`services/site`), compiled from David's reviews and decisions. Read them before you change UI or copy. Every component they mention is live at [/dev/components](/dev/components) on the dev server.

Version 2026-11-06. Last changed 2026-11-06, menus open on the side with room (`placeMenu`) and nothing moves the scroll position on load.

To add a rule, add one line under its group. Mark a rule that is still being decided with _(provisional)_.

## Look

- Use the neutral grey tokens (`--bg`, `--text-*`, `--border*`), never raw colours in components. → [Colours](/dev/components#colours)
- Use square corners. The radius scale is `0`, `50%` (avatars, orbs, dots), `999px` (pills) and `22.5%` (app icons), nothing else. → [Radii](/dev/components#radii)
- Do not add 2px, 3px, 4px, 6px or 8px radii. They remain only on /zen's old header (2px, 8px), the 404 arcade's drawn panel (4px) and one known exception (the sheet grabber). → [Radii](/dev/components#radii)
- Write every colour as a `light-dark()` pair, so a subtree's `color-scheme` flips it. Set `color` again where a pane changes scheme, because it inherits as a resolved value. → [Colours](/dev/components#colours)
- Give each SVG `<pattern>` or gradient a per-instance id (`createUniqueId`), never a fixed id. Why — with two instances every one paints the first one's colours, as the footer wordmark hatch did in dark. → [Logo and wordmark](/dev/components#marks)
- Keep hatching and hairlines subtle, about 1.3 to 1.5 to 1 against the background in both themes (`--border` on `--bg`). → [Logo and wordmark](/dev/components#marks)
- Keep the link blue (`--link`) for links, focus rings, hover rings and open states.
- Read the page background from `--bg`; the light background follows Settings › Light background, so never assume white.
- Take every icon from `component/site/icons.tsx`, drawn in `currentColor`; no local copies in routes. → [Icons](/dev/components#icons)
- Draw icons at 16px with a 1.5px stroke, and 12px with 1.25px for chevrons and inline links. _(provisional)_ → [Icons](/dev/components#icons)

## Type

- Set every font size from the `--fs-*` tokens. Nothing is smaller than 12px, and on phones nothing that carries meaning is smaller than 14px. → [Type scale](/dev/components#type-scale)
- Use OpenTUI Mono (`--font-mono`), Anomaly's own font, for nav, labels, titles and code, and Inter (`--font-sans`) for body and reading text. → [Fonts](/dev/components#fonts)
- Serve only fonts we own or that are openly licensed (OpenTUI Mono, the OpenCode font, Inter), never a commercial face. `test/fonts.test.ts` enforces it.
- Step text once, at 960px. Only page titles (`--fs-h1`) and display titles are fluid. → [Type scale](/dev/components#type-scale)
- Set inputs with `--fs-input`, 16px on touch, so iOS doesn't zoom.
- Give section titles `--title-size` with the `--title-stroke` faux medium; the current nav item gets the same stroke.
- Keep reading text within `--measure` (about 70 characters a line).
- Let hero and product leads run as two long lines, with no max-width cap. Why — the cap was tried and removed by David.
- Give each page exactly one h1. → [Page title](/dev/components#hero)
- Wrap h2 and h3 with `text-wrap: pretty` (site.css) so headings don't end on one orphan word; keep `balance` only where a component sets it on purpose (changelog titles).

## Copy

- Use no colons in site copy (headings, leads, body, buttons, captions, alt text). Good "The easiest way to start is to download OpenCode". Bad "The easiest way to start: download OpenCode". Colons in code, commands, URLs, times and data labels are fine.
- Write statements, not rhetorical questions. Good "For more, bring your own subscription". Bad "Want more? Bring your own subscription". Real reader questions, such as FAQ entries, are fine. One deliberate exception: the footer bar's "Like letters?" (`footer.wordmark.font`), which is David's chosen copy for the font teaser.
- Call OpenCode an "open source coding agent", never an "AI coding agent". "AI models" and "AI providers" are fine.
- Say "OpenCode Models", never "Zen" or "OpenCode Zen".
- Write prices per month as "/month", for example "$10/month".
- Make any model named in copy, screenshots or footage read "Claude Opus 5.5".
- Keep list descriptions to one line at desktop width. → [Product list](/dev/components#product-list)
- Keep feature descriptions to exactly two lines at 1728px. → [Feature grid](/dev/components#feature-grid)
- Make only true claims, and check numbers against their source (stats, pricing, press facts).
- Keep the main nav as Docs, Products, Data, Console, Models, Subscriptions, Enterprise. → [Desktop sidebar nav](/dev/components#sidebar-nav)

## Layout

- Centre wide screens; the layout stops growing at 1728px (`--page-max`). → [Spacing and layout](/dev/components#spacing)
- Build on the four-column grid (`--gutter`, `--edge`, `--sidebar-width`); a section is `data-component="block"` with its title in the first column. → [Section layouts](/dev/components#block)
- Make the space below an accordion's open content match the space above it. → [Accordion](/dev/components#faq)
- Keep text aligned when you add a row background or hover fill, with negative margins and matching padding.
- Make icon tiles as tall as their text block. → [Product list](/dev/components#product-list)
- Make action buttons in product headers equal width and right-aligned.
- Keep product and companion tile sizes as they are until the size is decided. _(provisional)_ → [Companion shelf](/dev/components#companions)
- Never move the scroll position on load. The browser restores it on reload and on return from another page, and the router on in-site back and forward (`app.tsx`).
- Cause no layout shift (CLS 0). Reserve the space, and use skeletons where content streams in.
- Decide when a layout stacks by the width of its own container (container queries) where the sidebar or the Contents rail narrows the column, not by the screen width alone. _(provisional)_

## Components

- Use the shared components instead of copying their markup; this page renders the real ones. → [Components](/dev/components)
- Use `data-component="site-button"` for buttons, the ink primary or `data-variant="neutral"` grey. → [Button](/dev/components#button)
- Use a split button when there is a default choice plus alternatives, and a plain disclosure button only when there is no sensible default. → [Split button](/dev/components#split-button)
- Show a split button only as its joined pair; never render the chevron half on its own. → [Button](/dev/components#button)
- When a split button's card or column is too narrow for "Download for macOS" (under about 264px), drop the " for <OS>" text and keep the platform icon, as the inline card layouts do; never let the chevron leave its card. _(provisional)_
- Give a disabled split one shared 1px line at the join, at exactly the enabled split's size and positions. → [Button](/dev/components#button)
- Place icons by meaning. Action verbs (Download, Copy) lead, disclosure chevrons trail and flip when open, and ↗ trails anything that leaves the site, always visible. _(provisional)_ → [Button](/dev/components#button)
- Allow icon-only buttons only for universal actions (close, play, theme, copy, prev and next), each with an `aria-label` and a `data-tip` tooltip. → [Tooltips](/dev/components#toasts)
- End every `target="_blank"` link with `<NewTab />` for screen readers. → [Icons](/dev/components#icons)
- Use `component/faq.tsx` for every accordion. → [Accordion](/dev/components#faq)
- Every dropdown uses the shared Dropdown component; no one-off menus. On the site that is `SiteMenu` (`component/site/site-menu.tsx`), which brings the shared menu look, keyboard support and the phone sheet.
- Open every dropdown with `placeMenu` (`component/site/place-menu.ts`; SiteMenu already does). It opens below the trigger, above only when below has no room, and in the top layer, so a scrolling box such as the carousel never cuts it off.
- A dropdown that opens from a button with an icon starts at the button's inline-start edge, and its row icons and labels sit exactly under the button's icon and label (within 0.5px; mirrored in RTL). Set the rows' inset and gap from the button's own tokens (`--icon-inset`, `--icon-gap` in `site.css`), never per menu. Phone bottom sheets are not anchored to the button, so they don't follow this. → [Split button](/dev/components#split-button)
- Turn dropdowns into the shared bottom sheet (`sheet.tsx`) on touch phones. → [Bottom sheet](/dev/components#sheet)
- Give long pages the Contents rail (`OnThisPage`) and its phone bar (`ContentsMenu`). → [Contents](/dev/components#contents)
- Draw breadcrumbs with muted ancestors, `|` separators and the current page in ink. → [Breadcrumbs](/dev/components#breadcrumb)
- Confirm copy actions in place ("Copied") through a live region; the site has no toasts. → [Copy buttons](/dev/components#copy-buttons)
- On docs pages, the left nav's first item, the content's first item and the right rail's first item share one top line (text tops for the nav and the title, the box top for the search box).
- A sidebar that scrolls under fixed chrome (the docs nav under the logo and lockup) fades out at its edges with a mask, only while items are under that edge; phones keep hard cuts on sticky bars.
- Beside the sidebar, the OpenCode logo and the lockup beside it (DOCS) never move: fixed in the top-left corner at the same place on every page, at rest and scrolled. Whatever passes under them (a sidebar leaving with the article at the page's end) fades out under a strip of the page colour, shown only while something is under it. Phones keep their top bar.
- No flat greys inside callouts or other tinted surfaces; grey layers blend with the surface (mix-blend-mode), except code and table bodies, which stay solid. → [Code inside callouts](/dev/docs-components#blend)
- Code blocks and tables inside a tinted surface blend their header and borders with mix-blend-mode, so they take the surface's hue; code and table bodies stay solid, on the code body colour. → [Code inside callouts](/dev/docs-components#blend)
- Docs code blocks copy with a text-only button in the header: "Copy" turns to "Copied" (or "Failed"), right-aligned in the width of the longest label so nothing moves. → [Code blocks](/dev/docs-components#code-blocks)
- Size every asset button (PNG, SVG, Download) from `asset-buttons.css`. → [Asset tiles](/dev/components#asset-tiles)
- Keep code blocks in today's docs style until the style is chosen. _(provisional)_ → [Kbd and code](/dev/components#typography)

## Interaction

- Keep a button in its open look while its popup is open (`aria-expanded="true"`), with the split button's blue chevron as the reference; Escape closes and returns focus to the trigger. → [Split button](/dev/components#split-button)
- Show disabled as an outline with grey text, no fill and no hover or press, on `:disabled` and `aria-disabled="true"`. → [Button](/dev/components#button)
- Keep the focus ring on `aria-disabled` buttons, which stay focusable, and check `aria-disabled` in their click handlers. → [Button](/dev/components#button)
- Show loading with `aria-busy="true"`, which runs a bar along the button's bottom edge. → [Button](/dev/components#button)
- Put no UI behind hover alone on touch; anything hover reveals is also reachable by tap and keyboard.
- Decide device-specific UI by device (platform or coarse pointer, `prefersSheet()` and `lib/platform.ts`), not by width. → [ProductAction](/dev/components#product-action)
- Make tap targets at least 44px on coarse pointers (`tap-targets.css`).
- Close menus on Escape, an outside click and a choice, and return focus to the trigger. → [Language picker](/dev/components#language-picker)
- Test platform UI with the device preview's `_device` parameter, not a narrow window. → [ProductAction](/dev/components#product-action)
- On phones the 404 arcade centres the cabinet and has no Insert coin or Back button: a tap on the coin inserts it, and the site's own GitHub mark, menu button and sheet (`phone-menu.tsx`) sit in the top bar beside the logo.

## Motion

Motion decisions follow Emil Kowalski's skills ([emilkowalski/skills](https://github.com/emilkowalski/skills)). Install them with `npx skills add emilkowalski/skills`, then use `animate` to build motion, `review-animations` to critique it, `animation-performance` for frame budget, `apple-design` for springs and gestures, and `emil-design-eng` for polish.

- Animate only transform and opacity (composite-only); never animate layout. → [Motion](/dev/components#motion)
- Honour `prefers-reduced-motion`; fade or stop instead of moving. → [Motion](/dev/components#motion)
- Ease colour changes for 150ms, move with `--ease-out`, and scale presses to 0.985. → [Motion](/dev/components#motion)
- Use the sheet springs (open 1.0 at 0.38s, release 0.86 at 0.32s, close 1.0 at 0.28s). → [Bottom sheet](/dev/components#sheet)
- End sticky bars in a hard cut at their line, with no scroll fade. → [Sticky bars](/dev/components#sticky-bar)
- Pause dot leaders, loops and swaps off screen, in background tabs and with reduced motion. → [Logo row](/dev/components#logo-wall)

## Media

- Show real product footage and screenshots only.
- Ship no placeholders; hide a media slot until its real content exists, as on the changelog. → [Timeline](/dev/components#changelog-timeline)
- Put heavy media (video, audio, zip, glb, wasm, anything over 256KB) on the CDN, not in git; SVGs, favicons, Open Graph images and small posters stay in git.
- Give every video a poster; card videos rest on a still and play on hover. → [Product carousel](/dev/components#carousel)
- Caption videos that have speech.

## Accessibility

- Give text at least 4.5 to 1 contrast and meaningful marks and controls at least 3 to 1, in light and dark. → [Colours](/dev/components#colours)
- Keep disabled text legible at about 2.5 to 3 to 1, though WCAG exempts it. → [Button](/dev/components#button)
- Draw keyboard focus as a 2px link-blue ring, 2px outside a standalone button. → [Button](/dev/components#button)
- Draw focus rings on adjacent or split buttons inside, the ring along the button's edge and a 2px page-colour band inside it, so it never crosses into the neighbour. → [Button](/dev/components#button)
- Keep the focus ring at 3 to 1 or more against whatever it touches, in light and dark. → [Button](/dev/components#button)
- Mark decorative SVGs `aria-hidden="true"` and give icon-only controls an accessible name.
- Trap focus in dialogs and sheets, and restore it on close. → [Bottom sheet](/dev/components#sheet)
- Let single-key shortcuts skip text fields and modified keys.

## i18n and RTL

- Put new copy in `src/i18n/en.ts` (or `src/i18n/content`), never hard-coded in a component.
- Name a key in full where the page shows it (`i18n.t("home.hero.title")`, or a template that starts it, such as `` `site.theme.${name}` ``): each page's browser bundle gets only the keys its code names (`script/i18n-slices.ts`).
- Follow the translators' rules in `.opencode/agent/translator.md` (keep names, params, code and prices; stay within 140% in tight places), and check a locale with `bun src/i18n/check.ts <locale>`.
- Lay out with logical properties (`padding-inline-start`, `inset-inline-end`), never left and right; the site ships 17 locales with right to left.
- Keep the locale prefix on internal links with `language.route()`; it leaves the docs, the Console and the English-only pages unprefixed (`localized` in `src/lib/language.ts`).

## Options and flags

- Make every design option a Design mode or Settings toggle (`settings.ts`), applied before first paint, with undo, export and reset.
- Hide unfinished features behind a flag instead of deleting them (Isocast, SSH, WSL, Android "Coming soon").
- Keep the dev tools (Settings, Design mode, device preview) off for visitors in production.
- Treat the Settings defaults as the shipped design; change a default only when David decides.

## SEO and text files

- Keep `/sitemap.xml`, `llms.txt`, search and the page's `.md` version in sync when you add, remove or rename a public page, and run `bun test test/sitemap.test.ts`.
- Leave a page out of the sitemap through `sitemapExclusions` with a reason; never add a static `public/sitemap.xml`.
- Update the nav data, not the view-source comment; its FOR HUMANS rows come from the nav.
- Give every page a meta description, Open Graph image, canonical and hreflang.
- Do not ship `/dev/*`, `/data-demo` or `/console-demo`.

## Process

- Never restart the dev server (:3011), and never commit unless asked.
- Take real screenshots before and after every visual change.
- Check light and dark at 1440 and 390.
- Pass typecheck and prettier, with zero console errors.
- Re-read a file before you edit it, because other agents edit the site at the same time.
- Add each new decision here as one line, and keep the evidence in the local review notes, outside the repo.
- Review hubs, launch lists and screenshots are local dev only; never commit or link them from shipped code.
