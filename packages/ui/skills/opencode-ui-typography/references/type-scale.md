# OpenCode UI type scale

This table records the text styles that the v2 components in `packages/ui/src` actually use. Sizes, weights, and tracking are literal values in the component CSS; only the families and line heights have tokens. When you need a style, copy the row for its role.

## Roles

| Role                                                   | Family                  | Size | Weight                      | Line height                                                    | Tracking | Extra                                                                  | Examples                                                                                                              |
| ------------------------------------------------------ | ----------------------- | ---- | --------------------------- | -------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Body, single line (rows, menus, inputs, tabs, selects) | `--v2-font-family-sans` | 13px | 440                         | `--line-height-compact` (16px)                                 | -0.04px  |                                                                        | `menu-v2-item-content`, `text-input-v2-input`, `select-v2-value-text`, `tabs-v2-trigger`, `segmented-control-v2-item` |
| Body, multi-line (descriptions, messages)              | `--v2-font-family-sans` | 13px | 440                         | `--line-height-base` (20px)                                    | -0.04px  |                                                                        | `toast-v2-description`, dialog description (`dialog.css`)                                                             |
| Label / emphasis                                       | `--v2-font-family-sans` | 13px | 530                         | `--line-height-compact` (16px)                                 | -0.04px  |                                                                        | `field-v2-label`, `line-comment-v2-label`, dialog header title (compact)                                              |
| Button text                                            | `--v2-font-family-sans` | 13px | 530 (440 for `ghost-muted`) | 20px                                                           | -0.04px  | `tabular-nums`                                                         | `button-v2`, `toast-v2-title`, toast actions                                                                          |
| Caption / meta (sentence case)                         | `--v2-font-family-sans` | 11px | 440                         | `--line-height-compact` (16px) or `--line-height-tight` (12px) | 0.05px   |                                                                        | `switch-label`, `radio-v2-description`                                                                                |
| Caption / meta (emphasis, caps)                        | `--v2-font-family-sans` | 11px | 530                         | `--line-height-tight` (12px)                                   | 0.05px   | `tabular-nums`; `text-transform: uppercase` for keycaps, avatars, tags | `tooltip-v2`, `line-comment-v2-meta`, `menu-v2-group-label`, `keybind-v2-label`, `tag`                                |
| Heading (dialog title)                                 | `--v2-font-family-sans` | 15px | 530                         | `--line-height-base` (20px)                                    | -0.13px  |                                                                        | `dialog.css` header title, `packages/app/src/providers/connect/dialog.tsx`                                            |
| Display                                                | `--v2-font-family-sans` | 20px | 530                         | 28px (`leading-7`)                                             | -0.3px   |                                                                        | `packages/app/src/providers/connect/chatgpt-welcome.tsx`                                                              |
| Code / shell                                           | `--v2-font-family-code` | 13px | 440                         | `--line-height-base` (20px)                                    | -0.04px  |                                                                        | `bash-pre code` in `packages/session-ui/src/components/message-part.css`                                              |

The app body sets the default text style: `font-(family-name:--font-family-text) text-[13px] font-[440]` on `<body>` in `packages/app/index.html`. The Storybook preview applies the same classes.

## Line-height tokens

| Token                          | Tailwind                            | Use for                                              |
| ------------------------------ | ----------------------------------- | ---------------------------------------------------- |
| `--line-height-tight` (12px)   | `leading-text-tight`                | 11px captions and meta in a fixed-height chip or row |
| `--line-height-compact` (16px) | `leading-text-compact`, `leading-4` | 13px single-line text; 11px sentence-case captions   |
| `--line-height-base` (20px)    | `leading-text-base`, `leading-5`    | 13px multi-line text, buttons, code, 15px headings   |

## Tailwind equivalents

Tailwind in this repo resets the default theme (`--*: initial` in `src/styles/tailwind/index.css`). Only the utilities that `@theme` defines exist. Use arbitrary values for v2 type:

```html
<span class="text-[13px] font-[440] leading-text-compact tracking-[-0.04px]">Row</span>
<span class="text-[11px] font-[530] leading-text-tight tracking-[0.05px] tabular-nums uppercase">Esc</span>
```

`text-xs`, `text-11-regular`, `text-13-regular`, and `text-13-medium` have no definition in this Tailwind theme, so they produce no CSS. Do not use them.

## Legacy scale (do not use for v2)

`src/styles/theme.css` and `src/styles/utilities.css` keep the older scale for `data-appearance="standard"` styles: `--font-size-small: 13px`, `--font-size-base: 14px`, `--font-size-large: 16px`, `--font-size-x-large: 20px`, `--font-weight-regular: 400`, `--font-weight-medium: 500`, `--font-weight-bold: 670`, `--line-height-normal: 130%`, `--line-height-large: 150%`, `--line-height-x-large: 180%`, and the classes `.text-12-regular`, `.text-12-medium`, `.text-12-mono`, `.text-14-regular`, `.text-14-medium`, `.text-14-mono`, `.text-16-medium`, `.text-20-medium`.

## Truncation helpers

- `truncate` (Tailwind) or the explicit four declarations: `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`.
- `.truncate-start` (`src/styles/utilities.css`, also a Tailwind `@utility`) cuts text at the start, which keeps the end of a path visible. It sets `direction: rtl` and the physical `text-align: left`. Test it with paths that start or end with punctuation; if punctuation moves, wrap the text in `<bdi dir="ltr">`.
