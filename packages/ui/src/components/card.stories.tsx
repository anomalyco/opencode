// @ts-nocheck
/** @jsxImportSource solid-js */
import { Card } from "./card"
import { Button } from "./button"

export default {
  title: "UI/Card",
  component: Card,
  args: {
    variant: "normal",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["normal", "error", "warning", "success", "info"],
    },
  },
  render: (props: { variant?: "normal" | "error" | "warning" | "success" | "info" }) => {
    return (
      <Card variant={props.variant}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>Card title</div>
            <div style={{ color: "var(--text-weak)", fontSize: "13px" }}>Small supporting text.</div>
          </div>
          <Button size="small" variant="ghost">
            Action
          </Button>
        </div>
      </Card>
    )
  },
}

export const Normal = {}

export const Error = {
  args: {
    variant: "error",
  },
}
