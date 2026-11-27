import type { JsonValue } from "@opencode/client"
import { builtins } from "@opencode/widget"
import type { WidgetInfo } from "../../../component/widget/backend"

export const widgetFixtures: Record<
  "suggestions" | "form" | "confirm" | "chart" | "backdrop",
  { title: string; data: JsonValue; response: JsonValue }
> = {
  suggestions: {
    title: "Pick a cabin for the offsite",
    data: {
      title: "Which cabin should we book?",
      options: [
        {
          label: "Lakeside",
          note: "Sleeps 12, dock and sauna",
          images: ["https://example.com/cabins/lakeside-front.jpg", "https://example.com/cabins/lakeside-dock.jpg"],
          recommended: true,
        },
        {
          label: "Forest loft",
          note: "Sleeps 10, wood stove",
          images: [
            "images/forest-loft.png",
            "https://example.com/cabins/forest-interior.jpg",
            "https://example.com/cabins/forest-view.jpg",
          ],
        },
        { label: "Ridge house", images: ["https://example.com/cabins/ridge.jpg"] },
      ],
    },
    response: { choice: "Lakeside", index: 0, note: "Book the sauna too" },
  },
  form: {
    title: "Release settings",
    data: {
      title: "Configure the release",
      description: "Pick how the **2.4** release should roll out.",
      submitLabel: "Start release",
      fields: [
        { key: "name", type: "text", label: "Release name", placeholder: "e.g. Spring update" },
        { key: "rollout", type: "number", label: "Rollout percentage", min: 0, max: 100, step: 5, default: 25 },
        { key: "notify", type: "boolean", label: "Notify subscribers", default: true },
        {
          key: "channel",
          type: "select",
          label: "Channel",
          options: [
            { value: "stable", label: "Stable" },
            { value: "beta", label: "Beta" },
            { value: "nightly", label: "Nightly" },
          ],
        },
        {
          key: "platforms",
          type: "select",
          label: "Platforms",
          multiple: true,
          options: [
            { value: "mac", label: "macOS" },
            { value: "linux", label: "Linux" },
            { value: "windows", label: "Windows" },
          ],
          default: ["mac", "linux"],
        },
      ],
    },
    response: {
      name: "Spring update",
      rollout: 50,
      notify: true,
      channel: "beta",
      platforms: ["mac", "linux"],
    },
  },
  confirm: {
    title: "Delete branch",
    data: {
      title: "Delete the release branch?",
      message: "This removes `release/2.3` locally and on the remote.",
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
      danger: true,
    },
    response: { confirmed: true },
  },
  chart: {
    title: "Weekly signups",
    data: {
      title: "Weekly signups",
      kind: "bar",
      unit: "k",
      choose: true,
      labels: ["W1", "W2", "W3", "W4"],
      series: [
        { label: "Organic", values: [4.2, 5.1, 4.8, 6.3] },
        { label: "Paid", values: [2, 2.4, 3.1, 2.9] },
      ],
    },
    response: { series: "Organic", index: 3, value: 6.3 },
  },
  backdrop: {
    title: "Launch",
    data: { title: "v2 is live", preset: "aurora", text: "Thanks **everyone** who tested the beta." },
    response: null,
  },
}

export type WidgetFixtureName = keyof typeof widgetFixtures

export function widgetFixtureMessage(
  name: WidgetFixtureName,
  status: WidgetInfo["status"] = "open",
  id = `msg_widget_${name}`,
): WidgetInfo {
  const fixture = widgetFixtures[name]
  const widgetTemplate = builtins.find((item) => item.name === name)
  if (!widgetTemplate) throw new Error(`Unknown built-in widget template: ${name}`)
  return {
    id: `${id}:call_widget`,
    sessionID: "ses_widget_story",
    messageID: id,
    callID: "call_widget",
    title: fixture.title,
    widgetTemplate: { name: widgetTemplate.name, version: widgetTemplate.version },
    data: fixture.data,
    status,
    wait: false,
    ...(status === "submitted" ? { response: fixture.response } : {}),
  }
}
