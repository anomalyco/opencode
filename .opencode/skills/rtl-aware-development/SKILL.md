---
name: rtl-aware-development
description: OpenCode Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.
---

# RTL-Aware Development

Treat direction as independent from language. Test English in both directions as well as real RTL and mixed-script content.

## Guidelines

- Set `lang` and `dir` on the document, and propagate direction through component providers used by portaled menus and popovers. Do not change the selected locale merely to force RTL.
- Keep DOM and focus order semantic. Flexbox and Grid already follow `dir`; do not add `row-reverse`, CSS `order`, or reversed markup just to mirror a layout.
- Prefer logical CSS for semantic layout. Reserve physical coordinates for pointer positions, canvas geometry, native window controls, and other genuinely physical placement.

```css
/* Avoid */
padding-left: 12px;
right: 0;
border-right: 1px solid;
text-align: left;

/* Prefer */
padding-inline-start: 12px;
inset-inline-end: 0;
border-inline-end: 1px solid;
text-align: start;
```

- Isolate mixed-direction text. Use `dir="auto"` or `<bdi>` for unknown text; keep code, URLs, IDs, and filesystem paths LTR without forcing the surrounding component LTR.

```html
<span class="file-row"><bdi dir="auto">README.md</bdi></span> <bdi dir="ltr"><code>C:\src\app.ts</code></bdi>
```

- Mirror directional meaning, not every image. Back/forward, previous/next, disclosure, indentation, and directional progress may need mirroring. Do not mirror brands, clocks, media controls, charts, or text. Reverse physical gradients, `translateX`, SVG transforms, and animation deltas explicitly.
- Map interactions through direction. `clientX` remains physical; resizing a logical edge needs an RTL-aware delta. Logical previous/next keyboard controls may swap ArrowLeft/ArrowRight. Follow the relevant WAI-ARIA widget pattern.
- Do not assume LTR scrolling. RTL `scrollLeft` can start at `0` and become negative. Prefer `scrollIntoView({ inline: "nearest" })` or a tested direction-normalizing helper.
- For Electron title bars, prefer native caption controls and use `titleBarOverlay` plus `env(titlebar-area-*)` for the safe content rectangle. Keep Windows/macOS native-control avoidance and `trafficLightPosition` physical; keep app navigation inside that rectangle logical. Mark interactive titlebar children `app-region: no-drag`.
- Verify behavior, not screenshots alone. Check computed styles, pseudo-element geometry, hit zones, focus order, keyboard behavior, submenu direction, zoom/scaling, and both LTR and RTL scroll endpoints.

## Test Matrix

- English + LTR
- English + forced RTL
- A real RTL locale + RTL
- Mixed RTL/LTR content, long labels, numbers, code, and paths
- Keyboard, pointer resize, scrolling, menus/submenus, and Electron titlebar controls in both directions

## References

- [RTL Styling 101, Ahmad Shadeed](https://rtlstyling.com/posts/rtl-styling/)
- [CSS-Tricks: RTL Styling 101](https://css-tricks.com/rtl-styling-101/)
- [CSS-Tricks: CSS Logical Properties and Values](https://css-tricks.com/css-logical-properties-and-values/)
- [W3C: Structural markup and right-to-left text](https://www.w3.org/International/questions/qa-html-dir)
- [W3C: Inline bidirectional markup](https://www.w3.org/International/articles/inline-bidi-markup/)
- [MDN: CSS logical properties and values](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Logical_properties_and_values)
- [MDN: `dir`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/dir)
- [MDN: `scrollLeft`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollLeft)
- [web.dev: Logical properties](https://web.dev/learn/css/logical-properties/)
- [Electron: Custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- [WAI-ARIA: Window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
- [Kobalte: I18n Provider](https://kobalte.dev/docs/core/components/i18n-provider/)
