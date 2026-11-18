import "@/composer/editor/editor.css"
import "@/new-session/location/dialog.css"
import "@/session/composer/composer-lane.css"
import "@/session/composer/queue-panel.css"
import "@/session/timeline/search-bar.css"
import "@/settings/settings.css"
import "@/settings/workspaces/project.css"
import "@/shell/palette-menu.css"
import "@/shell/search-list.css"
import "@/shell/titlebar/titlebar.css"
import "@opencode/session-ui/sources/panel"

import { Accordion } from "@opencode/ui/accordion"
import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { Collapsible } from "@opencode/ui/collapsible"
import { Field } from "@opencode/ui/field"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { InlineInput } from "@opencode/ui/inline-input"
import { LineComment, LineCommentOverflowIcon } from "@opencode/ui/line-comment"
import { RadioGroup, RadioItem } from "@opencode/ui/radio"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Select } from "@opencode/ui/select"
import { SplitButton, SplitButtonAction, SplitButtonMenuTrigger } from "@opencode/ui/split-button"
import { Switch } from "@opencode/ui/switch"
import { Tabs } from "@opencode/ui/tabs"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { createEffect, For, onCleanup, type JSX } from "solid-js"
import { focusTarget, forceFocusStyles } from "./force-focus"

type Specimen = {
  name: string
  source: string
  render: () => JSX.Element
  // The element that would hold focus. Defaults to the first focusable element in the specimen.
  target?: string
}

type Group = { name: string; css: string; specimens: Specimen[] }

const schemes = ["lab", "light", "dark"] as const

type FocusArgs = { scheme: (typeof schemes)[number]; forced: boolean }

const buttonVariants = [
  "neutral",
  "danger",
  "warning",
  "outline",
  "contrast",
  "submit",
  "ghost",
  "ghost-muted",
  "ghost-faint",
  "ghost-danger",
] as const

const iconButtonVariants = ["neutral", "contrast", "submit", "ghost", "ghost-muted"] as const

const groups: Group[] = [
  {
    name: "Outline 2px, offset 2.5px",
    css: "outline: 2px solid var(--v2-border-border-focus); outline-offset: 2.5px",
    specimens: [
      ...buttonVariants.map((variant) => ({
        name: `Button ${variant}`,
        source: "ui/src/actions/button/button.css",
        render: () => <Button variant={variant}>Button</Button>,
      })),
      ...iconButtonVariants.map((variant) => ({
        name: `IconButton ${variant}`,
        source: "ui/src/actions/icon-button/icon-button.css",
        render: () => <IconButton variant={variant} icon={<Icon name="plus" />} aria-label="Add" />,
      })),
      {
        name: "Composer lane pill",
        source: "app/src/session/composer/composer-lane.css",
        render: () => (
          <button type="button" data-composer-pill>
            Composer pill
          </button>
        ),
      },
    ],
  },
  {
    name: "Outline 2px, offset 2px",
    css: "outline: 2px solid var(--v2-border-border-focus); outline-offset: 2px",
    specimens: [
      {
        name: "Checkbox compact",
        source: "ui/src/forms/checkbox/checkbox-compact.css",
        render: () => (
          <Checkbox appearance="compact" defaultChecked>
            Compact checkbox
          </Checkbox>
        ),
      },
      {
        name: "LineComment overflow",
        source: "ui/src/data-display/line-comment/line-comment.css",
        render: () => (
          <div style={{ width: "260px" }}>
            <LineComment
              comment="Rename this before merge"
              actions={
                <button type="button" data-slot="line-comment-v2-overflow" aria-label="More">
                  <LineCommentOverflowIcon />
                </button>
              }
            />
          </div>
        ),
      },
      {
        name: "Settings back",
        source: "app/src/settings/settings.css",
        render: () => (
          <button type="button" class="settings-back">
            Back to app
          </button>
        ),
      },
      {
        name: "New session location back",
        source: "app/src/new-session/location/dialog.css",
        render: () => (
          <button type="button" class="new-session-location-back">
            Back
          </button>
        ),
      },
      {
        name: "Project settings server link",
        source: "app/src/settings/workspaces/project.css",
        render: () => (
          <a href="#focus-rings" class="project-settings-server-link">
            Server link
          </a>
        ),
      },
    ],
  },
  {
    name: "Outline 2px, offset 1px",
    css: "outline: 2px solid var(--v2-border-border-focus); outline-offset: 1px",
    specimens: [
      {
        name: "Switch compact",
        source: "ui/src/forms/switch/switch.css",
        render: () => <Switch defaultChecked>Compact switch</Switch>,
      },
      {
        name: "Radio",
        source: "ui/src/forms/radio/radio.css",
        render: () => (
          <RadioGroup label="Radio" defaultValue="one" name="focus-ring-radio">
            <RadioItem value="one" label="Selected" />
            <RadioItem value="two" label="Other" />
          </RadioGroup>
        ),
      },
      {
        name: "SegmentedControl item",
        source: "ui/src/navigation/segmented-control/segmented-control.css",
        render: () => (
          <SegmentedControl defaultValue="one" aria-label="Segmented">
            <SegmentedControlItem value="one">One</SegmentedControlItem>
            <SegmentedControlItem value="two">Two</SegmentedControlItem>
          </SegmentedControl>
        ),
      },
      {
        name: "TextInput clear button",
        source: "ui/src/forms/text-input/text-input.css",
        target: '[data-slot="text-input-v2-icon-button"]',
        render: () => <TextInput value="Clearable" showClearButton clearLabel="Clear" />,
      },
      {
        name: "Question progress segment",
        source: "session-ui/src/components/question-prompt.css",
        render: () => (
          <div data-component="dock-prompt" data-kind="question">
            <button type="button" data-slot="question-progress-segment" aria-label="Question 1" />
          </div>
        ),
      },
      {
        name: "Field label info",
        source: "ui/src/forms/field/field.css",
        target: '[data-slot="field-v2-label-info"]',
        render: () => (
          <Field>
            <Field.Label tooltip="More about this field">Label</Field.Label>
            <TextInput placeholder="Value" />
          </Field>
        ),
      },
    ],
  },
  {
    name: "Outline 2px, inset (offset -2px)",
    css: "outline: 2px solid var(--v2-border-border-focus); outline-offset: -2px",
    specimens: [
      {
        name: "SplitButton action",
        source: "ui/src/actions/split-button/split-button.css",
        render: () => (
          <SplitButton>
            <SplitButtonAction aria-label="Open">
              <Icon name="folder" />
            </SplitButtonAction>
            <SplitButtonMenuTrigger aria-label="More options">
              <Icon name="chevron-down" size="small" />
            </SplitButtonMenuTrigger>
          </SplitButton>
        ),
      },
      {
        name: "SplitButton menu trigger",
        source: "ui/src/actions/split-button/split-button.css",
        target: '[data-component="split-button-v2-menu-trigger"]',
        render: () => (
          <SplitButton>
            <SplitButtonAction aria-label="Open">
              <Icon name="folder" />
            </SplitButtonAction>
            <SplitButtonMenuTrigger aria-label="More options">
              <Icon name="chevron-down" size="small" />
            </SplitButtonMenuTrigger>
          </SplitButton>
        ),
      },
      {
        name: "Composer toolbar Button / IconButton",
        source: "app/src/composer/editor/editor.css",
        render: () => (
          <div data-component="composer" style={{ display: "flex", gap: "8px" }}>
            <Button variant="ghost">Build</Button>
          </div>
        ),
      },
      {
        name: "Queue panel Button / IconButton",
        source: "app/src/session/composer/queue-panel.css",
        render: () => (
          <div data-component="session-queue-panel">
            <IconButton variant="ghost" icon={<Icon name="trash" />} aria-label="Remove" />
          </div>
        ),
      },
    ],
  },
  {
    name: "Field outline colour (1px, inset)",
    css: ":focus-within { outline-color: var(--v2-border-border-focus); box-shadow: none } over outline: 1px solid; outline-offset: -1px",
    specimens: [
      {
        name: "TextInput",
        source: "ui/src/forms/text-input/text-input.css",
        render: () => <TextInput placeholder="Text input" />,
      },
      {
        name: "Textarea",
        source: "ui/src/forms/textarea/textarea.css",
        render: () => <Textarea placeholder="Textarea" rows={2} />,
      },
      {
        name: "Select",
        source: "ui/src/forms/select/select.css",
        render: () => <Select appearance="base" placeholder="Select" options={["Apple", "Banana"]} current="Apple" />,
      },
      {
        name: "Timeline search bar input",
        source: "app/src/session/timeline/search-bar.css (inset 0 0 0 1px box-shadow)",
        render: () => (
          <div data-component="timeline-search-bar">
            <TextInput placeholder="Find in session" />
          </div>
        ),
      },
    ],
  },
  {
    name: "Outline 1px, thin",
    css: "outline: 1px solid var(--v2-border-border-focus | --v2-text-text-accent); outline-offset: 1px | 2px",
    specimens: [
      {
        name: "Sources chip",
        source: "session-ui/src/sources/sources.css (border-focus, offset 1px)",
        render: () => (
          <button type="button" data-component="sources-chip">
            3 sources
          </button>
        ),
      },
      {
        name: "Question option",
        source: "session-ui/src/components/question-prompt.css (border-focus, offset -1px)",
        render: () => (
          <div data-component="dock-prompt" data-kind="question" style={{ width: "220px" }}>
            <button type="button" data-slot="question-option">
              Option
            </button>
          </div>
        ),
      },
      {
        name: "Session compaction toggle",
        source: "session-ui/src/components/session-compaction.css (text-accent, offset 2px)",
        render: () => (
          <div data-component="session-compaction-message" data-quiet>
            <button type="button" data-slot="session-compaction-divider">
              Compacted
            </button>
          </div>
        ),
      },
    ],
  },
  {
    name: "Outline 2px currentColor",
    css: "outline: 2px solid currentColor; outline-offset: 2px",
    specimens: [
      {
        name: "Markdown session link",
        source: "session-ui/src/components/markdown.css",
        render: () => (
          <a href="#focus-rings" class="markdown-session-link">
            Session link
          </a>
        ),
      },
    ],
  },
  {
    name: "Box-shadow ring",
    css: "box-shadow: var(--shadow-xs-border-focus) | 0 0 0 2px bg, 0 0 0 4px var(--v2-border-border-focus)",
    specimens: [
      {
        name: "Checkbox standard (legacy)",
        source: "ui/src/forms/checkbox/checkbox.css",
        render: () => <Checkbox defaultChecked>Standard checkbox</Checkbox>,
      },
      {
        name: "Switch standard (legacy)",
        source: "ui/src/forms/switch/switch.css",
        render: () => (
          <Switch appearance="standard" defaultChecked>
            Standard switch
          </Switch>
        ),
      },
      {
        name: "Project colour swatch",
        source: "app/src/settings/workspaces/project.css",
        render: () => (
          <button
            type="button"
            class="project-settings-color"
            aria-label="Blue"
            style={{ width: "24px", height: "24px", background: "var(--v2-blue-500)" }}
          />
        ),
      },
    ],
  },
  {
    name: "Background only (no ring)",
    css: "outline: none; background: var(--v2-overlay-simple-overlay-hover) or similar",
    specimens: [
      {
        name: "Palette menu row",
        source: "app/src/shell/palette-menu.css",
        render: () => (
          <button type="button" class="palette-menu-row" style={{ width: "220px" }}>
            Palette row
          </button>
        ),
      },
      {
        name: "Search list row",
        source: "app/src/shell/search-list.css",
        render: () => (
          <button type="button" class="search-list-row" style={{ width: "220px" }}>
            Search list row
          </button>
        ),
      },
      {
        name: "Collapsible trigger",
        source: "ui/src/components/collapsible.css",
        render: () => (
          <Collapsible>
            <Collapsible.Trigger>Collapsible trigger</Collapsible.Trigger>
            <Collapsible.Content>Content</Collapsible.Content>
          </Collapsible>
        ),
      },
      {
        name: "Titlebar ghost-muted IconButton",
        source: "app/src/shell/titlebar/titlebar.css",
        render: () => (
          <div data-slot="titlebar-v2">
            <IconButton variant="ghost-muted" icon={<Icon name="plus" />} aria-label="New tab" />
          </div>
        ),
      },
      {
        name: "Session identity / new session selectors",
        source: "app/src/session/session-identity-header.tsx (Tailwind)",
        render: () => (
          <button
            type="button"
            class="relative flex h-7 items-center gap-2 rounded-[6px] px-1.5 text-[13px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none"
          >
            Session title
          </button>
        ),
      },
    ],
  },
  {
    name: "No focus ring",
    css: "outline: none with no replacement, or no :focus-visible rule",
    specimens: [
      {
        name: "Tabs line (v2)",
        source: "ui/src/navigation/tabs/tabs-current.css",
        render: () => (
          <Tabs variant="line" defaultValue="one">
            <Tabs.List>
              <Tabs.Trigger value="one">One</Tabs.Trigger>
              <Tabs.Trigger value="two">Two</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        ),
      },
      {
        name: "Tabs pill (v2)",
        source: "ui/src/navigation/tabs/tabs-current.css",
        render: () => (
          <Tabs variant="pill" defaultValue="one">
            <Tabs.List>
              <Tabs.Trigger value="one">One</Tabs.Trigger>
              <Tabs.Trigger value="two">Two</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        ),
      },
      {
        name: "Tabs panel (legacy)",
        source: "ui/src/navigation/tabs/tabs.css",
        render: () => (
          <Tabs variant="panel" defaultValue="one">
            <Tabs.List>
              <Tabs.Trigger value="one">One</Tabs.Trigger>
              <Tabs.Trigger value="two">Two</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        ),
      },
      {
        name: "Accordion trigger",
        source: "ui/src/data-display/accordion/accordion.css",
        render: () => (
          <div style={{ width: "220px" }}>
            <Accordion collapsible>
              <Accordion.Item value="one">
                <Accordion.Header>
                  <Accordion.Trigger>Accordion trigger</Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content>Content</Accordion.Content>
              </Accordion.Item>
            </Accordion>
          </div>
        ),
      },
      {
        name: "Timeline scroll to bottom",
        source: "app/src/session/timeline/virtualizer.tsx (focus-visible:outline-2 loses to outline-none)",
        render: () => (
          <button
            type="button"
            aria-label="Scroll to bottom"
            class="pointer-events-auto flex items-center justify-center w-8 h-7 px-2 py-1.5 rounded-lg border-none cursor-pointer text-v2-text-text-base backdrop-blur-[2px] outline-none hover:bg-[linear-gradient(var(--v2-overlay-simple-overlay-hover),var(--v2-overlay-simple-overlay-hover))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
          >
            <Icon name="chevron-down" />
          </button>
        ),
      },
      {
        name: "Button loading",
        source: "ui/src/actions/button/button.css",
        render: () => <Button variant="loading">Loading</Button>,
      },
      {
        name: "InlineInput",
        source: "ui/src/forms/inline-input/inline-input.css",
        render: () => <InlineInput value="Inline input" />,
      },
    ],
  },
]

function FocusRings(props: FocusArgs) {
  let root: HTMLElement | undefined

  createEffect(() => {
    if (!props.forced) return

    const removeStyles = forceFocusStyles()

    // Some controls (Select) replace their trigger after the first render, so targets are marked a frame later.
    const frame = requestAnimationFrame(() =>
      root
        ?.querySelectorAll<HTMLElement>("[data-focus-specimen]")
        .forEach((specimen) => focusTarget(specimen)?.setAttribute("data-lab-focus", "")),
    )

    onCleanup(() => {
      cancelAnimationFrame(frame)
      removeStyles()
      root?.querySelectorAll("[data-lab-focus]").forEach((element) => element.removeAttribute("data-lab-focus"))
    })
  })

  return (
    <main
      ref={root}
      id="focus-rings"
      data-color-scheme={props.scheme === "lab" ? undefined : props.scheme}
      style={{
        display: "grid",
        gap: "32px",
        width: "min(1120px, 100%)",
        padding: "24px",
        "box-sizing": "border-box",
        color: "var(--v2-text-text-base)",
        background: "var(--v2-background-bg-base)",
      }}
    >
      <header style={{ display: "grid", gap: "4px" }}>
        <h1 style={{ ...heading, "font-size": "18px" }}>Focus rings</h1>
        <p style={{ ...label, margin: "0" }}>
          Every focus treatment in the desktop and web UI, grouped by how it looks, each shown with focus forced on.
        </p>
      </header>
      <For each={groups}>
        {(group) => (
          <section style={{ display: "grid", gap: "12px" }}>
            <div style={{ display: "grid", gap: "4px" }}>
              <h2 style={heading}>{group.name}</h2>
              <code style={{ ...label, "font-family": "var(--font-family-mono)" }}>{group.css}</code>
            </div>
            <div
              style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(320px, 1fr))", gap: "12px" }}
            >
              <For each={group.specimens}>
                {(specimen) => (
                  <figure
                    style={{
                      display: "grid",
                      "grid-template-rows": "1fr auto",
                      gap: "12px",
                      margin: "0",
                      padding: "16px",
                      "border-radius": "8px",
                      border: "1px solid var(--v2-border-border-base)",
                    }}
                  >
                    <div
                      data-focus-specimen
                      data-focus-target={specimen.target}
                      style={{ display: "flex", "align-items": "center", "min-height": "40px", padding: "4px" }}
                    >
                      {specimen.render()}
                    </div>
                    <figcaption style={{ display: "grid", gap: "2px" }}>
                      <span style={{ ...label, color: "var(--v2-text-text-base)" }}>{specimen.name}</span>
                      <span style={{ ...label, "font-family": "var(--font-family-mono)", "font-size": "11px" }}>
                        {specimen.source}
                      </span>
                    </figcaption>
                  </figure>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
    </main>
  )
}

const heading = {
  margin: "0",
  color: "var(--v2-text-text-base)",
  "font-size": "14px",
  "font-weight": 600,
  "line-height": "var(--line-height-base)",
} as const

const label = {
  color: "var(--v2-text-text-muted)",
  "font-size": "12px",
  "line-height": "var(--line-height-compact)",
} as const

export default {
  title: "App/Design review/Focus rings",
  id: "review-focus-rings",
  args: { scheme: "lab", forced: true } satisfies FocusArgs,
  argTypes: { scheme: { control: "select", options: schemes } },
  parameters: { layout: "fullscreen" },
}

export const AllFocusRings = { render: (args: FocusArgs) => <FocusRings {...args} /> }

export const Light = { args: { scheme: "light" }, render: (args: FocusArgs) => <FocusRings {...args} /> }

export const Dark = { args: { scheme: "dark" }, render: (args: FocusArgs) => <FocusRings {...args} /> }
