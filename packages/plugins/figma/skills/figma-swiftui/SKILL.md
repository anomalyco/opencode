---
name: figma-swiftui
description: "SwiftUI ↔ Figma translation. Use whenever the user mentions Swift, SwiftUI, iOS, iPhone, or iPad — in EITHER direction — translating a Figma design into SwiftUI (design → code), or pushing SwiftUI views / screens / tokens back into a Figma file (code → design). Triggers on phrases like 'implement this Figma design in SwiftUI', 'build this screen in Swift', 'push this SwiftUI view to Figma', 'mirror my Swift code in a Figma file', or whenever a Figma URL appears alongside `.swift` files / an `.xcodeproj`. Routes to a direction-specific reference doc; loads alongside `figma-use` for the code → design path."
disable-model-invocation: false
---

# Figma ↔ SwiftUI

Translation between Figma designs and SwiftUI code, both directions. This file is a router — actual guidance lives in the references below.

## Pick the direction

| Direction | Trigger | Reference |
|---|---|---|
| **Design → code** | User wants SwiftUI in their iOS project from a Figma file/frame | [references/design-to-code.md](references/design-to-code.md) |
| **Code → design** | User wants to push SwiftUI views / screens / tokens into a Figma file | [references/code-to-design.md](references/code-to-design.md) |

If the request is ambiguous — a Figma URL and `.swift` files both present, no verb makes it clear — ask the user which direction before loading a reference.

## Shared context (applies to both directions)

These points hold regardless of direction; the direction-specific references assume them.

1. **`get_design_context` is the read tool for Figma.** Pass `clientLanguages: "swift"` and `clientFrameworks: "swiftui"` so the response is framed as Swift. URL → tool args: `figma.com/design/:fileKey/:fileName?node-id=:nodeId` → use `fileKey`, replace `-` with `:` in `nodeId`. For `figma.com/design/:fileKey/branch/:branchKey/:fileName`, use `branchKey` as `fileKey`.
2. **The React+Tailwind in `get_design_context` output is a structural reference, not a literal source.** It approximates the visual. Never transliterate `position: absolute` / pixel frames / `mix-blend-mode` stacks into SwiftUI or into Figma — the screenshot is the source of truth in both directions.
3. **iOS HIG semantic colors are tokens, not hex.** `var(--backgrounds/primary, …)`, `var(--labels/secondary, …)`, `var(--separators/non-opaque, …)` etc. map to `Color(.systemBackground)`, `Color.secondary`, `Color(.separator)` in SwiftUI, and to variables in a semantic collection in Figma. Keep the mapping; drop the literal RGBA.
4. **SF Symbols round-trip by name in both directions — never by codepoint.** Design → code: `get_design_context` substitutes Figma's SF Symbol glyph runs back into `<SFSymbol>{Image(systemName: "...")}</SFSymbol>` wrappers in the response. Use those names verbatim. Code → design: call `figma.util.getSfSymbolCharacter(name)` inside `use_figma` to convert a symbol name to the matching character — never look up codepoints by hand.
5. **Recognize the underlying iOS pattern, not the literal node / view name.** The same patterns recur in both directions: large title + back chevron + trailing action = `NavigationStack` chrome; bottom row of icon+label pairs = `TabView`; repeating same-height rows with leading/trailing chrome = `List`. Match those system patterns rather than rebuilding them from primitives.
6. **For code → design, `use_figma` is the API.** Always load [`figma-use`](../figma-use/SKILL.md) before any `use_figma` call. If the task involves building a full screen, also load [`figma-generate-design`](../figma-generate-design/SKILL.md); if it involves building components or a design system, also load [`figma-generate-library`](../figma-generate-library/SKILL.md).

## References

| Doc | When to load |
|---|---|
| [references/design-to-code.md](references/design-to-code.md) | Translating a Figma design / frame into SwiftUI |
| [references/code-to-design.md](references/code-to-design.md) | Pushing SwiftUI views / screens / tokens into Figma |
