// @ts-nocheck
import * as mod from "./message-part"
import { create } from "../storybook/scaffold"
import { DataProvider } from "../context/data"
import { I18nProvider, type UiI18n } from "../context/i18n"
import { dict as en } from "../i18n/en"

const docs = `
### Overview
Display message parts including text, tools, and other content types.

Supports markdown, code highlighting, and various tool outputs.

### API
- Required: \`message\` object with role, time, and optional metadata.
- Required: \`parts\` array of part objects.
- Optional: \`showAssistantCopyPartID\`, \`interrupted\`, \`queued\`, \`showReasoningSummaries\`.

### Variants and states
- User vs assistant messages with different styling.
- Long text with scrolling behavior.
- Code blocks and markdown rendering.

### Behavior
- Text parts support markdown with syntax highlighting.
- Tool parts show command output with expandable details.
- Long text is constrained with scrollable containers.

### Accessibility
- Proper heading hierarchy and semantic structure.
- Keyboard navigation for interactive elements.

### Theming/tokens
- Uses \`data-component="message"\` and part-specific slots.

`

// Mock data for context providers
const mockData = {
  provider: {
    opencode: {
      id: "opencode",
      name: "OpenCode",
      models: {
        "gpt-4": { id: "gpt-4", name: "GPT-4" },
        "claude-3-opus": { id: "claude-3-opus", name: "Claude 3 Opus" },
      },
    },
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-3-opus": { id: "claude-3-opus", name: "Claude 3 Opus" },
      },
    },
  },
  session: [],
  session_status: {},
  session_diff: {},
  message: {},
  part: {},
}

const mockI18n: UiI18n = {
  locale: () => "en",
  t: (key, params) => {
    const value = en[key as keyof typeof en] ?? String(key)
    if (!params) return value
    return value.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey) => {
      const k = String(rawKey)
      return params[k] === undefined ? "" : String(params[k])
    })
  },
}

// Decorator to provide required contexts
const withContext = (Story) => {
  return (
    <DataProvider data={mockData} directory="/">
      <I18nProvider value={mockI18n}>
        <Story />
      </I18nProvider>
    </DataProvider>
  )
}

const story = create({
  title: "UI/MessagePart",
  mod,
  args: {
    message: {
      id: "msg_123",
      role: "assistant",
      time: {
        created: Date.now(),
      },
      model: {
        providerID: "opencode",
        modelID: "gpt-4",
      },
    },
    parts: [
      {
        id: "part_1",
        type: "text",
        text: "This is a sample message with **markdown** formatting and code blocks:\n\n```typescript\nconst example = 'hello world';\n```\n\nIt also supports lists and other features.",
      },
    ],
    showAssistantCopyPartID: null,
    interrupted: false,
    queued: false,
    showReasoningSummaries: true,
  },
})

export default {
  title: "UI/MessagePart",
  id: "components-message-part",
  component: story.meta.component,
  tags: ["autodocs"],
  decorators: [withContext],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

export const UserMessage = {
  render: () => (
    <mod.Message
      message={{
        id: "msg_user_1",
        role: "user",
        time: {
          created: Date.now(),
        },
      }}
      parts={[
        {
          id: "part_user_1",
          type: "text",
          text: "Can you help me write a function to sort an array in JavaScript?",
        },
      ]}
    />
  ),
}

export const AssistantResponse = {
  render: () => (
    <mod.Message
      message={{
        id: "msg_assistant_1",
        role: "assistant",
        agent: "claude",
        time: {
          created: Date.now(),
        },
        model: {
          providerID: "anthropic",
          modelID: "claude-3-opus",
        },
      }}
      parts={[
        {
          id: "part_assistant_1",
          type: "text",
          text: "I'll help you write a sorting function. Here's an example using the built-in sort method:\n\n```javascript\nconst arr = [3, 1, 4, 1, 5, 9, 2, 6];\narr.sort((a, b) => a - b);\nconsole.log(arr); // [1, 1, 2, 3, 4, 5, 6, 9]\n```\n\nThis sorts numbers in ascending order.",
        },
      ]}
    />
  ),
}

export const LongMessage = {
  render: () => (
    <mod.Message
      message={{
        id: "msg_long_1",
        role: "assistant",
        time: {
          created: Date.now(),
        },
      }}
      parts={[
        {
          id: "part_long_1",
          type: "text",
          text: Array.from(
            { length: 50 },
            (_, i) => `Line ${i + 1}: This is a long message to test scrolling behavior.`,
          ).join("\n\n"),
        },
      ]}
    />
  ),
}

export const CodeBlock = {
  render: () => (
    <mod.Message
      message={{
        id: "msg_code_1",
        role: "assistant",
        time: {
          created: Date.now(),
        },
      }}
      parts={[
        {
          id: "part_code_1",
          type: "text",
          text: "Here's a React component example:\n\n```tsx\nimport { createSignal } from 'solid-js';\n\nfunction Counter() {\n  const [count, setCount] = createSignal(0);\n  return (\n    <button onClick={() => setCount(count() + 1)}>\n      Count: {count()}\n    </button>\n  );\n}\n```",
        },
      ]}
    />
  ),
}
