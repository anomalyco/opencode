import { Wordmark } from "./wordmark"

export default {
  title: "UI/Wordmark",
  id: "ui-wordmark",
  component: Wordmark,
  tags: ["autodocs"],
}

export const Basic = {
  render: () => (
    <div style={{ width: "360px", color: "var(--text-base)" }}>
      <Wordmark />
    </div>
  ),
}
