# RTL reference

## How direction flows

1. `packages/app/src/runtime/i18n/language.tsx` computes `direction()` from the locale, or from a `setDirection(...)` override, and writes it to `document.documentElement.dir` and `lang`.
2. `UiI18nBridge` passes `layoutLocale` to the `@opencode/ui` `I18nProvider`. When the direction is overridden, `layoutLocale` is `"ar"` for RTL or `"en"` for LTR, because Kobalte derives menu direction from its locale and has no direction prop.
3. `I18nProvider` (`packages/ui/src/context/i18n.tsx`) wraps Kobalte's `I18nProvider` with `layoutLocale ?? locale`, so portaled menus, selects, and popovers open on the correct side.
4. CSS reads direction with logical properties and `:dir(rtl)`. JavaScript reads it with `getComputedStyle(el).direction` or Kobalte's `useLocale()`.

In a consumer project outside this monorepo, pass `locale`, `layoutLocale` (optional), `t`, `plural`, and optionally `pluralForm` to `I18nProvider`, and set `dir` on the document yourself.

## Existing RTL handling in @opencode/ui

| Behavior                                        | Where                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Directional icons mirror                        | `src/icons/icon/icon.css` (`:dir(rtl) [data-slot="icon-svg"][data-directional]`), `src/icons/icon/icon.tsx` |
| Submenu chevron mirrors                         | `src/navigation/menu/menu.css`                                                                              |
| Switch thumb travels inline-end                 | `src/forms/switch/switch.css`                                                                               |
| Segmented control ArrowLeft/ArrowRight swap     | `src/navigation/segmented-control/segmented-control.tsx`                                                    |
| Resize handle delta                             | `src/components/resize-handle.tsx`                                                                          |
| Horizontal scroll thumb (negative `scrollLeft`) | `src/components/scroll-view.tsx`                                                                            |
| File tree chevrons and change markers           | `src/styles/file-tree.css`                                                                                  |

## Mirroring

- Mirror: back/forward, previous/next, disclosure chevrons, indentation, directional progress.
- Do not mirror: brands and logos, clocks, media controls, charts, check marks, text, code.
- Reverse explicitly: physical `linear-gradient(90deg, …)`, `translateX`, SVG transforms, and animation deltas.

## Interaction

- `clientX` stays physical. A drag on a logical edge needs an RTL-aware delta.
- Logical previous/next keyboard controls may swap ArrowLeft and ArrowRight. Follow the WAI-ARIA pattern for the widget.
- RTL `scrollLeft` can start at `0` and become negative. Prefer `scrollIntoView({ inline: "nearest" })` or a tested direction-normalizing helper.

## Electron title bars

- Prefer native caption controls. Use `titleBarOverlay` and `env(titlebar-area-*)` for the safe content rectangle.
- Keep Windows and macOS native-control avoidance and `trafficLightPosition` physical. Keep app navigation inside that rectangle logical.
- Mark interactive title bar children `app-region: no-drag`.

## Verify behavior

Do not rely on screenshots alone. Check computed styles, pseudo-element geometry, hit zones, focus order, keyboard behavior, submenu direction, zoom and scaling, and both LTR and RTL scroll endpoints.

## Test matrix

- English + LTR
- English + forced RTL (Storybook `direction` global set to `rtl`, or a story with `globals: { direction: "rtl" }` as in `packages/app/src/session/session-screen.stories.tsx`)
- A real RTL locale (`ar`, `he`, `fa`, `ur`) + RTL (Storybook `locale` global)
- Mixed RTL/LTR content, long labels, numbers, code, and paths
- Keyboard, pointer resize, scrolling, menus and submenus, and Electron title bar controls in both directions

## Sources

- [RTL Styling 101, Ahmad Shadeed](https://rtlstyling.com/posts/rtl-styling/)
- [W3C: Structural markup and right-to-left text](https://www.w3.org/International/questions/qa-html-dir)
- [W3C: Inline bidirectional markup](https://www.w3.org/International/articles/inline-bidi-markup/)
- [MDN: CSS logical properties and values](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Logical_properties_and_values)
- [MDN: `scrollLeft`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollLeft)
- [Electron: Custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- [WAI-ARIA: Window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
- [Kobalte: I18n Provider](https://kobalte.dev/docs/core/components/i18n-provider/)
