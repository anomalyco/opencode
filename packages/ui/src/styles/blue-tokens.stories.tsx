import { For, createSignal } from "solid-js"
import { Badge } from "../data-display/badge/badge"
import { ProjectAvatar } from "../data-display/project-avatar/project-avatar"
import { RadioGroup, RadioItem } from "../forms/radio/radio"
import { Select } from "../forms/select/select"
import { Switch } from "../forms/switch/switch"
import { TextInput } from "../forms/text-input/text-input"
import { Textarea } from "../forms/textarea/textarea"
import { SegmentedControl, SegmentedControlItem } from "../navigation/segmented-control/segmented-control"
import { Button } from "../actions/button/button"
import { IconButton } from "../actions/icon-button/icon-button"
import { SplitButton, SplitButtonAction, SplitButtonMenuTrigger } from "../actions/split-button/split-button"
import { Icon } from "../icons/icon/icon"

const blue = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200] as const
const unused = new Set([1000])

const section = {
  display: "grid",
  gap: "12px",
} as const

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

function BlueReview() {
  const [fruit, setFruit] = createSignal("Apple")

  return (
    <main
      style={{
        display: "grid",
        gap: "32px",
        width: "min(968px, 100%)",
        padding: "24px",
        "box-sizing": "border-box",
      }}
    >
      <header style={{ display: "grid", gap: "4px" }}>
        <h1 style={{ ...heading, "font-size": "18px" }}>Desktop V2 blue audit</h1>
        <p style={{ ...label, margin: "0" }}>
          Review the primitive ramp, semantic roles, and production controls in light and dark themes.
        </p>
      </header>

      <section style={section}>
        <h2 style={heading}>Primitive ramp</h2>
        <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(112px, 1fr))", gap: "8px" }}>
          <For each={blue}>
            {(step) => (
              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  padding: "10px",
                  background: `var(--v2-blue-${step})`,
                  color: step < 600 ? "var(--v2-blue-1200)" : "var(--v2-blue-200)",
                  "border-radius": "8px",
                  border: "1px solid var(--v2-border-border-base)",
                  "min-height": "56px",
                }}
              >
                <strong style={{ "font-size": "12px" }}>blue-{step}</strong>
                <span style={{ "font-size": "11px", opacity: 0.8 }}>{unused.has(step) ? "palette only" : "in use"}</span>
              </div>
            )}
          </For>
        </div>
      </section>

      <section style={section}>
        <h2 style={heading}>Accent</h2>
        <div style={{ display: "flex", gap: "16px", "align-items": "center", "flex-wrap": "wrap" }}>
          <Badge variant="accent">Accent badge</Badge>
          <Switch defaultChecked>Enabled switch</Switch>
          <RadioGroup label="Accent selection" defaultValue="selected" name="blue-audit-radio">
            <RadioItem value="selected" label="Selected" />
            <RadioItem value="other" label="Unselected" />
          </RadioGroup>
        </div>
        <div style={{ display: "flex", gap: "20px", "align-items": "center", "flex-wrap": "wrap" }}>
          <a href="#accent" style={{ color: "var(--v2-text-text-accent)" }}>
            Accent link
          </a>
          <code style={{ color: "var(--v2-text-text-code-accent)" }}>codeAccent()</code>
          <span style={{ display: "inline-flex", gap: "6px", color: "var(--v2-icon-icon-accent)" }}>
            <Icon name="sparkles" /> Accent icon
          </span>
        </div>
      </section>

      <section style={section}>
        <h2 style={heading}>Information state</h2>
        <div
          style={{
            display: "grid",
            gap: "4px",
            padding: "12px",
            color: "var(--v2-state-fg-info)",
            background: "var(--v2-state-bg-info)",
            border: "1px solid var(--v2-state-border-info)",
            "border-radius": "8px",
          }}
        >
          <strong>Information</strong>
          <span style={{ "font-size": "12px" }}>Background, foreground, and border info tokens together.</span>
        </div>
      </section>

      <section style={section}>
        <h2 style={heading}>Build agent and project avatar</h2>
        <div style={{ display: "flex", gap: "20px", "align-items": "center", "flex-wrap": "wrap" }}>
          <span style={{ color: "var(--v2-agent-build-solid)", "font-weight": 600 }}>Build agent</span>
          <span style={{ display: "inline-flex", gap: "8px", "align-items": "center" }}>
            <ProjectAvatar fallback="B" variant="blue" /> Blue project avatar
          </span>
          <span style={{ display: "inline-flex", gap: "8px", "align-items": "center" }}>
            <ProjectAvatar fallback="B" variant="blue" unread /> Blue avatar with unread state
          </span>
        </div>
      </section>

      <section style={section}>
        <h2 style={heading}>Focus border components</h2>
        <p style={{ ...label, margin: "0" }}>Click or tab through each production control to inspect blue-500.</p>
        <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px" }}>
          <TextInput placeholder="Text input" />
          <Textarea placeholder="Textarea" rows={2} />
          <Select
            placeholder="Select"
            options={["Apple", "Banana", "Cherry"]}
            current={fruit()}
            onSelect={(value) => value && setFruit(value)}
          />
          <SegmentedControl defaultValue="one" aria-label="Blue focus review">
            <SegmentedControlItem value="one">One</SegmentedControlItem>
            <SegmentedControlItem value="two">Two</SegmentedControlItem>
          </SegmentedControl>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <Button>Button</Button>
            <IconButton icon={<Icon name="plus" />} aria-label="Add" />
          </div>
          <SplitButton>
            <SplitButtonAction>Open</SplitButtonAction>
            <SplitButtonMenuTrigger aria-label="More options">
              <Icon name="chevron-down" size="small" />
            </SplitButtonMenuTrigger>
          </SplitButton>
        </div>
      </section>

      <section style={section}>
        <h2 style={heading}>Session message blue</h2>
        <div
          style={{
            display: "grid",
            gap: "12px",
            padding: "16px",
            background: "#fff",
            border: "1px solid var(--v2-border-border-base)",
            "border-radius": "8px",
          }}
        >
          <div data-local-session>
            <div data-component="user-message">
              <div data-slot="user-message-text" style={{ width: "fit-content", padding: "8px 12px" }}>
                Local-session user message
              </div>
            </div>
          </div>
          <div data-workspace-session>
            <div data-component="user-message">
              <div
                data-slot="user-message-text"
                style={{ width: "fit-content", padding: "8px 12px", "border-radius": "8px" }}
              >
                Workspace-session user message
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export default {
  title: "Review/Desktop V2 Blue",
  id: "review-desktop-v2-blue",
  component: BlueReview,
  parameters: {
    layout: "fullscreen",
  },
}

export const AllBlueUsage = {
  render: () => <BlueReview />,
}
