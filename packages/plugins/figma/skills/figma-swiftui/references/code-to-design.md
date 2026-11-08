# SwiftUI → Figma (code → design)

Translate SwiftUI source code into a Figma design using `use_figma`. This doc covers the SwiftUI-specific translation knowledge; the API-level rules for `use_figma` itself live in [`figma-use`](../../figma-use/SKILL.md), the screen-assembly workflow lives in [`figma-generate-design`](../../figma-generate-design/SKILL.md), and the component / variant / variable workflow lives in [`figma-generate-library`](../../figma-generate-library/SKILL.md). Load whichever of those match the scope of the request, and use this doc to drive the *SwiftUI semantic interpretation* of the source.

Assumes the shared context in [SKILL.md](../SKILL.md) is loaded.

## 1. Decide the scope first

What is actually being pushed into Figma? The scope decides which companion skill to load.

| Source SwiftUI | Figma scope | Companion skill to load |
|---|---|---|
| A single view / component (one `Button` style, one row, one card) | A single component or component set | [`figma-generate-library`](../../figma-generate-library/SKILL.md) |
| A screen — a `NavigationStack { … }`, a `TabView { … }` body, or a `View` that renders a whole route | A frame on a page, composed from design-system components | [`figma-generate-design`](../../figma-generate-design/SKILL.md) |
| A multi-screen flow — every screen in an app, plus shared tokens | A design system + screen frames | [`figma-generate-library`](../../figma-generate-library/SKILL.md), then [`figma-generate-design`](../../figma-generate-design/SKILL.md) |
| A standalone token set (colors, typography, spacing) with no views | Variable collections only | [`figma-generate-library`](../../figma-generate-library/SKILL.md) |
| A target Figma file does not yet exist | Create one first | [`figma-create-new-file`](../../figma-create-new-file/SKILL.md) before any `use_figma` call |

If the scope is unclear from the prompt, ask before writing — building a component set when the user wanted a screen frame (or vice versa) is expensive to undo.

## 2. Discover before creating

Before writing any `use_figma` script, run the discovery the [`figma-use`](../../figma-use/SKILL.md) and [`figma-generate-design`](../../figma-generate-design/SKILL.md) skills already require — but with SwiftUI-shaped expectations:

- **Existing variables.** Does the file already have a semantic color collection with iOS-flavored names (`label/primary`, `background/secondary`, `separator/non-opaque`)? Use it. If not, the names from Apple's HIG (see §4) are reasonable defaults.
- **Existing components.** Search via `search_design_system` for the SwiftUI controls you're about to translate — `Button`, `Toggle`, `Slider`, `Picker (Segmented)`, `NavigationBar`, `TabBar`, etc. Most design systems already have these; rebuilding produces duplicates.
- **Apple's official design libraries.** Apple publishes per-OS Figma libraries as Community libraries — *iOS 18 and iPadOS 18*, *iOS and iPadOS 26*, *watchOS 26*, *visionOS 26*. Many files don't have them subscribed yet, but they're available to add. Call `get_libraries` and check `libraries_added_to_file` first, then `libraries_available_to_add` (Apple's libraries show up with `source: "community"`). Once you have the library's `libraryKey`, scope every subsequent `search_design_system` call with `includeLibraryKeys: [appleLibraryKey]` so you only match Apple's authored components instead of every other library the file has ever subscribed. Naming is stable across these libraries — `Navigation Bar - iPhone (Compact Size Class)`, `Status Bar - iPhone`, `Tab Bar - iPhone`, `Row`, `Button`, `Segmented Control`, `Stepper` — so queries can be specific. Prefer the matching library over hand-rolling SF-Symbol-and-rectangle approximations.
- **Code Connect mappings.** If the project already has `figma-code-connect` templates pointing the existing Figma components at SwiftUI source (or vice versa), follow them — don't generate parallel components. See [`figma-code-connect`](../../figma-code-connect/SKILL.md).
- **Device frame conventions.** Apple's Figma libraries ship **Product Bezels** components — the physical hardware shell around the screen, sized to match real device dimensions (iPhone 16: 393 × 852, iPhone 16 Pro: 402 × 874, iPad models likewise). Search `search_design_system` for `Product Bezels` and drop the matching bezel as the outer wrapper rather than drawing your own. The screen frame nested inside the bezel **must match the width of the chrome components from the same library** — Nav Bar, Tab Bar, Status Bar are authored at the same width as the bezel they belong to. Sizing the screen at 393 and dropping in a 402-wide nav bar produces a misaligned design. **This pixel-width discipline applies only to the outer screen frame and the chrome components — inner content still uses auto-layout (`FILL`/`HUG`) and Figma's responsive constraints, not absolute `x`/`y` positioning.** SwiftUI's layout is relative, and the Figma representation should be too inside the screen.

## 3. Map SwiftUI structure to Figma structure

The SwiftUI source already encodes intent — translate the *system semantics*, not the rendered pixels.

| SwiftUI source | Figma representation |
|---|---|
| `NavigationStack { … }.navigationTitle(_)` | Top-of-frame nav bar with large-title text, optional back-chevron + trailing action. Use a Code Connect-mapped "Navigation Bar" component if one exists; otherwise an auto-layout frame built via `figma.createAutoLayout()`. |
| `.navigationSubtitle(_)` (iOS 26+) | Second line under the large title in the nav bar. |
| `.toolbar { ToolbarItem(placement: …) { … } }` | Icon / text buttons in the nav bar (top) or bottom toolbar — placement decides which. |
| `TabView { Tab("…", systemImage: "…") { … } }` | Bottom tab bar: a row of icon+label pairs. Use a "Tab Bar" component if present. Each tab's child becomes a separate screen frame on the canvas. |
| `.sheet(isPresented:)` / `.fullScreenCover(…)` | Separate frame on the page, annotated as a modal — typically stacked behind a dimmed scrim frame. |
| `List { Section { … row … } }` | Grouped table: outer frame with grouped section headers, inner rows as repeating instances. List separators are part of the row component, not drawn manually — and the separator is **omitted on the last row of each section** (SwiftUI's `List` does this natively; the Figma representation should too). |
| `Form { … }` | Same shape as grouped `List` — inset rounded sections with rows. |
| `ScrollView { LazyVStack { … } }` | Vertical auto-layout frame; add a scroll-edge fade only if the design system already has one. |
| `ScrollView(.horizontal) { LazyHStack { … } }` | Horizontal auto-layout frame, child cards as instances. |
| `VStack`, `HStack` | `figma.createAutoLayout('VERTICAL')` / `figma.createAutoLayout('HORIZONTAL')` — never absolute `x`/`y` for arranging contents. See [`figma-use`](../../figma-use/SKILL.md) Rule 12a. |
| `ZStack` | A frame with `.overlay(alignment:)`-style stacking. Reserve absolute `x`/`y` for genuinely-overlapping decoration, not for primary layout. |
| `Spacer()` | Auto-layout `primaryAxisAlignItems: 'SPACE_BETWEEN'` on the parent, or a `FILL`-sized empty child. Do not materialize a literal "Spacer" node. |
| `Divider()` | `figma.createLine()` (or a thin `RECTANGLE` bound to a `separator/*` variable). Do not draw a 1pt frame with a fill. |
| `LazyVGrid` / `LazyHGrid` | Auto-layout frame with wrap, OR a canvas grid container — pick whichever the file's existing layouts use. |
| `GroupBox` | A rounded inset card with a header label — usually maps to an existing "Card" component. |
| `Label("Text", systemImage: "x")` | An auto-layout row of `[icon, text]` — use the file's `Icon` component or an SF Symbol glyph text node (see §5). |

Reach for built-in design-system components first — every SwiftUI control above has a Figma equivalent in most libraries. Custom shapes only when the design genuinely deviates from a system control.

## 4. Map system colors to Figma variables

When the SwiftUI source uses HIG semantic colors, bind to (or create) Figma variables with the matching semantics. Never paste a hex.

| SwiftUI | Figma variable (suggested semantic name) |
|---|---|
| `Color(.systemBackground)` | `background/primary` |
| `Color(.secondarySystemBackground)` | `background/secondary` |
| `Color(.tertiarySystemBackground)` | `background/tertiary` |
| `Color.primary` / `Color(.label)` | `label/primary` |
| `Color.secondary` / `Color(.secondaryLabel)` | `label/secondary` |
| `Color(.tertiaryLabel)` | `label/tertiary` |
| `Color(.quaternaryLabel)` | `label/quaternary` |
| `Color(.separator)` | `separator/non-opaque` |
| `Color(.opaqueSeparator)` | `separator/opaque` |
| `Color(.quaternarySystemFill)` | `fill/quaternary` |
| `Color.accentColor` | `accent/primary` (or whatever the file calls the brand tint) |
| Hardcoded `Color(red:green:blue:)` | A primitive variable if reused, otherwise a raw value in-place |

If the source uses a project-specific token (`Color.brandPrimary`, `Color("AccentColor")`), look for the matching semantic variable in Figma before creating a new one. When creating variables, follow [`figma-generate-library`](../../figma-generate-library/SKILL.md) — set scopes explicitly (`FRAME_FILL, SHAPE_FILL` for backgrounds, `TEXT_FILL` for labels, `STROKE_COLOR` for separators); never leave `ALL_SCOPES`.

**Dark mode:** model both modes on the same variable collection. If the SwiftUI source distinguishes via `.preferredColorScheme(.dark)` or different literal colors per scheme, model both modes; otherwise the system-color mapping inherits dark mode for free.

## 5. SF Symbols → Figma glyphs

`Image(systemName: "gear")` in SwiftUI becomes a text node in Figma whose character is set via **`figma.util.getSfSymbolCharacter(name)`** — a `use_figma` helper that takes the SF Symbol name and returns the matching character string. Never hand-look up codepoints, never paste literal `\u{…}` escapes into your script.

```js
await figma.loadFontAsync({ family: "SF Pro", style: "Regular" })
const icon = figma.createText()
icon.fontName = { family: "SF Pro", style: "Regular" }
icon.fontSize = 17
icon.characters = figma.util.getSfSymbolCharacter("square.and.arrow.up")
// bind icon.fills to a label/* variable so the glyph tints with surrounding text
```

The helper throws `RangeError` when the name is unknown — if that happens, **surface the gap to the user**; do not silently fall back to a different glyph or paste a guessed codepoint.

**Fall back to uploading a PNG / SVG via `upload_assets`** only when the symbol's tint must be independent of the surrounding label color (a colored brand glyph, a multicolor variant), or when the target file pre-dates SF Symbol support.

For long-term linkage, set up a Code Connect mapping pointing a Figma "Icon" component (with an `INSTANCE_SWAP` property for each symbol) at the SwiftUI source's `Image(systemName: …)` — see [`figma-code-connect`](../../figma-code-connect/SKILL.md). The next design → code task on this file will then return SwiftUI directly.

## 6. Typography

SwiftUI maps to a small set of named text styles. Mirror them as Figma text styles, not as raw font properties on each text node.

| SwiftUI | Figma text style (suggested name) |
|---|---|
| `.font(.largeTitle)` | `Large Title` |
| `.font(.title)` / `.title2` / `.title3` | `Title 1`, `Title 2`, `Title 3` |
| `.font(.headline)` / `.subheadline` | `Headline`, `Subheadline` |
| `.font(.body)` | `Body` |
| `.font(.callout)` | `Callout` |
| `.font(.footnote)` | `Footnote` |
| `.font(.caption)` / `.caption2` | `Caption 1`, `Caption 2` |
| `.system(size:, weight:, design: .rounded)` | A style using `SF Pro Rounded` (the system rounded variant — not a `.custom(...)` font) |
| `.fontWeight(.semibold)` | The Semibold weight on whatever style the node uses |
| `.font(.custom("SomeFamily-Bold", size: 17))` / `.font(Font.custom("Inter", size: 14))` | A Figma text style using the named custom font at the matching size and weight — do **not** silently substitute SF Pro |

The SF Pro family is system-resident in iOS, so the Figma file needs `SF Pro` (and `SF Pro Rounded`) loaded — verify via `await figma.listAvailableFontsAsync()` before writing text. If only Inter is available, ask the user before substituting; Inter's metrics diverge enough that text-overflow bugs surface after translation.

**When the SwiftUI source specifies a custom font** (`.custom("Foo-Bold", …)` or `Font.custom("Foo", …)`):

1. Look up the exact family/style via `await figma.listAvailableFontsAsync()` before any text write — the Postscript name in `.custom(_)` (e.g. `Foo-Bold`) does NOT always match the Figma `family` + `style` pair (commonly `Foo` family + `Bold` style). Pick the matching pair from the available-fonts list.
2. If the font is missing from the file, **stop and surface the gap to the user.** Custom fonts have to be uploaded to the Figma team / org before the file can use them; substituting SF Pro silently produces a misleading design.
3. Mirror each distinct `.font(.custom(_))` call as its own named Figma text style (e.g. `Brand/Display Bold 17`) rather than as inline overrides on individual text nodes — consistent with the §6 rule that named styles beat raw font properties.

## 7. Modifier translation (only what's worth materializing)

Many SwiftUI modifiers should *not* survive translation as visual nodes — they're runtime concerns. Translate the visual ones, capture the design-intent ones as annotations, drop the purely-runtime ones, and model state as variants.

**Translate (visual).** `.padding(_)`, `.frame(width:height:)`, `.cornerRadius(_)`, `.background(_)`, `.foregroundStyle(_)`, `.font(_)`, `.fontWeight(_)`, `.shadow(_)`, `.opacity(_)`, `.overlay(_)`, `.clipShape(_)`, `.border(_)`. `.glassEffect()` → a Figma material effect (if the library has one), otherwise a frame with a `.regularMaterial`-style blur effect style.

**Capture as a Figma annotation.** Modifiers that carry design-relevant intent but have no visual representation become **annotations** on the node, categorized so the next design → code task can recover them. Use a category that matches the modifier's role:

| SwiftUI modifier | Annotation category | Annotation body |
|---|---|---|
| `.accessibilityLabel(_)`, `.accessibilityHint(_)`, `.accessibilityValue(_)`, `.accessibilityAddTraits(_)` | `Accessibility` | The exact label/hint/value/trait string |
| `.accessibilityIdentifier(_)` | `Accessibility` (or `Testing`) | The identifier |
| `GeometryReader`-driven layout / `PreferenceKey` plumbing that disappears in the static design | `Layout` | One-liner describing the intent (e.g. `"width tracks parent via GeometryReader; child widths derived"`) |

Annotations are the catch-all for "the view had behavior X that the static design can't show, but design → code on the next pass needs to know about." Prefer a small number of clear categories (`Accessibility`, `Layout`, `Behavior`, …) over free-form notes.

**Drop (purely runtime, no design intent).** `.onTapGesture { … }`, `.onAppear { … }`, `.task { … }`, `.environment(_)`, `.preferredColorScheme(_)` (model as a mode on the variable collection, not a property on the node), `.animation(_, value:)` (motion is not a static visual property — capture it via Code Connect, not on the static node).

**Translate carefully (model as a variant, not a property).** `.disabled(_)` is a *state* — model it as a component variant (`State=Disabled`), not as a top-level property of the instance. Same goes for `.isHidden(_)`, hover/pressed states, etc.

## 8. Loop back via Code Connect

Once the Figma component exists and the SwiftUI source is in the repo, set up a Code Connect mapping so the design and the code stay linked. See [`figma-code-connect`](../../figma-code-connect/SKILL.md) for the workflow. The mapping is what makes the *next* design → code task on the same file return correct SwiftUI snippets instead of generic React+Tailwind.

**Limit Code Connect to your project's custom components.** System SwiftUI controls (`Button`, `Toggle`, `Slider`, `Picker`, `Stepper`, `DatePicker`, `ProgressView`, `TextField`, `Label`, `NavigationStack`, `TabView`, `List`, `Form`, `Section`, etc.) already have first-party mappings shipped with the design context tool — overriding them with a project-local Code Connect template makes the design → code output worse, not better. If a SwiftUI source uses one of these, leave it to the built-in mapping and only Code Connect the custom wrappers around it.

## 9. What NOT to translate

These show up in SwiftUI sources but should be omitted or simplified when building the Figma design:

- **Preview providers** — `#Preview { … }` (iOS 17+ macro form) and the older `struct ContentView_Previews: PreviewProvider { … } { static var previews: some View { … } }` form (which is still everywhere in older codebases). Both are Xcode-only scaffolding with no Figma equivalent.
- **State plumbing** (`@State`, `@Binding`, `@Observable`, `@AppStorage`) — model the on-screen *values* (the rendered string, the selected enum case), not the binding itself.
- **Conditional rendering** (`if isLoading { ProgressView() } else { … }`) — render one state in the primary frame, model the others as variants or separate frames.
- **`GeometryReader` / `PreferenceKey` plumbing** — these solve responsive-layout problems that Figma's auto-layout solves natively. Don't materialize them as nodes.
- **`@ViewBuilder` helper functions** — inline the result at the call site in the Figma representation; don't mirror the function structure as nested frames.
- **`.task` / `.refreshable` / `.searchable` data-loading hooks** — model the resulting screen state (loaded, empty, loading spinner) as separate variants, not the hooks themselves.

## Output

Per [`figma-use`](../../figma-use/SKILL.md), every `use_figma` script must `return` all created/mutated node IDs and follow the incremental workflow (skeleton first, then fill, validate with `get_metadata` / screenshots between steps). For SwiftUI → Figma specifically:

1. **Inspect first.** Does the file already have the variables, text styles, and components implied by the SwiftUI source? Match what is there.
2. **Tokens before components.** If you are creating variables (per §4), do it before building any view that binds to them.
3. **Components before screens.** Translate each SwiftUI view into a Figma component before composing a screen from instances. Don't inline.
4. **One screen at a time.** Even for multi-screen flows, build one screen, take a screenshot, get sign-off, then move on. The same checkpoint discipline from [`figma-generate-design`](../../figma-generate-design/SKILL.md) and [`figma-generate-library`](../../figma-generate-library/SKILL.md) applies.
