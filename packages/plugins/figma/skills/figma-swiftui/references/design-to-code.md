# Figma → SwiftUI (design → code)

Translate a Figma design into idiomatic SwiftUI. Assumes the shared context in [SKILL.md](../SKILL.md) is loaded (URL parsing, `clientLanguages`/`clientFrameworks`, "React+Tailwind is a reference not a source", screenshot is truth).

The tables in this doc are illustrative samples, not exhaustive references — use them to infer the right mapping for similar inputs you encounter. If you find yourself reaching for `ZStack`, `HStack`, or `.offset(x:y:)` to approximate something the system already provides — a tab bar, toolbar, segmented control, list separator, glass material — stop and recognize the pattern instead; the substitution is in §6 or §10.

## 1. Pull the design

Call `get_design_context` with `nodeId` and `fileKey` extracted from the Figma URL (see [SKILL.md](../SKILL.md) shared context #1), passing:

- `clientLanguages: "swift"`
- `clientFrameworks: "swiftui"`

The response includes React+Tailwind code, a screenshot, and any Code Connect mappings the file exposes. Treat the React+Tailwind as a **structural reference, not output**.

**If `get_design_context` returns "You currently have nothing selected" (or an access/empty error) despite an explicit `nodeId`,** the URL's node-id likely points at a page/canvas or other non-renderable node rather than a frame — codegen can't run on it, even though `get_screenshot` and `get_metadata` accept it fine. Recover by calling `get_metadata` first, locating the top-level frame inside that page, and retrying `get_design_context` on the frame's id. Do **not** settle for the screenshot + metadata alone: SF Symbol names and exact title/label text live only in the design-context output (the `<SFSymbol>{Image(systemName: "…")}</SFSymbol>` wrappers — see §5) and are not visually recoverable from a screenshot, so guessing them reliably produces wrong results.

## 2. Multi-screen files: scaffold navigation first

If the Figma file (or the design context output) contains more than one screen — typical of an onboarding flow, a tabbed app, or any flow with distinct entry points — **don't dive into translating one screen at a time**. Scaffold the navigation surface, gate, and shared data first, then translate each screen against that scaffold.

1. **Pick the top-level container** from the screen relationships:
   - **Bottom tab bar repeated across screens** → `TabView` with one `Tab` per top-level destination.
   - **Linear flow (Welcome → Sign in → Home, or Onboarding → App)** → `NavigationStack`, gated by `@AppStorage` (`@AppStorage("hasOnboarded")`) or `@State` on the root view. The persisted flag is what decides which screen the root renders on cold launch.
   - **Modal flow (Compose, Settings)** → `.sheet(isPresented:)` or `.fullScreenCover(isPresented:)` from the parent screen.
2. **Stub each screen as a placeholder** before laying anything out — a one-liner like `ContentUnavailableView("Profile", systemImage: "person.crop.circle")` or a `Text("TODO: Welcome")` view is fine. Wire the routing between them so you can click through the navigation before any real layout exists.
3. **Set up sample data once**, at the root, so each screen reads from the same shape — a small `@State` array or an `@Observable` model. Translating each screen against an ad-hoc data shape and then refactoring at the end always costs more than agreeing on the shape upfront.
4. **Then translate each screen** in isolation against the scaffold. Order doesn't matter once routing exists; pick the simplest one first to validate the data shape, not the visually-richest.
5. **If a screen has an add / create affordance, build its destination too.** A "+" toolbar button, an "Add" row, or an edit affordance implies a create/edit screen — build it rather than wiring the button to a TODO. This applies to *create/edit* affordances only: a row implies a detail `NavigationLink` only when it shows a trailing chevron (§3) or the user asks — don't wrap plain chevron-less rows in fabricated detail screens.

**Create / edit form convention.** A "New X" / "Edit X" screen is a `Form` with an inline title (§6). The Figma frame name decides presentation: **"Sheet" / "Modal"** → `.sheet` (wrap the `Form` in a `NavigationStack`, with an `xmark` `.cancellationAction`); **"Nav Stack" / "Push" / "Drill"** → a pushed `navigationDestination` (back chevron handles dismissal, so no cancel button). Either way the confirm action is a `checkmark` `.confirmationAction` styled `.borderedProminent` (or iOS 26's `.glassProminent`) and `.disabled` until the form is valid — use the semantic placements with glyphs, not text "Cancel" / "Done".

Resist the temptation to translate the hero screen first. Without the navigation scaffold you'll end up rewriting the entry points and threading data the long way around anyway.

## 3. Recognize iOS UI patterns by structure, not exact strings

Figma node names vary across files and design libraries. `data-name="Grouped Table View"` in one file might be `List`, `Settings`, `Menu`, or `Cards` in another; rows may be `Row`, `Cell`, `List Item`, or `Menu Item`. Recognize the underlying iOS HIG component from a combination of:

- **Layout shape and position** in the frame — top region (large title, navigation bar), bottom region (tab bar, toolbar), repeating children of similar height (list rows), full-width cards stacked vertically (grouped sections).
- **The screenshot** — the visual is the source of truth.
- **`data-name` keywords** that suggest the pattern (treat as hints, not contracts).
- **The contents** — leading icon + trailing chevron → navigation row; leading icon + trailing toggle → settings toggle; large title text at top → `.navigationTitle(_, displayMode: .large)`.

Common mappings:

| Figma structure | SwiftUI |
|---|---|
| Settings-style rounded cards grouped in sections | `List { Section { … } }` with `.listStyle(.insetGrouped)` |
| Labeled input / setting rows — text fields, toggles, pickers, steppers stacked in sections (a settings or "New X" screen) | `Form { Section { … } }` — `Form` supplies the row insets, separators, and grouped background |
| Contacts/Messages-style edge-to-edge rows — full-width, hairline separators, sticky uppercase section headers | `List { … }` with `.listStyle(.plain)` |
| Rows with leading icon, label, trailing chevron | `NavigationLink` row inside `List` |
| Full-screen view with large title at top | `NavigationStack` + `.navigationTitle(...)` |
| Bottom bar with icons + labels | `TabView` with `Tab { … }` items |
| Card stack scrolled vertically | `ScrollView { LazyVStack { … } }` |
| Card stack scrolled horizontally | `ScrollView(.horizontal, showsIndicators: false) { LazyHStack { … } }` |
| Modal sheet pulled from bottom | `.sheet(isPresented:)` |
| Repeating identical-height rows with leading visual + title/subtitle | `List` with a custom row layout (separators between rows are handled by `List` — see §10) |
| Bottom-anchored container with a search pill + circular icon button | `.searchable(...)` + `.toolbar { ToolbarItem(placement: .bottomBar) }` (iOS 26+) |

`.listStyle(.plain)` must be **explicit** for the edge-to-edge case: the default `List` style inside a `NavigationStack` is inset-grouped, so relying on the default silently gives rounded grouped cards even when the design is a plain full-width list. Pick the row that matches the screenshot — don't let the default decide.

**Reach for `List` / `Form` before `VStack` + `Divider`.** A vertical stack of similar rows with hairline dividers between them is a `List`; a stack of labeled inputs/toggles/pickers is a `Form`. Don't hand-build it as `VStack { Row(); Divider(); Row(); … }` — that throws away the separators, row insets, grouped background, swipe actions, selection, and scrolling that `List`/`Form` provide for free, and it's the single most common "rebuilt a system container from primitives" miss. Use `VStack` only for a small fixed cluster of *dissimilar* content (e.g. a header block), not for a repeating or scrollable row list.

## 4. Tailwind `var(...)` fallback values are iOS HIG tokens

The Tailwind reference encodes HIG semantic colors as CSS variables with their literal RGBA values as fallbacks. The token *path* is the actual mapping target — don't lift the hex/rgba into the Swift code.

**Source matters.** If the color comes from an Apple system component snippet — recognized by a leading `/* iOS/iPadOS/macOS … component */` HIG-docs comment or a `data-name` like "Button - Content Area" / "Toolbar - Top" / "Segmented Control" (see §6) — it's definitively a HIG semantic color, so use the native SwiftUI mapping below. If it comes from anything else — a project-specific design system, a custom component — first check whether the codebase exposes a semantically-named color (`Color.brandPrimary`, `Color("AccentColor")`, a token in a `Color+Theme.swift` / `Tokens.swift` file, or a color set in `Assets.xcassets`) and prefer that. The HIG mapping below is the fallback when no project token covers the slot.

| Tailwind token in reference | SwiftUI |
|---|---|
| `var(--backgrounds/primary, white)` | `Color(.systemBackground)` |
| `var(--backgrounds/secondary, …)` | `Color(.secondarySystemBackground)` |
| `var(--labels/primary, black)` | `Color.primary` (or `Color(.label)`) |
| `var(--labels/secondary, rgba(60,60,67,0.6))` | `Color.secondary` (or `Color(.secondaryLabel)`) |
| `var(--labels/tertiary, rgba(60,60,67,0.3))` | `Color(.tertiaryLabel)` |
| `var(--labels/quaternary, …)` | `Color(.quaternaryLabel)` |
| `var(--separators/non-opaque, rgba(0,0,0,0.12))` | `Color(.separator)` |
| `var(--separators/opaque, …)` | `Color(.opaqueSeparator)` |
| `var(--fills/quaternary, rgba(116,116,128,0.08))` | `Color(.quaternarySystemFill)` |
| `var(--labels---vibrant---controls/secondary, #8c8c8c)` | `Color.secondary` inside a `.glassEffect()` / material — vibrancy is automatic |

If the reference shows the raw rgba without a token path (e.g. a designer typed a hex), keep it as `Color(red:green:blue:)`. Otherwise prefer the system color so dark mode works for free.

## 5. SF Symbols

`Image(systemName: …)` names come straight from `get_design_context`. Most SF Symbol glyphs in the file surface as `<SFSymbol>{Image(systemName: "...")}</SFSymbol>` wrappers in the response — use the names verbatim. For nodes with a Code Connect mapping, the Swift call appears inside the Code Connect snippet instead (use the snippet verbatim, per §6). Both paths are deterministic and authoritative. Never map codepoints by hand or guess names from the screenshot.

## 6. CodeConnectSnippet handling

The response wraps Code Connect components in `<CodeConnectSnippet data-name="…" [data-snippet-language="…"]>`. Snippets come in two shapes — check the wrapper attributes first:

**Configured (preferred) — `data-snippet-language="SwiftUI"`.** The inner content is *literal SwiftUI source code*:

```jsx
<CodeConnectSnippet data-name="Button" data-snippet-language="SwiftUI">
  Button("Play", systemImage: "play.fill", action: action).labelStyle(.titleAndIcon).buttonStyle(.borderedProminent).controlSize(.small)
</CodeConnectSnippet>
```

**Use this verbatim.** Code Connect already resolved the mapping for the team that set it up — drop any `{" "}` JSX whitespace artifacts, fill in placeholders like `action: action`, and paste the code into your view. Don't second-guess the modifiers or restyle the button. SF Symbol names, `.buttonStyle`, `.controlSize`, etc. are all there.

**Fallback — no `data-snippet-language`, or it reads `tsx`/`html`.** The inner content is a *JSX component representation* with a descriptive composite tag (`<ButtonContentArea>`, `<ToobarTopCompactSizeClass>`, `<TabBarIPhone>`) and string-encoded props (`enabled="True"`, `style="Bordered - Prominent"`) — treat those props as design metadata, not literal Swift values. You have to infer the SwiftUI mapping. Two signals tell you the snippet is from Apple's reference library:

- **A leading JSX comment linking to HIG docs**, e.g. `{/* iOS and iPadOS 26 component\nDocs: https://developer.apple.com/design/human-interface-guidelines/buttons */}`. Unambiguous — when present, treat the wrapped component as a system control regardless of the tag name.
- **A `data-name` describing a system component** ("Button - Content Area", "Toolbar - Top", "Segmented Control"). Descriptive but still reliable.

Pattern-match on those signals, not on whether the tag literally reads `<Button>`. The tables below cover the fallback shape; for configured snippets the tables are unnecessary because the SwiftUI code is already inline.

Fallback snippets come in three categories — react to each differently:

**Device chrome — discard.** These belong to Figma's device-mock template, not the app:

- `<StatusBar … />` — iOS renders this automatically; ignore the `time=` prop.
- `<Bezel … />` — simulator chrome; ignore the `color=` prop.
- `<HomeIndicator … />` — iOS renders this automatically; the `device=` and `orientation=` props are template metadata, not app state.

**Navigation chrome (toolbars, tab bars, titles) — translate to SwiftUI toolbar APIs**, not custom views:

| Snippet | SwiftUI |
|---|---|
| `<ToobarTopCompactSizeClass title="…" subtitle="…">` / any `<Toolbar - Top …>` | `NavigationStack { … .navigationTitle("…").navigationSubtitle("…") }` (subtitle requires iOS 26). **Use the literal `title=` string from the snippet** (e.g. `"Account"`) — never substitute a generic screen name like "Settings" or "Home". Wire the back button via `NavigationLink` from the parent screen, not a custom chevron. |
| `<TabBarIPhone tabs="N" …>` / any `<TabBar …>` | `TabView { Tab("…", systemImage: "…") { … } }` × N. For tabs you aren't building, use `ContentUnavailableView`. **If the bar splits Search into its own pill / separate group**, that tab is `Tab(role: .search) { … }`, not a plain `Tab` — the role is what gives it the detached search appearance. |
| `<Title title="…" mode="…" />` | `.navigationTitle("…")` + a display mode that matches the screenshot: a **centered compact title** (small, centered between leading/trailing toolbar buttons) → `.navigationBarTitleDisplayMode(.inline)`; a **large left-aligned title** → `.large` (the default). The `mode` prop indicates the rendered appearance — map it, don't ignore it. |
| `<Edit … />` | `ToolbarItem(placement: .topBarLeading) { EditButton() }` (or a custom button labeled "Edit") |
| `<Filter … />` | `ToolbarItem(placement: .topBarTrailing) { Button { … } label: { Image(systemName: "line.3.horizontal.decrease") } }` |
| `<Compose … />` | Bottom toolbar button with `Image(systemName: "square.and.pencil")` |
| `<Search … />` | `.searchable(text: $query)` |

**Don't hand-roll prominent or circular toolbar buttons.** A tinted circular toolbar button (e.g. a blue circle with a checkmark "save", or a round "+" / "edit" glyph) is a system button, not custom art: write `Button { … } label: { Image(systemName: "checkmark") }.buttonStyle(.borderedProminent)`. iOS 26 already renders toolbar buttons as glass circles automatically — do **not** rebuild the shape with `.frame(width:height:) + .background(Color) + .clipShape(.circle)`. This is the §6 segmented-control rule applied to toolbar buttons: matching the system look is what the system control already does.

**Snippets matching a SwiftUI control — use the SwiftUI control, do not re-implement.** When the snippet name lines up with a built-in control (`<SegmentedControl>`, `<Toggle>`, `<Slider>`, etc.), the snippet is drawing the *system* appearance — capsule + pill + shadow on a segmented control, sliding thumb on a toggle, and so on. These are not custom designs. Re-implementing them as `HStack` + `Button` (or `ZStack` + `Circle`) throws away accessibility, RTL, Dynamic Type, dark mode, haptic feedback, and motion-reduction behaviors that the system control handles automatically.

| Snippet | SwiftUI |
|---|---|
| `<SegmentedControl … />` | `Picker(…, selection: $sel) { … }.pickerStyle(.segmented)`. In iOS 26 this style IS a capsule container with a pill-shaped selected segment and soft shadow — if that's the Figma look, you've already matched it. Don't rebuild it from `HStack` + `Capsule`. |
| `<Toggle … />` / `<Switch … />` | `Toggle(…, isOn: $on)` |
| `<Slider … />` | `Slider(value: $v, in: …)` |
| `<Stepper … />` | `Stepper(…, value: $v)` |
| `<Picker … />` / `<Menu … />` | `Picker(…, selection: $sel) { … }` (default style is wheel/menu) |
| `<DatePicker … />` | `DatePicker(…, selection: $date)` |
| `<ProgressBar … />` / `<Progress … />` | `ProgressView(value: …)` |
| `<ActivityIndicator … />` / `<Spinner … />` | `ProgressView()` |
| `<TextField … />` | `TextField(…, text: $text)` |
| `<Button … />` | `Button(…) { }` |

Only go custom if the design *deviates* from the system appearance — different shape, non-system colors that don't resolve to a tint, custom selected-state behavior. Matching the system look is what the system control already does; building it from primitives is the wrong direction.

**Project Code Connect components — use as-is.** If the snippet imports from the user's codebase (`import { Button } from 'src/components/Button'`), find the matching SwiftUI component in the project and use it. The JS-style import path *will* be invalid in Swift — Swift has no `import { X } from 'path'` syntax. Grep the project for the component name to locate the actual SwiftUI definition.

## 7. iOS 26 surfaces (scroll edges, glass, bottom toolbar)

**Only apply this section when the Tailwind reference actually contains one of these patterns** — a `data-name` of "Scroll Edge Effect", a `mask-image: url('blur.png')` over scroll content, a pill with nested `mix-blend-multiply` / `mix-blend-color-dodge` + `backdrop-blur` (Figma's glass approximation), or a search pill anchored to a bottom toolbar. If none appear in the design context output, skip this section entirely. Don't reach for `.glassEffect()` or `.scrollEdgeEffectStyle()` just because the screenshot has a soft blur somewhere — those are *specific* iOS 26 surface effects, not catch-alls for any translucent or blurred area.

**The system already provides glass styling, so you don't need any additional modifiers for it to show up.** `Button`, `TabView`, and `.toolbar` content already get their correct system material and (on iOS 26) glass rendering automatically from the framework. Adding `.glassEffect()`, `.buttonStyle(.glassProminent)`, or `.background(.regularMaterial)` to a plain control is the most common over-application here: it double-renders the material and diverges from the system look. Only add an explicit glass/material modifier when the Figma reference shows the glass approximation *itself* (the nested `mix-blend` + `backdrop-blur` stack) on a **custom** surface the system doesn't already supply — e.g. a free-floating pill you're building by hand. When in doubt, write the plain control and let the system decide.

When one of the patterns does appear, replace it with the system modifier — do not transliterate the mix-blend / mask-image stack.

| Tailwind pattern | SwiftUI |
|---|---|
| `data-name` containing "Scroll Edge Effect" with `backdrop-blur` + `mask-image` at the top or bottom of scroll content | `.scrollEdgeEffectStyle(.soft, for: .top)` / `.bottom` |
| Pill / capsule with nested `mix-blend-multiply` + `mix-blend-color-dodge` + `backdrop-blur` + rounded fill | `.glassEffect()` on the container, or `.background(.regularMaterial, in: .capsule)` |
| Search pill in a bottom-anchored toolbar | `.searchable(...)` — iOS 26 places it in the bottom toolbar automatically on appropriate hierarchies |
| Circular icon button next to a bottom search pill | `ToolbarItem(placement: .bottomBar) { Button … }` — the system supplies the glass appearance automatically; no `.glassEffect()` needed |

A nested `mask-image: url('blur.png')` is Figma's way of painting a gradient blur. The visual intent is *always* the soft scroll edge or a glass material — never a literal image asset to ship.

## 8. Typography

**Named text styles → Dynamic Type.** `get_design_context` returns Figma's named text styles (`Title2/Emphasized`, `Headline/Regular`, `Body/Regular`, …). These map directly to SwiftUI's semantic `Font` text styles, which scale with the user's Dynamic Type setting. Map the name, don't read the pixel size:

| Named style in context | SwiftUI |
|---|---|
| `Large Title` | `.largeTitle` |
| `Title1` | `.title` |
| `Title2` | `.title2` |
| `Title3` | `.title3` |
| `Headline` | `.headline` |
| `Subheadline` | `.subheadline` |
| `Body` | `.body` |
| `Callout` | `.callout` |
| `Footnote` | `.footnote` |
| `Caption1` | `.caption` |
| `Caption2` | `.caption2` |

An `/Emphasized` suffix (e.g. `Body/Emphasized`) keeps the same text style and adds weight: `.font(.body).fontWeight(.semibold)`.

**Strip leading / optical-variant prefixes — map the core style name.** Figma often qualifies a style with a line-height or optical variant: `Tight Leading/Title 3/Emphasized`, `Loose Leading/Body/Regular`. The prefix changes line height only — it is **not** a reason to fall back to `.system(size:)`. Find the base text-style token inside the path (`Title 3` → `.title3`, `Subheadline` → `.subheadline`, `Body` → `.body`) and apply the `/Emphasized` weight bump as usual; if the tight/loose leading is visually significant, express it with `.lineSpacing(…)` on top of the named style. `Title 3` (with a space) and `Title3` are the same token — whitespace and casing in the path don't change the mapping.

**Prefer the named text style over `.system(size:)`.** `.font(.body)` gives Dynamic Type for free; a hardcoded `.system(size: 17)` does not. Only drop to `.system(size:)` when no text style fits — an oversized display/expanded number that has no semantic equivalent — and even then base the size on a text-style metric (e.g. `UIFont.preferredFont(forTextStyle: .largeTitle).pointSize`) rather than a raw pixel count, so it still tracks Dynamic Type.

**Recover the text style from raw attributes when no named style was applied.** If `get_design_context` returns no named Figma text style but the Tailwind output shows SF Pro at a size/weight that exactly matches a standard text style's canonical spec, use the text style rather than transliterating the raw values. Canonical mappings (Regular weight unless noted):

| Tailwind size + weight | SwiftUI |
|---|---|
| `text-[34px]` Medium | `.largeTitle` |
| `text-[28px]` Medium | `.title` |
| `text-[22px]` | `.title2` |
| `text-[20px]` | `.title3` |
| `text-[17px]` Semibold | `.headline` |
| `text-[17px]` Regular | `.body` |
| `text-[16px]` | `.callout` |
| `text-[15px]` | `.subheadline` |
| `text-[13px]` | `.footnote` |
| `text-[12px]` | `.caption` |
| `text-[11px]` | `.caption2` |

**Non-Apple fonts — flag and ask before substituting.** If `get_design_context` shows `font-['Inter:…']`, `font-['Helvetica:…']`, `font-['Roboto:…']`, or any other non-SF-Pro family, don't silently transliterate it as `.font(.custom("Inter", size: 17))`. Surface it to the user: Apple platforms ship a system font (SF Pro) that supports Dynamic Type, optical sizing, and SF Symbol tinting that third-party fonts can't match. Ask whether they want to substitute the system font or keep the custom one. Most designers who used Inter or Helvetica in Figma were simply unaware the system font existed — they'll usually prefer the substitution once they understand the tradeoff. If they want to keep the custom font, follow the Dynamic Type path below.

**Custom fonts with Dynamic Type.** When the design uses a custom font that should be preserved, use `.custom(_:size:relativeTo:)` instead of the plain `.custom(_:size:)` overload — this scales the custom font with the user's text-size setting using the named style as a reference:

```swift
// scales "BrandSans-Bold" the same way .body would
.font(.custom("BrandSans-Bold", size: 17, relativeTo: .body))
```

Pick the `relativeTo:` style that best matches the role of the text (body copy → `.body`, section header → `.headline`, caption → `.caption`). This is the one Dynamic Type affordance most developers never use with custom fonts — apply it proactively.

**Tailwind quirks** (apply after the named style is chosen):

- **`font-[590]`** is SF Pro's Semibold optical weight. Map to `.semibold`. Likewise `font-[510]` → `.medium`, `font-[400]` → `.regular`. Use SwiftUI's named weights, not `.custom`.
- **`font-['SF_Pro_Rounded:…',…]`** → `.system(size:, weight:, design: .rounded)`. The rounded variant is built into the system font — don't reach for `.custom("SF Pro Rounded")`.
- **Width axis — `font-['SF_Pro:Expanded_…' / 'SF_Pro:Condensed_…' / 'SF_Pro:Compressed_…']`** (also surfaced as `fontVariationSettings: "'wdth' N"` with `N ≠ 100`) → keep the named text style and add the width *on top* with **`.fontWidth(.expanded)` / `.fontWidth(.condensed)` / `.fontWidth(.compressed)`**. Width is a separate axis from weight, so stack all three: `SF Pro Expanded Medium` at a Title2 size → `.font(.title2).fontWeight(.medium).fontWidth(.expanded)`. SwiftUI's `Font.Width` tops out at `.expanded`, so `Extra Expanded` also maps to `.fontWidth(.expanded)` (there is no wider token). Never use `.custom("SF Pro Expanded")` — the width axis is built into the system font and stays Dynamic-Type-aware this way. Do **not** silently drop the width: an expanded masthead/kicker rendered at the default width is a visible regression.
- **`fontVariationSettings: "'width' 100"`** is SF Pro's *default* width — ignore that specific value; the system font already uses it. Only non-100 `'wdth'` values (and `Expanded`/`Condensed`/`Compressed` family names) map to `.fontWidth(…)`, per the width-axis bullet above.
- **`fontFeatureSettings: "'ss16' 1"`** (and other `ss##`) are stylistic-set hints used by the SF Pro picker. Usually ignorable unless the design specifically calls out a numeric look (`ss01` for alt 6/9, etc.).
- **`leading-[22px]` / `line-height: 22px`** as an absolute number — pass to `.lineSpacing()` after subtracting the font's intrinsic leading, or accept the system default. The visual diff for body text is usually invisible.
- **Negative `letterSpacing` like `-0.43`** is SF Pro's tracking and is built into the system font for headline sizes. Ignore unless the design uses a custom font.

## 9. Asset download

The `imgFoo = "https://…/api/mcp/asset/<uuid>"` URLs in the response accept GET fetches — use them directly to grab image bytes. If an image fill doesn't surface as an `img*` URL (typically flattened instance subnode children), fall back to `get_screenshot` on the parent canvas node for a static visual.

When no bytes are available for an asset, **stop and tell the user** before substituting. Reasonable fallbacks: SF Symbol placeholders (`person.crop.circle.fill`), colored circles with initials, or `Color(.systemGray5)` placeholder rects. Do not silently substitute a random photo.

## 10. What NOT to copy from the Tailwind reference

The React+Tailwind output approximates a screenshot — it is not idiomatic SwiftUI. Strip the following before writing Swift:

- **Absolute positioning / pixel frames.** SwiftUI's layout system (`HStack`, `VStack`, `Spacer`, `.padding`, `.frame(maxWidth: .infinity)`) handles spacing better than transliterated `position: absolute; left: 16px; top: 44px`.
- **`Color.black` or `Color.white` as a background.** Never hardcode these for a screen background, even if the Tailwind reference shows `bg-black`. `var(--backgrounds/primary, black)` means `Color(.systemBackground)` — in dark mode that is already black, and it adapts to forced-light, accessibility, and future platform themes. Use `Color(.systemBackground)` / `.secondarySystemBackground` etc. and rely on `.preferredColorScheme(.dark)` at the root if the design is a dark-only app.
- **Color emoji as static design content** (icons in tiles, avatars in profile circles, paw-print decorations, emoji embedded inside copy strings) — **ask the user whether to keep the emoji or substitute SF Symbols**, and explain the tradeoff: SF Symbol equivalents (`cat.fill`, `pawprint.fill`, `trophy.fill`, `stethoscope`, `medal.fill`, etc.) tint with surrounding text, scale with Dynamic Type, and render reliably; color emoji don't, and the iOS 26.x simulator renders missing glyphs as `?` boxes. Most users will pick the SF Symbol once they hear the rationale, but some genuinely want the emoji preserved — respect that choice.
- **Glass / fill+shadow / mix-blend-mode overlay stacks.** Those are Figma's approximation of system materials — replace with `.glassEffect()`, `.background(.regularMaterial)`, or `.scrollEdgeEffectStyle(.soft, for:)`. See §7.
- **Manually-drawn separators (`border-b`)** on every row inside a list — `List` provides separators by default.
- **Image asset URLs that correspond to device chrome** — status-bar glyphs, device frame outline, blur masks layered over the design. Those are not app assets; they belong to the Figma device-mock template.
- **Percent-based insets** like `inset-[54.07%_14.08%_14.07%_54.07%]` — these come from Figma's `relativeTransform` on overlay sublayers (e.g. the small/big halves of a group avatar). Convert to explicit `.offset(x:y:)` from a known parent size, or use `Image`/`Circle` stacked with `.overlay(alignment:)`.
- **A row at the top of the design with back-chevron + centered title + trailing icon button** — this is `NavigationStack` chrome, not a custom `HStack`. Use `.navigationTitle(_)` + `.toolbar { ToolbarItem(placement: .topBarTrailing) { … } }` and let the back chevron come from `NavigationLink`. A hand-rolled top bar loses back-swipe, safe-area handling, and large-title behavior.
- **A row at the bottom of the design with 4–5 icon+label pairs** — this is `TabView`, not a custom `HStack` of `Button`s. Wire each as `Tab("…", systemImage: "…") { … }`, using `ContentUnavailableView` for screens you aren't yet building. A hand-rolled bottom bar loses the system blur, badge support, and selected-tab accessibility.
- **`Divider().frame(width: 1, height: 36).background(…)`** — `Divider` is already a hairline; combining with `.frame` and `.background` is misuse and ignores `Color(.separator)`. For a fixed vertical separator between stat cells use `Rectangle().fill(Color(.separator)).frame(width: 1, height: 36)`.
- **`.offset(x: 168, y: 150)` on *flowing* content inside a hero card** — pixel offsets are wrong for anything that should adapt to Dynamic Type, RTL, or different screen widths. Place flowing content in the natural `VStack` / `HStack` flow, or use `.overlay(alignment: .bottomTrailing)` (etc.) for content anchored to an image/gradient. **Offsets are fine for genuinely-anchored decorative elements** that the designer placed precisely — a paw-print scattered around a welcome title, a watermark on a hero card, a sticker peeking out of a corner — when `.overlay(alignment:)` can't express the position. Use offsets deliberately for decoration, not as a substitute for layout.
- **Rotated `Rectangle`s + ellipses laid out as a line graph** — that's Figma's manual approximation of a chart, not the design. Use Swift Charts (`import Charts`; `LineMark` + `PointMark` for line charts, `BarMark` for bars) instead of transliterating per-segment rotated rectangles.
- **Selection state as `Int` + a parallel `[String]` of labels** — use an enum conforming to `CaseIterable` (and `Identifiable` if iterated). The index/array can drift; an enum can't.
- **Empty `Button {} label: { … }`** — placeholder code. At minimum write `Button(action: { /* TODO */ }) { … }` so the gap is visible to reviewers.
- **Round icon buttons rebuilt with `.frame(width:height:).background(Circle())`** — that throws away the system button's tap target, highlight, and accessibility. Use `Button { … } label: { Image(systemName: "…") }.buttonStyle(.bordered)` (or `.borderless`) `+ .buttonBorderShape(.circle) + .controlSize(.large)`. (For a circular button *in a toolbar*, see §6 — `.borderedProminent` and let iOS 26 supply the glass circle.)
- **A hero / article image wrapped in the same padded container as its text.** Full-bleed images often run edge-to-edge while the surrounding text stays inset. Don't apply one outer `.padding` to both — let the image span the full width (`.frame(maxWidth: .infinity)`, no horizontal padding, optionally `.ignoresSafeArea(edges: .horizontal)` or `.listRowInsets(EdgeInsets())` in a `List`) and pad only the text block.
- **A wrapping frame literally named `Sheet` / `Modal` / `Popover`.** The node name encodes presentation: build it as `.sheet(isPresented:)` (or `.popover`) content with an explicit dismiss control, not as an inline subview. §7's device-chrome rule is about discarding template frames; this is the opposite — the named container is a real presentation the design is asking for.
- **Manual `.padding(…)` that re-creates insets a container already supplies.** `List`, `Form`, `NavigationStack`, `ToolbarItem`, and the safe area already inset their content to the platform standard. Transliterating the Tailwind reference's `px-4 py-3` / `left: 16px` into a `.padding(16)` on every row or screen double-insets it and drifts from the system metric. Pin the Figma value against the system default before adding padding: if it's ~16pt at the screen edge or ~the standard row inset, it's already there — omit the modifier. Add explicit padding only where the design genuinely deviates from the default, and prefer `.padding()` (system default) or `.padding(.horizontal)` over hardcoded point values. For one-off row inset changes inside a `List`/`Form`, use `.listRowInsets(…)` rather than `.padding`.

## Output

Write the SwiftUI code into the user's project at the location they request (or propose one if they did not specify).

For colors, walk this priority order:

1. **Project design-system tokens** when they exist — `Color.brandPrimary`, `Color("AccentColor")`, an enum case from a tokens file, or a named color set in `Assets.xcassets`. Look for `Color+*.swift`, `Theme.swift`, `Tokens.swift`, or asset-catalog color sets before falling back.
2. **System HIG colors** (`Color.primary`, `.secondary`, `Color(.systemBackground)`, `Color(.separator)`) when the color comes from an Apple system component (a HIG token path — see §4). These give dark mode and accessibility behavior for free.
3. **The file's own color variables → a named Asset Catalog color set.** When the Figma file defines its *own* color variables (e.g. `--myyellow`, `--brand-blue` — a custom path, not a HIG token), preserve the **exact** value AND create a color set in `Assets.xcassets` **named to match the Figma variable** (`MyYellow`, `BrandBlue`), then reference it as `Color("MyYellow")`. This keeps the value editable, round-trippable by name, and ready for light/dark variants. **Never remap a custom brand color to a system color** (`Color.cyan`, `Color.red`) — that silently changes the brand and is almost never what the user wants. An inline `Color(red:green:blue:)` extension is a weaker version of this; prefer the named color set.
4. **Raw hex/rgba** (`Color(red:green:blue:)`) only when the Tailwind reference shows a one-off value with no token path and no variable name to anchor a color set to.

**Brand accent → the `AccentColor` asset.** When the design has a single brand tint applied across controls (buttons, toggles, progress indicators), write it into the `AccentColor` color set in `Assets.xcassets` and let controls inherit it, rather than hardcoding `.tint(Color(...))` on each view. Inherited accent gives consistent theming and light/dark support for free.

**A Figma accent variable on a specific element is not necessarily the iOS `AccentColor`.** When the Tailwind reference uses a custom color variable — `var(--accents/custom-accent, …)`, `var(--brand/highlight, …)`, `var(--colors/green-lime, …)`, or any similar per-element tint path — to color a badge, kicker label, or decorative text, that color should become a named color set in `Assets.xcassets` (rule 3 above), **not** go into `AccentColor`. The variable name in the Figma file is your cue: if it scopes to a component or element (e.g. `--accents/custom-accent`, `--status/active`) rather than the whole app (e.g. `--brand/primary`, `--app/tint`), it is a custom color, not the app tint. Setting `AccentColor` to it would recolor every system button, toggle, and link in the app. Check what color the design uses for interactive controls (tapped buttons, selected tabs) to determine the real `AccentColor`; when that information is not visible in the current frame, leave `AccentColor` at the Xcode default and flag the uncertainty to the user.

Standard SwiftUI modifiers always beat transliterated `position: absolute` / `mix-blend-mode` stacks from the Tailwind reference.
