# Choosing a component

Decision guide for components that look alike. Props, variants, and sizes come from the source files in `packages/ui/src`. "Consumers" means real usage in `packages/app`, `packages/session-ui`, and `packages/desktop`.

## Actions

| Need | Use | Import |
| --- | --- | --- |
| Action with a text label (with or without an icon) | `Button` | `@opencode/ui/button` |
| Action with only an icon | `IconButton` + `Tooltip` + `aria-label` | `@opencode/ui/icon-button` |
| One main action plus a menu of related alternatives ("Open" + "Open in…") | `SplitButton` + `SplitButtonAction` + `SplitButtonMenuTrigger`, with `Menu` on the trigger | `@opencode/ui/split-button` |
| Button that opens a menu | `Menu.Trigger as={Button}` or `as={IconButton}` | `@opencode/ui/menu` |

### Button

`src/actions/button/button.tsx`. Props: `variant`, `size`, `icon` (an `Icon` name, rendered before the label), plus Kobalte Button and native button props.

| `size` | Height | Inline padding | Radius |
| --- | --- | --- | --- |
| `small` | 24px | 9px | 4px |
| `normal` (default) | 28px | 11px | 6px |
| `large` | 32px | 15px | 6px |

| `variant` | Role | Consumer example |
| --- | --- | --- |
| `neutral` (default) | Secondary action on a raised surface. | Most dialog and settings actions. |
| `contrast` | Primary call to action. One per view or dialog. | "Continue" in `packages/app/src/providers/connect/dialog.tsx`. |
| `submit` | Composer submission only. Shares `src/actions/submit.css` with the contrast `IconButton`. | Composer send. |
| `danger` | Confirms a destructive action. Text in `--v2-state-fg-danger`. | Delete session dialog. |
| `warning` | Confirms a risky but recoverable action. Text in `--v2-state-fg-warning`. | — |
| `outline` | Low-emphasis action with a 1px inset border, no fill. | Mobile settings menu trigger. |
| `ghost` | Tertiary action, dialog "Cancel", toolbar action. | Dialog footers. |
| `ghost-muted` | Quiet toolbar or menu trigger with muted text and icon. | `Menu.Trigger as={Button}` in settings. |
| `ghost-faint` | Lowest-emphasis inline action. | Composer and queue panel. |
| `loading` | Non-interactive placeholder while an action runs. | — |

`variant="loading"` only sets `pointer-events: none` and a `--v2-background-bg-layer-02` surface. It does not set `disabled` or `aria-busy`; set them yourself so keyboard users cannot activate it.

### IconButton

`src/actions/icon-button/icon-button.tsx`. Props: `icon` (a JSX element, usually `<Icon name="…" />`), `variant`, `size`, `state` (`rest` | `hover` | `pressed`, forces a visual state for stories and previews).

| `size` | Box | Radius | Pairs with |
| --- | --- | --- | --- |
| `small` | 20×20 | 4px | Inline rows, list row actions |
| `normal` (default) | 24×24 | 6px | `Button size="small"` |
| `large` | 28×28 | 6px | `Button size="normal"`, `TextInput`, `Select`, titlebar actions |

Variants: `neutral` (default), `contrast` and `submit` (both use `submit.css`), `ghost`, `ghost-muted`. Consumers use `ghost-muted` most (23 of 31 uses). Use `Icon size="small"` (14px) inside `small`, default `Icon` (16px) inside `normal` and `large`.

## Overlays

| Need | Use | Notes |
| --- | --- | --- |
| Blocking task, confirmation, or form that needs focus | `Dialog` via `useDialog().show(...)` | Modal, scrim, focus trap, Escape closes the top dialog. |
| List of actions or choices from a trigger | `Menu` | Kobalte DropdownMenu: arrow keys, typeahead, Escape. |
| Same actions on right-click | `Menu.Context` | Kobalte ContextMenu with the same item parts. |
| Short label or shortcut hint on hover/focus | `Tooltip` | Not interactive. Not reachable on touch. |
| Rich, non-modal, interactive panel anchored to a trigger | No v2 component. Legacy `Popover` (`@opencode/ui/popover`) exists; consumers use `@kobalte/core/popover` directly with v2 tokens. | Prefer `Menu` when the content is actions or choices. |
| Preview on hover (no actions required) | No v2 component. Legacy `HoverCard` exists; the titlebar tab preview uses `@kobalte/core/hover-card` directly. | Keep the same content reachable another way. |

### Dialog

`src/overlays/dialog/dialog.tsx`. Parts: `Dialog`, `DialogHeader` (`closeLabel`, `hideClose`), `DialogTitle`, `DialogTitleGroup` (`title`, `description`), `DialogBody` (`class`), `DialogFooter`.

| `Dialog` prop | Values | Effect |
| --- | --- | --- |
| `size` | `normal` (480×368), `large` (640×480), `x-large` (`min(100vw - 32px, 980px)` × `min(100vh - 92px, 600px)`) | Fixed container size. |
| `fit` | boolean | Height follows content. Use for confirmations. |
| `variant` | `default`, `settings` | `settings` sets `data-variant="settings"`. |
| `preventBackdropDismiss` | boolean | A backdrop click does not close. Use for unsaved forms. |
| `onCloseAutoFocus` | Kobalte handler | Control where focus returns. |
| `class`, `containerClass`, `classList` | — | Layout only. |

- The close button label defaults to `ui.common.close`. Override with `closeLabel`.
- Put `autofocus` on the first field; `Dialog` focuses it on open instead of the first tabbable element.
- Footer: actions end-aligned with 8px gap, cancel (`ghost`) first, then the primary (`contrast`, `neutral`, or `danger`).
- Call `dialog.close()` from `useDialog()` to close programmatically.

### Menu

`src/navigation/menu/menu.tsx`. `Menu` props: Kobalte DropdownMenu props + `appearance` (`compact` default; `standard` is legacy). Parts: `Trigger`, `Portal`, `Content`, `Item`, `CheckboxItem`, `RadioGroup`, `RadioItem`, `Group`, `GroupLabel`, `Separator`, `Sub` (`placement`), `SubTrigger`, `SubContent`, `Context` (`Context.Trigger`, `Context.Portal`, `Context.Content`).

- `Item`, `CheckboxItem`, `RadioItem`, and `SubTrigger` accept `shortcut` (string or element, for example a `Keybind`) and `badge`.
- Always wrap `Menu.Content` in `Menu.Portal`.
- Use `Menu.RadioGroup` + `Menu.RadioItem` for a mode choice inside a menu, and `Menu.CheckboxItem` for toggles.
- Items are 28px tall with 4px radius; the content has 2px padding, 6px radius, `--v2-background-bg-layer-01`, and `--v2-elevation-floating`.

### Tooltip

`src/overlays/tooltip/tooltip.tsx`. Props: `value` (content, required), `appearance` (`compact` default; `large` for multi-line help; `standard` is legacy), `placement`, `inactive` (render children only), `forceOpen`, `triggerTabIndex`, `class` (trigger wrapper), `contentClass`, `contentStyle`.

- The trigger is a wrapping `div` with `display: flex` (`data-component="tooltip-v2-trigger"`). Add `class="shrink-0"` or similar for layout.
- Opens after 400ms; closes when the trigger is pressed or a nested menu opens.
- Content has `pointer-events: none`. Never put links or buttons in a tooltip.
- Show a shortcut by composing `value={<>{label}<Keybind keys={…} /></>}` (see `packages/app/src/shell/titlebar/titlebar.tsx`).

## Choosing one value

| Need | Use |
| --- | --- |
| 2–4 short, mutually exclusive view options, all visible (for example unified/split diff) | `SegmentedControl` + `SegmentedControlItem` |
| Switch between panels of content | `Tabs` |
| One value from a long or dynamic list, form-style | `Select` |
| One value from a few options that need descriptions | `RadioGroup` + `RadioItem` |
| A mode inside a menu of other actions | `Menu.RadioGroup` |
| On/off setting that applies at once | `Switch` |
| Selection that is submitted later, or many independent options | `Checkbox` |

- **SegmentedControl** (`src/navigation/segmented-control/segmented-control.tsx`): `value` (controlled, `string | null`), `defaultValue`, `onChange`, `allowDeselect`, `disabled`. Items: `value`, `children`. Renders `role="group"` with `aria-pressed` toggle buttons. Arrow keys (RTL-aware), Home, and End move focus. 28px tall. Add an `aria-label` to the group.
- **Tabs** (`src/navigation/tabs/tabs.tsx`): `variant` (`line`, `pill`, `settings` are v2; `panel` default, `underline`, `surface` are legacy), `orientation`. Parts: `List`, `Trigger` (`closeButton`, `hideCloseButton`, `onMiddleClick`, `subtext`, `classes`), `CloseButton`, `Content`, `SectionTitle`. Kobalte gives `tablist`/`tab`/`tabpanel` roles and arrow-key navigation.
- **Select** (`src/forms/select/select.tsx`): generic over the option type. `options`, `current`, `value` (key function), `label` (label function), `groupBy`, `onSelect`, `onHighlight`, `placeholder`, `invalid`, `numeric`, `children` (custom item render), `valueClass`, `contentClass`, plus Kobalte placement props. Trigger is 28px. Consumers pass `placement="bottom-end" gutter={6}`.
- **RadioGroup** (`src/forms/radio/radio.tsx`): `label`, `description`, `hideLabel`. `RadioItem`: `value`, `label` (required), `description`, `hideLabel`.
- **Switch** (`src/forms/switch/switch.tsx`): `children` (label), `description`, `hideLabel`, `appearance`. Without `children`, set `aria-label`.
- **Checkbox** (`src/forms/checkbox/checkbox.tsx`): `children` (label), `description`, `hideLabel`, `icon`.

## Text entry

| Need | Use |
| --- | --- |
| Single-line value (name, URL, search) | `TextInput` |
| Edit text in place inside a row or heading (rename) | `InlineInput` |
| Multi-line value | `Textarea` |
| Visible label, help text, info tooltip, or invalid state for any of the above | Wrap in `Field` |

- **TextInput** (`src/forms/text-input/text-input.tsx`): native input props + `appearance` (`base` 28px default, `large` 32px), `leadingIcon`, `showCopyButton`/`copyLabel`/`onCopyClick`, `showClearButton`/`clearLabel`/`clearIcon`/`onClearClick`, `numeric`, `invalid`. Copy and clear labels default to i18n keys.
- **InlineInput** (`src/forms/inline-input/inline-input.tsx`): bare `<input>` that inherits font and color; `width` prop. Use it where the input replaces text in place (`packages/app/src/home/sessions/view.tsx`).
- **Textarea** (`src/forms/textarea/textarea.tsx`): native textarea props + `invalid`; `rows` defaults to 3; minimum height 80px.
- **Field** (`src/forms/field/field.tsx`): `invalid`. Parts: `Field.Label` (`tooltip` adds an info button), `Field.Prefix` and `Field.Suffix` (help text, linked by `aria-describedby`), `Field.Control` (optional wrapper). `Field` sets the control `id`, `aria-labelledby`, and `aria-invalid` automatically for `TextInput`, `Textarea`, and `InlineInput`.
- Without `Field`, give the control an `aria-label` (as settings rows do).

## Feedback and status

| Need | Use |
| --- | --- |
| Result of a background or async action the user may not be looking at | `showToast(...)` |
| Error tied to a field | `Field invalid` + `Field.Suffix` text |
| Error or empty state for a pane or list | Inline text in the pane (legacy `Card variant="error"` in session-ui) |
| Toast that needs a decision | `showToast({ persistent: true, actions: [...] })` |
| Indeterminate wait, icon-sized | `Loader` (16px ring) |
| Indeterminate wait with a label ("Working…") | `TextShimmer text={…} active` |
| Determinate progress, compact | `ProgressCircle percentage={…}` |

- **Toast** (`src/feedback/toast/toast.tsx`): `showToast(options | string)` with `title`, `description`, `icon`, `variant` (`default`, `success`, `error`, `loading`), `duration`, `persistent`, `actions` (`label`, `variant` `primary`/`secondary`, `onClick` function or `"dismiss"`). Identical toasts are de-duplicated and pulse. `toaster.show(render, options)` renders a custom toast. Mount `Toast.Region` once per app (the app does it in `packages/app/src/shell/shell.tsx`; app code calls the wrapper in `packages/app/src/shell/notifications/toast.tsx`, which takes an icon name). Do not put the only copy of critical information in a toast.
- **Loader** (`src/feedback/loader/loader.tsx`): SVG props; 16×16 default; `aria-hidden="true"` by default. Put an accessible status text next to it.
- **Spinner** (legacy, `src/components/spinner.tsx`): animated pixel grid, sized by `class` (`size-4`). Consumers still use it for row-level loading. Prefer `Loader` in new UI.
- **ProgressCircle** (`src/feedback/progress-circle/progress-circle.tsx`): `percentage` (0–100), `appearance` (`compact` 14px default, `indicator` 16px), `size`, `strokeWidth`.
- **TextShimmer** (`src/typography/text-shimmer/text-shimmer.tsx`): `text`, `active`, `as`, `offset`, `class`. Inherits typography from its parent.

## Labels and metadata

| Need | Use |
| --- | --- |
| Status or metadata label ("Beta", a count, a type) | `Badge` (`variant` `neutral` or `accent`; 16px tall, 11px text) |
| Keyboard shortcut | `Keybind keys={["⌘", "K"]}` (`variant` `neutral` or `ghost`) |
| Shortcut inside a menu item | `Menu.Item shortcut={…}` |
| Added/removed line counts | `DiffChanges` |
| Person or org image/initial | `Avatar` (`size` `small` 16px, `normal` 20px, `large` 28px default; `kind` `user`/`org`) |
| Project identity | `ProjectAvatar` |

Never use `Badge` to show a shortcut, and never use `Keybind` for status. Do not convey status by color alone; the badge text must carry the meaning.

## Disclosure

| Need | Use |
| --- | --- |
| Several collapsible sections | `Accordion` (`src/data-display/accordion`) |
| One collapsible region (tool output, details) | Legacy `Collapsible` (`variant` `normal` or `ghost`) |
| Section header that sticks while its content scrolls | Legacy `StickyAccordionHeader` |

## Separators and containers

- `Divider` (`@opencode/ui/divider`): horizontal hairline (`role="separator"`). Inside menus use `Menu.Separator`.
- `ScrollView` (`@opencode/ui/scroll-view`): every custom scroll area. See `opencode-ui-layout`.
- `ResizeHandle` (`@opencode/ui/resize-handle`): resizable panes. See `opencode-ui-layout`.
