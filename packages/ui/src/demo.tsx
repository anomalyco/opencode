import type { Component } from "solid-js"
import { Button, Select, Tabs, Tooltip, Fonts, List } from "./components"
import "./index.css"

const Demo: Component = () => {
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
          // we have to pass dark bc of the portal,
          // normally wouldn't be needed bc root element
          // would have theme class
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
        <Tooltip value={() => `Dynamic tooltip: ${new Date().toLocaleTimeString()}`} placement="top">
          <Button variant="primary">Dynamic Tooltip</Button>
        </Tooltip>
      </section>
      <h3>List</h3>
      <section style={{ height: "300px" }}>
        <List data={["Item 1", "Item 2", "Item 3"]} key={(x) => x}>
          {(x) => <div>{x}</div>}
        </List>
      </section>
    </div>
  )

  return (
    <>
      <Fonts />
      <main>
        <Content />
        <Content dark />
      </main>
    </>
  )
}

export default Demo
