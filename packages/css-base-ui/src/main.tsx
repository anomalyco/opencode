import { Accordion } from "@base-ui/react/accordion"
import { Button } from "@base-ui/react/button"
import { Checkbox } from "@base-ui/react/checkbox"
import { Dialog } from "@base-ui/react/dialog"
import { Field } from "@base-ui/react/field"
import { Input } from "@base-ui/react/input"
import { Menu } from "@base-ui/react/menu"
import { Popover } from "@base-ui/react/popover"
import { Select } from "@base-ui/react/select"
import { Slider } from "@base-ui/react/slider"
import { Switch } from "@base-ui/react/switch"
import { Tabs } from "@base-ui/react/tabs"
import { Tooltip } from "@base-ui/react/tooltip"
import { createRoot } from "react-dom/client"
import "@opencode-ai/css"
import "./theme.css"

const environments = [
  { label: "Production", value: "production" },
  { label: "Staging", value: "staging" },
  { label: "Development", value: "development" },
]

function App() {
  return (
    <main data-component="page">
      <header data-slot="page-header">
        <div data-slot="page-heading">
          <p data-slot="page-eyebrow">Theme experiment / Base UI 1.6</p>
          <h1 data-slot="page-title">Control room</h1>
          <p data-slot="page-description">
            OpenCode’s unchanged colors, type, radii, and elevation applied to accessible Base UI primitives.
          </p>
        </div>
        <div data-slot="page-actions">
          <Tooltip.Provider>
            <Tooltip.Root>
              <Tooltip.Trigger data-component="button" data-variant="ghost" data-size="normal">
                ⌘ K
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Positioner sideOffset={8}>
                  <Tooltip.Popup data-ui="tooltip">Open command menu</Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
          <Button data-component="button" data-variant="contrast" data-size="normal">
            New deploy
          </Button>
        </div>
      </header>

      <div data-slot="page-content">
        <section data-component="surface">
          <header data-slot="surface-header">
            <div className="section-heading">
              <div>
                <h2 data-slot="surface-title">Release settings</h2>
                <p data-slot="surface-description">Field, Input, Select, Checkbox, Switch, and Slider</p>
              </div>
              <span data-component="badge" data-variant="accent">
                Healthy
              </span>
            </div>
          </header>
          <div data-slot="surface-content" className="form-grid">
            <Field.Root data-component="field">
              <Field.Label data-slot="field-label">Release name</Field.Label>
              <Input data-component="input" defaultValue="opencode-1.18.4" />
              <Field.Description data-slot="field-description">Visible in the deployment timeline.</Field.Description>
            </Field.Root>

            <div data-component="field">
              <Select.Root items={environments} defaultValue="production">
                <Select.Label data-slot="field-label">Environment</Select.Label>
                <Select.Trigger data-component="select" className="select-trigger">
                  <Select.Value />
                  <Select.Icon aria-hidden>⌄</Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Positioner className="positioner" sideOffset={6} alignItemWithTrigger={false}>
                    <Select.Popup data-ui="popup">
                      {environments.map((environment) => (
                        <Select.Item key={environment.value} value={environment.value} data-ui="option">
                          <Select.ItemIndicator>✓</Select.ItemIndicator>
                          <Select.ItemText>{environment.label}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Positioner>
                </Select.Portal>
              </Select.Root>
              <p data-slot="field-description">Controls where this build becomes available.</p>
            </div>

            <label data-ui="check-row">
              <Checkbox.Root defaultChecked data-ui="checkbox">
                <Checkbox.Indicator>✓</Checkbox.Indicator>
              </Checkbox.Root>
              <span>
                <strong>Run smoke tests</strong>
                <small>Verify auth, sessions, and tool execution.</small>
              </span>
            </label>

            <label data-ui="check-row">
              <Switch.Root defaultChecked data-ui="switch">
                <Switch.Thumb />
              </Switch.Root>
              <span>
                <strong>Automatic rollback</strong>
                <small>Restore the last healthy release on failure.</small>
              </span>
            </label>

            <div data-component="field" className="slider-field">
              <div className="field-inline">
                <span data-slot="field-label">Traffic allocation</span>
                <span data-component="badge">25%</span>
              </div>
              <Slider.Root defaultValue={25} data-ui="slider">
                <Slider.Control className="slider-control">
                  <Slider.Track className="slider-track">
                    <Slider.Indicator className="slider-indicator" />
                    <Slider.Thumb className="slider-thumb" aria-label="Traffic allocation" />
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
            </div>
          </div>
        </section>

        <div className="two-column">
          <section data-component="surface">
            <header data-slot="surface-header">
              <h2 data-slot="surface-title">Workspace</h2>
              <p data-slot="surface-description">Tabs and Accordion</p>
            </header>
            <div data-slot="surface-content">
              <Tabs.Root defaultValue="activity" data-ui="tabs">
                <Tabs.List>
                  {[
                    ["activity", "Activity"],
                    ["members", "Members"],
                    ["settings", "Settings"],
                  ].map(([value, label]) => (
                    <Tabs.Tab key={value} value={value}>
                      {label}
                    </Tabs.Tab>
                  ))}
                  <Tabs.Indicator />
                </Tabs.List>
                <Tabs.Panel value="activity">
                  12 deployments completed this week. Median duration: 42 seconds.
                </Tabs.Panel>
                <Tabs.Panel value="members">8 operators have access to this workspace.</Tabs.Panel>
                <Tabs.Panel value="settings">Production deploys require a healthy smoke check.</Tabs.Panel>
              </Tabs.Root>

              <Accordion.Root defaultValue={["checks"]} data-ui="accordion">
                {[
                  [
                    "checks",
                    "What runs before activation?",
                    "Package checks, a production build, and browser interaction tests.",
                  ],
                  [
                    "rollback",
                    "When does rollback happen?",
                    "When health checks fail during the five-minute observation window.",
                  ],
                  ["access", "Who can deploy?", "Workspace owners and operators with release permissions."],
                ].map(([value, title, content]) => (
                  <Accordion.Item key={value} value={value}>
                    <Accordion.Header>
                      <Accordion.Trigger>
                        {title}
                        <span aria-hidden>+</span>
                      </Accordion.Trigger>
                    </Accordion.Header>
                    <Accordion.Panel>
                      <div>{content}</div>
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion.Root>
            </div>
          </section>

          <section data-component="surface">
            <header data-slot="surface-header">
              <h2 data-slot="surface-title">Overlays</h2>
              <p data-slot="surface-description">Popover, Menu, Dialog, and Tooltip</p>
            </header>
            <div data-slot="surface-content" className="overlay-demo">
              <Popover.Root>
                <Popover.Trigger data-component="button" data-variant="neutral" data-size="normal">
                  View status
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner className="positioner" sideOffset={8}>
                    <Popover.Popup data-ui="popup" className="popover-popup">
                      <Popover.Title>All systems normal</Popover.Title>
                      <Popover.Description>API and workers are healthy in every region.</Popover.Description>
                      <Popover.Close aria-label="Close">×</Popover.Close>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>

              <Menu.Root>
                <Menu.Trigger data-component="button" data-variant="outline" data-size="normal">
                  Actions
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner className="positioner" sideOffset={6}>
                    <Menu.Popup data-ui="popup">
                      <Menu.Item data-ui="option">
                        View logs <span>⌘L</span>
                      </Menu.Item>
                      <Menu.Item data-ui="option">Duplicate release</Menu.Item>
                      <Menu.Separator data-component="divider" />
                      <Menu.Item data-ui="option" className="danger-item">
                        Cancel deploy
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>

              <Dialog.Root>
                <Dialog.Trigger data-component="button" data-variant="danger" data-size="normal">
                  Rollback
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Backdrop data-ui="backdrop" />
                  <Dialog.Popup data-ui="dialog">
                    <Dialog.Title>Rollback production?</Dialog.Title>
                    <Dialog.Description>This restores v1.18.3 and stops the current rollout.</Dialog.Description>
                    <div className="dialog-actions">
                      <Dialog.Close data-component="button" data-variant="ghost" data-size="normal">
                        Cancel
                      </Dialog.Close>
                      <Dialog.Close data-component="button" data-variant="danger" data-size="normal">
                        Rollback
                      </Dialog.Close>
                    </div>
                  </Dialog.Popup>
                </Dialog.Portal>
              </Dialog.Root>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
