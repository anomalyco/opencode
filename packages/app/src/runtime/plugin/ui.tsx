import { children, For, Show } from "solid-js"
import type { Ui, UiMenuItem } from "@opencode/plugin/gui"
import { Markdown } from "@opencode/session-ui/markdown"
import { MarkdownProvider } from "@opencode/session-ui/context/markdown"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Loader } from "@opencode/ui/loader"
import { Menu } from "@opencode/ui/menu"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"

const loaderSize = { small: 14, normal: 16, large: 20 }

/**
 * `Ui`: the app's components behind the SDK's small, stable props. Each maps those props onto the real component, so
 * a plugin renders exactly what the app renders. The components keep no state of their own.
 */
export const ui: Ui = {
  Icon: (props) => <Icon name={props.name} size={props.size} class={props.class} />,
  Button: (props) => (
    <Button
      type={props.type ?? "button"}
      variant={props.variant}
      size={props.size}
      icon={props.busy ? undefined : props.icon}
      disabled={props.disabled || props.busy}
      aria-busy={props.busy || undefined}
      autofocus={props.autofocus}
      class={props.class}
      onClick={(event: MouseEvent) => props.onClick?.(event)}
    >
      <Show when={props.busy}>
        <Loader width={14} height={14} />
      </Show>
      {props.children}
    </Button>
  ),
  IconButton: (props) => (
    <IconButton
      type="button"
      variant={props.variant ?? "ghost-muted"}
      size={props.size}
      disabled={props.disabled || props.busy}
      state={props.pressed ? "pressed" : undefined}
      aria-label={props.label}
      aria-pressed={props.pressed}
      aria-busy={props.busy || undefined}
      class={props.class}
      onClick={(event) => props.onClick?.(event)}
      icon={
        <Show when={props.busy} fallback={<Icon name={props.icon} />}>
          <Loader />
        </Show>
      }
    />
  ),
  Tooltip: (props) => (
    <Tooltip
      placement={props.placement ?? "top"}
      value={
        <div class="flex items-center gap-2">
          <span>{props.value}</span>
          <Show when={props.keys?.length}>
            <Keybind keys={[...(props.keys ?? [])]} variant="neutral" />
          </Show>
        </div>
      }
    >
      {props.children}
    </Tooltip>
  ),
  Menu: (props) => (
    <Menu gutter={4} modal={false} placement={props.placement ?? "bottom-end"}>
      <Show
        when={props.trigger === "button"}
        fallback={
          <Menu.Trigger
            as={IconButton}
            variant="ghost-muted"
            disabled={props.disabled}
            icon={<Icon name={props.icon ?? "outline-dots"} />}
            aria-label={props.label}
          />
        }
      >
        <Menu.Trigger as={Button} variant="neutral" icon={props.icon} disabled={props.disabled}>
          {props.label}
        </Menu.Trigger>
      </Show>
      <Menu.Portal>
        <Menu.Content>
          <For each={props.items}>
            {(entry) => {
              if (entry.type === "separator") return <Menu.Separator />

              if (entry.type === "group")
                return (
                  <Menu.Group>
                    <Menu.GroupLabel>{entry.label}</Menu.GroupLabel>
                    <For each={entry.items}>{(item) => <MenuItem {...item} />}</For>
                  </Menu.Group>
                )

              return <MenuItem {...entry} />
            }}
          </For>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  ),
  MenuItem,
  MenuSeparator: () => <Menu.Separator />,
  MenuGroup: (props) => (
    <Menu.Group>
      <Menu.GroupLabel>{props.label}</Menu.GroupLabel>
      {props.children}
    </Menu.Group>
  ),
  MenuSub: (props) => (
    <Menu.Sub gutter={4} overflowPadding={16} overlap onOpenChange={(open) => props.onOpenChange?.(open)}>
      <Menu.SubTrigger disabled={props.disabled} class="[&_[data-slot=menu-v2-item-chevron]]:text-v2-icon-icon-muted">
        <Show when={props.icon}>{(icon) => <Icon name={icon()} class="text-v2-icon-icon-muted" />}</Show>
        <span class="min-w-0 truncate">{props.label}</span>
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent class="w-max min-w-[172px] max-w-[calc(100vw-32px)]" aria-label={props.label}>
          {props.children}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  ),
  Loader: (props) => (
    <Loader
      width={loaderSize[props.size ?? "normal"]}
      height={loaderSize[props.size ?? "normal"]}
      class={props.class}
    />
  ),
  Dialog: (props) => {
    const footer = children(() => props.footer)

    return (
      <Dialog
        fit={(props.size ?? "fit") === "fit"}
        size={props.size === "large" || props.size === "x-large" ? props.size : "normal"}
      >
        <DialogHeader hideClose={props.closable === false}>
          <DialogTitleGroup title={props.title} description={props.description} />
        </DialogHeader>
        <DialogBody class="min-h-0">
          {/* Without a footer, the content keeps the dialog's bottom padding itself. */}
          <div data-scrollable class="min-h-0 flex-1 overflow-y-auto px-4" classList={{ "pb-4": !footer() }}>
            {props.children}
          </div>
        </DialogBody>
        <Show when={footer()}>
          <DialogFooter>{footer()}</DialogFooter>
        </Show>
      </Dialog>
    )
  },
  Switch: (props) => (
    <Switch
      checked={props.checked}
      onChange={(checked) => props.onChange(checked)}
      disabled={props.disabled}
      hideLabel={props.hideLabel}
      description={props.description}
    >
      {props.label}
    </Switch>
  ),
  TextInput: (props) => (
    <TextInput
      type={props.type ?? "text"}
      appearance={props.size === "large" ? "large" : "base"}
      value={props.value}
      placeholder={props.placeholder}
      aria-label={props.label}
      disabled={props.disabled}
      invalid={props.invalid}
      autofocus={props.autofocus}
      class={props.class}
      onInput={(event) => props.onInput(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.isComposing || !props.onSubmit) return
        event.preventDefault()
        props.onSubmit(event.currentTarget.value)
      }}
    />
  ),
  Select: (props) => (
    <Select
      options={[...props.options]}
      current={props.options.find((option) => option.value === props.value)}
      value={(option) => option.value}
      label={(option) => option.label}
      placeholder={props.placeholder}
      aria-label={props.label}
      disabled={props.disabled}
      invalid={props.invalid}
      placement={props.placement ?? "bottom-end"}
      gutter={6}
      class={props.class}
      onSelect={(option) => option && props.onChange(option.value)}
    />
  ),
  Keybind: (props) => (
    <Show when={props.keys.length > 0}>
      <Keybind keys={[...props.keys]} variant="neutral" class={props.class} />
    </Show>
  ),
  Markdown: (props) => <Markdown text={props.text} class={props.class} />,
  // The timeline's code block: a fenced block in Markdown, highlighted by the same worker. It shows the code as it is,
  // never a plugin's code block content, so a CodeBlock render can show its own source through it.
  Code: (props) => (
    <MarkdownProvider codeBlocks={false}>
      <Markdown text={fence(props.content, props.language)} class={props.class} />
    </MarkdownProvider>
  ),
  // The settings screen's markup. Its stylesheet loads with that screen, where every `SettingsPage` renders, so the
  // startup chunk does not carry it.
  SettingsLayout: (props) => (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{props.title}</h2>
            <Show when={props.description}>
              <span class="text-11-regular text-v2-text-text-muted">{props.description}</span>
            </Show>
          </div>
          <div class="settings-tab-header-actions">{props.actions}</div>
        </div>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">{props.children}</div>
    </>
  ),
  SettingsSection: (props) => (
    <section class="settings-section" aria-label={props.title}>
      <Show when={props.title}>
        <h3 class="settings-section-title">{props.title}</h3>
      </Show>
      <div data-component="settings-list">{props.children}</div>
      {props.footer}
    </section>
  ),
  SettingsRow: (props) => {
    const description = children(() => props.description)

    // Settings search reveals the row whose `data-action` is the entry it picked.
    return (
      <div data-component="settings-row" data-action={props.id}>
        <div data-slot="settings-row-copy">
          <div data-slot="settings-row-title">{props.title}</div>
          <Show when={description()}>
            <div data-slot="settings-row-description">{description()}</div>
          </Show>
        </div>
        <div data-slot="settings-row-control">{props.children}</div>
      </div>
    )
  },
}

function MenuItem(props: UiMenuItem) {
  return (
    <Menu.Item
      disabled={props.disabled}
      onSelect={() => props.onSelect()}
      shortcut={props.keys?.length ? <Keybind keys={[...props.keys]} variant="neutral" /> : undefined}
    >
      <Show when={props.icon}>{(icon) => <Icon name={icon()} class="text-v2-icon-icon-muted" />}</Show>
      <span class="min-w-0 truncate">{props.label}</span>
    </Menu.Item>
  )
}

// A fence longer than any run of backticks in the code, so no line of the code can close it. The language keeps only
// the characters a fence's info string may hold.
function fence(content: string, language: string | undefined) {
  const longest = Array.from(content.matchAll(/`+/g)).reduce((most, run) => Math.max(most, run[0].length), 0)
  const ticks = "`".repeat(Math.max(3, longest + 1))
  const info = (language ?? "").replace(/[^\w#+.-]/g, "")

  return `${ticks}${info}\n${content.endsWith("\n") ? content : `${content}\n`}${ticks}`
}
