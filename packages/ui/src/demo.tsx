import type { Component } from "solid-js"
import { createSignal } from "solid-js"
import "./index.css"
import { Button } from "./components/button"
import { Select } from "./components/select"
import { Font } from "./components/font"
import { Accordion } from "./components/accordion"
import { Tabs } from "./components/tabs"
import { Tooltip } from "./components/tooltip"
import { Input } from "./components/input"
import { Checkbox } from "./components/checkbox"
import { Icon } from "./components/icon"
import { IconButton } from "./components/icon-button"
import { Dialog } from "./components/dialog"
import { SelectDialog } from "./components/select-dialog"
import { Collapsible } from "./components/collapsible"

const Demo: Component = () => {
  const [dialogOpen, setDialogOpen] = createSignal(false)
  const [selectDialogOpen, setSelectDialogOpen] = createSignal(false)
  const [inputValue, setInputValue] = createSignal("")
  const [checked, setChecked] = createSignal(false)
  const [termsAccepted, setTermsAccepted] = createSignal(false)

  const Content = (props: { dark?: boolean }) => (
    <div class={`${props.dark ? "dark" : ""}`}>
      <h3>Buttons</h3>
      <section>
        <Button variant="primary" size="normal">
          Normal Primary
        </Button>
        <Button variant="secondary" size="normal">
          Normal Secondary
        </Button>
        <Button variant="ghost" size="normal">
          Normal Ghost
        </Button>
        <Button variant="secondary" size="normal" disabled>
          Normal Disabled
        </Button>
        <Button variant="primary" size="large">
          Large Primary
        </Button>
        <Button variant="secondary" size="large">
          Large Secondary
        </Button>
        <Button variant="ghost" size="large">
          Large Ghost
        </Button>
        <Button variant="secondary" size="large" disabled>
          Large Disabled
        </Button>
      </section>
      <h3>Select</h3>
      <section>
        <Select
          class={props.dark ? "dark" : ""}
          variant="primary"
          options={["Option 1", "Option 2", "Option 3"]}
          placeholder="Select Primary"
        />
        <Select
          variant="secondary"
          class={props.dark ? "dark" : ""}
          options={["Option 1", "Option 2", "Option 3"]}
          placeholder="Select Secondary"
        />
        <Select
          variant="ghost"
          class={props.dark ? "dark" : ""}
          options={["Option 1", "Option 2", "Option 3"]}
          placeholder="Select Ghost"
        />
      </section>
      <h3>Tabs</h3>
      <section>
        <Tabs defaultValue="tab1" style={{ width: "100%" }}>
          <Tabs.List>
            <Tabs.Trigger value="tab1">Tab 1</Tabs.Trigger>
            <Tabs.Trigger value="tab2">Tab 2</Tabs.Trigger>
            <Tabs.Trigger value="tab3">Tab 3</Tabs.Trigger>
            <Tabs.Trigger value="tab4" disabled>
              Disabled Tab
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="tab1">
            <div style={{ padding: "16px" }}>
              <h4>Tab 1 Content</h4>
              <p>This is the content for the first tab.</p>
            </div>
          </Tabs.Content>
          <Tabs.Content value="tab2">
            <div style={{ padding: "16px" }}>
              <h4>Tab 2 Content</h4>
              <p>This is the content for the second tab.</p>
            </div>
          </Tabs.Content>
          <Tabs.Content value="tab3">
            <div style={{ padding: "16px" }}>
              <h4>Tab 3 Content</h4>
              <p>This is the content for the third tab.</p>
            </div>
          </Tabs.Content>
          <Tabs.Content value="tab4">
            <div style={{ padding: "16px" }}>
              <h4>Tab 4 Content</h4>
              <p>This tab should be disabled.</p>
            </div>
          </Tabs.Content>
        </Tabs>
      </section>
      <h3>Tooltips</h3>
      <section>
        <Tooltip value="This is a top tooltip" placement="top">
          <Button variant="secondary">Top Tooltip</Button>
        </Tooltip>
        <Tooltip value="This is a bottom tooltip" placement="bottom">
          <Button variant="secondary">Bottom Tooltip</Button>
        </Tooltip>
        <Tooltip value="This is a left tooltip" placement="left">
          <Button variant="secondary">Left Tooltip</Button>
        </Tooltip>
        <Tooltip value="This is a right tooltip" placement="right">
          <Button variant="secondary">Right Tooltip</Button>
        </Tooltip>
        <Tooltip value={`Dynamic tooltip: ${new Date().toLocaleTimeString()}`} placement="top">
          <Button variant="primary">Dynamic Tooltip</Button>
        </Tooltip>
      </section>
      <h3>List</h3>
      <h3>Input</h3>
      <section>
        <Input
          placeholder="Enter text..."
          value={inputValue()}
          onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => setInputValue(e.currentTarget.value)}
        />
        <Input placeholder="Disabled input" disabled />
        <Input type="password" placeholder="Password input" />
      </section>
      <h3>Checkbox</h3>
      <section style={{ "flex-direction": "column", "align-items": "flex-start", gap: "12px" }}>
        <Checkbox label="Simple checkbox" />
        <Checkbox label="Checked by default" defaultChecked />
        <Checkbox label="Disabled checkbox" disabled />
        <Checkbox label="Disabled & checked" disabled checked />
        <Checkbox
          label="Controlled checkbox"
          description="This checkbox is controlled by state"
          checked={checked()}
          onChange={setChecked}
        />
        <Checkbox label="With description" description="This is a helpful description for the checkbox" />
        <Checkbox label="Indeterminate state" description="Useful for nested checkbox lists" indeterminate />
        <Checkbox
          label="I agree to the Terms and Conditions"
          description="You must agree to continue"
          checked={termsAccepted()}
          onChange={setTermsAccepted}
          validationState={!termsAccepted() ? "invalid" : "valid"}
        />
      </section>
      <h3>Icons</h3>
      <section>
        <Icon name="close" />
        <Icon name="checkmark" />
        <Icon name="chevron-down" />
        <Icon name="chevron-up" />
        <Icon name="chevron-left" />
        <Icon name="chevron-right" />
        <Icon name="search" />
        <Icon name="loading" />
      </section>
      <h3>Icon Buttons</h3>
      <section>
        <IconButton icon="close" onClick={() => console.log("Close clicked")} />
        <IconButton icon="checkmark" onClick={() => console.log("Check clicked")} />
        <IconButton icon="search" onClick={() => console.log("Search clicked")} disabled />
      </section>
      <h3>Dialog</h3>
      <section>
        <Button onClick={() => setDialogOpen(true)}>Open Dialog</Button>
        <Dialog open={dialogOpen()} onOpenChange={setDialogOpen}>
          <Dialog.Title>Example Dialog</Dialog.Title>
          <Dialog.Description>This is an example dialog with a title and description.</Dialog.Description>
          <div
            style={{
              "margin-top": "16px",
              display: "flex",
              gap: "8px",
              "justify-content": "flex-end",
            }}
          >
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setDialogOpen(false)}>
              Confirm
            </Button>
          </div>
        </Dialog>
      </section>
      <h3>Select Dialog</h3>
      <section>
        <Button onClick={() => setSelectDialogOpen(true)}>Open Select Dialog</Button>
        <SelectDialog
          title="Select an Option"
          defaultOpen={selectDialogOpen()}
          onOpenChange={setSelectDialogOpen}
          items={["Option 1", "Option 2", "Option 3", "Option 4", "Option 5"]}
          key={(x) => x}
          onSelect={(option) => {
            console.log("Selected:", option)
            setSelectDialogOpen(false)
          }}
          placeholder="Search options..."
        >
          {(item) => <div>{item}</div>}
        </SelectDialog>
      </section>
      <h3>Collapsible</h3>
      <section>
        <Collapsible>
          <Collapsible.Trigger>
            <Button variant="secondary">Toggle Content</Button>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div
              style={{
                padding: "16px",
                "background-color": "var(--surface-base)",
                "border-radius": "8px",
                "margin-top": "8px",
              }}
            >
              <p>This is collapsible content that can be toggled open and closed.</p>
              <p>It animates smoothly using CSS animations.</p>
            </div>
          </Collapsible.Content>
        </Collapsible>
      </section>
      <h3>Accordion</h3>
      <section>
        <Accordion collapsible>
          <Accordion.Item value="item-1">
            <Accordion.Header>
              <Accordion.Trigger>What is Kobalte?</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <div style={{ padding: "16px" }}>
                <p>Kobalte is a UI toolkit for building accessible web apps and design systems with SolidJS.</p>
              </div>
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="item-2">
            <Accordion.Header>
              <Accordion.Trigger>Is it accessible?</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <div style={{ padding: "16px" }}>
                <p>Yes. It adheres to the WAI-ARIA design patterns.</p>
              </div>
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="item-3">
            <Accordion.Header>
              <Accordion.Trigger>Can it be animated?</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <div style={{ padding: "16px" }}>
                <p>Yes! You can animate the content height using CSS animations.</p>
              </div>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion>
      </section>
    </div>
  )

  return (
    <>
      <Font />
      <main>
        <Content />
        <Content dark />
      </main>
    </>
  )
}

export default Demo
