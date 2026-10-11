---
name: OpenCode UI Components
description: Use when you choose, compose, extend, or create an @opencode/ui component (buttons, dialogs, menus, tooltips, inputs, selects, tabs, toasts, loaders, badges), or when you replace a legacy `src/components` component with its v2 equivalent.
---

# OpenCode UI Components

> Design rules in this skill come from the design system owner. Fix facts (paths, prop names, token names) directly. To change a rule, record design feedback with `/design-feedback`.

Paths are relative to `packages/ui`. Every subpath export, its source file, and its `data-component` value are listed in the generated inventory [references/components.md](references/components.md). The decision guide for similar components ("Button or IconButton?", "Dialog or Popover?") is in [references/choosing.md](references/choosing.md).

## Two generations of components

| Generation | Location | CSS loading | Use |
| --- | --- | --- | --- |
| **v2** | `src/{actions,data-display,feedback,forms,icons,layout,navigation,overlays,typography}/<name>/` | The `.tsx` imports `./<name>.css`. The CSS is **not** in a cascade layer. | Preferred for all new UI. |
| **Legacy** | `src/components/*.tsx` | Loaded by `src/styles/index.css` in `@layer components`. | Only when no v2 equivalent exists. |

Some v2 components keep a legacy look behind a prop: `appearance="standard"` on `Menu`, `Tooltip`, `Badge`, `Switch`, and `DiffChanges`, and `variant="panel" | "underline" | "surface"` on `Tabs`, render with legacy v1 tokens. The defaults (`appearance="compact"`; `Tabs` `variant="line" | "pill" | "settings"`) are the v2 look.

## Legacy → v2

| Legacy import | v2 replacement | Note |
| --- | --- | --- |
| `@opencode/ui/context-menu` (`ContextMenu`) | `Menu.Context` from `@opencode/ui/menu` | Same item parts as `Menu` (`Menu.Item`, `Menu.Separator`, …). |
| `@opencode/ui/text-field` (`TextField`) | `TextInput` or `Textarea`, wrapped in `Field` | `Field` gives the label and help text that `TextField` had built in. |
| `@opencode/ui/spinner` (`Spinner`) | `Loader` from `@opencode/ui/loader` | `Spinner` is still used in app lists; see choosing.md. |
| `@opencode/ui/progress` (`Progress`, linear bar) | `ProgressCircle` from `@opencode/ui/progress-circle` | Only for compact determinate progress. No v2 linear bar exists. |
| `Tabs` `variant="panel" \| "underline" \| "surface"` | `Tabs` `variant="line" \| "pill" \| "settings"` | Same component, different `data-component` (`tabs` vs `tabs-v2`). |
| `appearance="standard"` | omit `appearance` (defaults to `compact`) | `Menu`, `Tooltip`, `Badge`, `Switch`, `DiffChanges`. |

No v2 equivalent exists yet for `Popover`, `HoverCard`, `Card`, `Collapsible`, `List`, `ScrollView`, `ResizeHandle`, `DockShell`/`DockTray`, `FileIcon`, `ProviderIcon`, `AppIcon`, `ImagePreview`, `TextReveal`, `Typewriter`, or `StickyAccordionHeader`. Use the legacy component from `@opencode/ui/<file-name>`.

## Rules

1. Use a v2 category component when one exists. Do not import the legacy equivalent from the table above in new code.
   **Why:** Legacy components use v1 tokens that do not follow v2 themes.
2. Do not use `appearance="standard"` or the legacy `Tabs` variants in new UI.
   **Why:** They render with legacy tokens and will be removed.
3. Give every icon-only control an accessible name: `aria-label` on `IconButton`, `SplitButtonAction`, and `SplitButtonMenuTrigger`, from an i18n key. Wrap the control in a `Tooltip` with the same text.
   **Why:** `IconButton` renders only its `icon` element and adds no label.
4. Give every form control a label. Use `children` (`Switch`, `Checkbox`), `label` (`RadioGroup`, `RadioItem`), `Field.Label`, or `aria-label`. Use `hideLabel` to hide a visible label but keep it for assistive technology.
   **Why:** A Kobalte control without a `Label` part has no accessible name.
5. Open dialogs with `useDialog().show(() => <Dialog>…</Dialog>)` from `@opencode/ui/context/dialog`. Give each dialog a `DialogTitle` or `DialogTitleGroup`. Put `autofocus` on the element that must receive first focus.
   **Why:** The provider owns the stack, Escape handling, and the exit animation; Kobalte traps focus and uses the title as the accessible name.
6. Use `Menu.Trigger as={Button}` or `as={IconButton}` for menu triggers. Do not put a `Button` inside `Menu.Trigger`.
   **Why:** Nested buttons are invalid HTML, and `as` keeps Kobalte's `aria-expanded` and keyboard handling on one element.
7. Pick variants by role, not by color: one `contrast` primary action per view or dialog, `neutral` for secondary actions, `ghost` for cancel and toolbar actions, `danger` only for destructive confirmation, `submit` only for Composer submission.
   **Why:** The variant set encodes emphasis; color-picking breaks the hierarchy.
8. Size controls in one row to the same height: `Button size="small"` (24px) with `IconButton size="normal"` (24px); `Button size="normal"` (28px) with `IconButton size="large"` (28px), `TextInput`, `Select`, and `SegmentedControl` (28px).
   **Why:** `Button` and `IconButton` size names map to different heights.
9. Use `class` and `classList` on a component only for layout (width, flex, alignment, margin from a parent). Do not change its color, height, padding, radius, or shadow from consumer code.
   **Why:** v2 component CSS is unlayered, so Tailwind utilities do not win against it, and per-screen overrides drift from the design.
10. To add a visual option, add a value to the `variant`/`size`/`appearance` union in the component `.tsx` and a `[data-component="…"][data-variant="…"]` block in its `.css` in `packages/ui`, with a story. Do not restyle `[data-component="…"]` or `[data-slot="…"]` from a consumer stylesheet unless the component documents that hook.
    **Why:** One owner per selector keeps themes, RTL, and focus states correct everywhere.
11. Compose existing components before you write new markup: `Tooltip` + `IconButton`, `Menu` + `Button`, `Field` + `TextInput`, `Dialog` + `DialogFooter` + `Button`.
    **Why:** Composition inherits keyboard, focus, and theme behavior for free.
12. Create new design-system components only in a v2 category folder. Follow [Add a component](#add-a-component).
    **Why:** `src/components` is legacy and has no per-component CSS import.

## Do / Don't

```tsx
// Do: icon-only action with a name and a tooltip (packages/app/src/home/projects/view.tsx)
<Tooltip placement="bottom" value={language.t("home.project.add")}>
  <IconButton variant="ghost-muted" size="large" icon={<Icon name="folder-add-left" />}
    aria-label={language.t("home.project.add")} onClick={add} />
</Tooltip>

// Don't: no name, no tooltip
<IconButton icon={<Icon name="folder-add-left" />} onClick={add} />
```

```tsx
// Do: menu trigger rendered as the button (packages/app/src/settings/workspaces/workspaces.tsx)
<Menu placement="bottom-end" gutter={4}>
  <Menu.Trigger as={IconButton} variant="ghost-muted" size="small"
    aria-label={language.t("common.moreOptions")} icon={<Icon name="outline-dots" size="small" />} />
  <Menu.Portal>
    <Menu.Content>
      <Menu.Item onSelect={remove}>{language.t("settings.workspaces.deleteAll")}</Menu.Item>
    </Menu.Content>
  </Menu.Portal>
</Menu>

// Don't: a button nested in the trigger
<Menu.Trigger><Button>…</Button></Menu.Trigger>
```

```tsx
// Do: confirmation dialog (packages/app/src/home/sessions/controller.tsx)
<Dialog fit>
  <DialogHeader hideClose>
    <DialogTitleGroup title={language.t("session.delete.title")} description={…} />
  </DialogHeader>
  <DialogFooter>
    <Button variant="ghost" onClick={() => dialog.close()}>{language.t("common.cancel")}</Button>
    <Button variant="danger" onClick={confirm}>{language.t("session.delete.button")}</Button>
  </DialogFooter>
</Dialog>
```

```css
/* Do: new variant inside packages/ui/src/actions/button/button.css */
[data-component="button-v2"][data-variant="new-role"] { background-color: var(--v2-background-bg-layer-02); }

/* Don't: restyle a component from app CSS */
.my-screen [data-component="button-v2"] { height: 30px; border-radius: 8px; }
```

## Add a component

1. Pick the category folder and create `src/<category>/<name>/<name>.tsx`, `<name>.css`, and `<name>.stories.tsx`.
2. In the `.tsx`: build on a Kobalte primitive for anything interactive. Use `splitProps`, forward the rest props, and set `data-component="<name>-v2"`, `data-variant`/`data-size` with defaults, and the `classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}` merge that every v2 component uses. Import `./<name>.css`. Export the props interface.
3. In the `.css`: select only on `data-component`, `data-slot`, `data-variant`, `data-size`, `data-state`, and Kobalte state attributes. Use v2 tokens, logical properties, and the shared line-height tokens. Use the shared focus ring `outline: 2px solid var(--v2-border-border-focus)`, hover/pressed through `:is(:hover, [data-state="hover"])`, and `opacity: 0.5` for disabled.
4. For default user-visible text (close, copy, clear labels), call `useI18n()` from `../../context/i18n`, add an English `ui.<area>.<key>` entry to `src/i18n/en.ts` only, and expose a prop that overrides it (for example `closeLabel`, `copyLabel`). See `opencode-ui-i18n-rtl`.
5. In the story: `title: "UI/<Name>"`, `id: "ui-<name>"`, `tags: ["autodocs"]`, and a docs string with Overview, API, Variants and states, Behavior, Accessibility, and Theming sections (copy `src/data-display/badge/badge.stories.tsx`). Show every variant and size.
6. Add `"./<name>": "./src/<category>/<name>/<name>.tsx"` to `exports` in `packages/ui/package.json`, above the `"./*"` wildcard. Then run `bun script/generate-skill-references.ts` from `packages/ui` to refresh `references/components.md`.
7. Run `bun run --cwd packages/ui lint:design <files>` and `bun --cwd packages/ui typecheck`. Check the story in light, dark, and RTL.

## Checklist

- [ ] I used the v2 component, not a legacy equivalent, and no `appearance="standard"`.
- [ ] I checked [references/choosing.md](references/choosing.md) for the right component and variant.
- [ ] Icon-only controls have an i18n `aria-label` and a `Tooltip`.
- [ ] Form controls have a label (visible or `hideLabel`).
- [ ] Controls in one row have the same height.
- [ ] Consumer `class` sets layout only; new looks are `data-variant` values in `packages/ui`.
- [ ] A new component has `.tsx`, `.css`, `.stories.tsx`, an export, English i18n defaults, and a refreshed `components.md`.

## Enforced by

- Component CSS: `design/no-raw-color`, `design/no-legacy-token`, `design/no-solid-line-height`, `design/dark-mode-selector`, `design/no-physical-direction` (`bun run --cwd packages/ui lint:design <files>`).
- Component choice, variants, accessibility, and consumer overrides: review only.
