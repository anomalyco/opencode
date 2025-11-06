import { Plugin } from "../../src/plugin"

export default {
  id: "xml-runtime-test",
  name: "XML Runtime Test Widget",
  widgets: [
    {
      id: "xml-runtime-demo",
      title: "XML/HTML UI Runtime Demo",
      Component: () => {
        return (
          <box flexDirection="column" padding={2} borderStyle="round" borderColor="blue">
            <text bold color="blue">
              🧪 XML/HTML UI Runtime Test
            </text>
            <text marginTop={1}>
              This widget demonstrates the Solid-like reactive XML/HTML runtime library.
            </text>
            <box marginTop={1} padding={1} borderStyle="single" borderColor="green">
              <text color="green">
                ✅ Features:{"\n"}• Reactive signals (createSignal, createEffect){"\n"}• Event
                handlers (on:click, on:input){"\n"}• Two-way binding (bind:value, bind:checked)
                {"\n"}• Expression interpolation: {"{"}expr{"}"}
                {"\n"}• Conditionals (x-if){"\n"}• Loops (x-for) with keyed reconciliation
              </text>
            </box>
            <box marginTop={1} padding={1} borderStyle="single" borderColor="yellow">
              <text color="yellow">
                📦 Implementation:{"\n"}• ~300 LOC TypeScript{"\n"}• Solid-like reactivity core
                {"\n"}• DOMParser for XML parsing{"\n"}• No external dependencies{"\n"}• Full
                TypeScript support
              </text>
            </box>
            <box marginTop={1} padding={1} borderStyle="single" borderColor="magenta">
              <text color="magenta">
                🎯 Example Usage:{"\n"}
                {`const ctx = {
  ...signals(['name', 'count'], { name: 'World', count: 0 }),
  inc(){ this.set.count(v=>v+1) }
}

renderXML(\`
  <div>Hello {name()}!</div>
  <button on:click="inc">Clicked {count()}</button>
  <div x-if="count() % 2 === 0">Even 🎯</div>
\`, mountElement, ctx)`}
              </text>
            </box>
            <text marginTop={1} bold color="cyan">
              ✨ Library saved to: test-xml-runtime.ts
            </text>
          </box>
        )
      },
    },
  ],
} satisfies Plugin
