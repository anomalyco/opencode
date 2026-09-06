# Choosing fonts

Choosing a typeface, the right file format and why fonts look the way they do.

## Choosing a typeface

Font families set the tone before the specific font does.

| Category | Traits | Use for |
| --- | --- | --- |
| Serif | Small strokes at the ends of letters guide the eye along a line | Long passages, editorial reading |
| Sans-serif | Clean, even shapes that stay crisp at small sizes | Default for most interfaces (Helvetica, Inter, Geist) |
| Monospace | Every glyph the same width so columns line up | Code, tables, tabular data |
| Display | Drawn for large headlines | Marketing headlines, hero text |
| Script | Mimics handwriting | Rare, decorative moments |

CSS exposes `cursive` and `fantasy` keywords for the last two categories.

"Display" in a font's name does not make it a display font. SF Pro and Heldane ship a `Display` variant for large sizes and a `Text` variant for small ones. Use the variant matching the size you are setting.

### Rules

- Fewer fonts is usually better. Rarely use more than three. Marketing pages can be more expressive than apps.
- The same applies to sizes and weights. They define hierarchy, and overusing them hurts readability fast.
- Pair for contrast, not similarity. A serif headline over a sans body reads as a deliberate display and reading split; two near-identical sans-serifs read as a mistake.
- Thin weights are display-only. Below `18px` stay at weight `400`+, because Ultralight, Thin and Light (`100`–`300`) strokes disappear at text sizes and on low-DPI screens. Reserve them for `28px`+ display text, and check even there that they hold against the background.

## Font family scope

Applying or reviewing typography never requires a new typeface. Use the product's type system unless the task asks for a type change, and never introduce a paid or proprietary face to satisfy a checklist. Rendering details such as font smoothing, wrapping and tabular numbers do not override the project's font family.

When a type change is asked for, two routes. The system stack gives a native macOS and iOS feel. A commercial face such as Helvetica Now is a brand decision and still needs a fallback stack.

```css
/* System-native macOS/iOS feel */
html {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

/* Commercial brand face with safe fallbacks */
html {
  font-family: "Helvetica Now", "Helvetica Neue", Arial, sans-serif;
}
```

## Formats

| Format | Notes |
| --- | --- |
| `.woff2` | Brotli compression, broadly supported. Use this on the web. |
| `.woff` | Older compression. Fallback only for very old browsers. |
| `.ttf` / `.otf` | Raw formats, no web compression, larger files. Desktop only unless there is no other option. |

## Anatomy of a typeface

| Term | Meaning |
| --- | --- |
| x-height | Height of a lowercase `x` |
| Cap height | Height of uppercase letters |
| Baseline | The invisible line letters sit on |
| Ascender | Part of a letter rising above the x-height |
| Descender | Part dropping below the baseline |

These measurements are why two fonts at the same `font-size` look like different sizes. A large x-height looks bigger.
