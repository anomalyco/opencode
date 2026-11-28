import { NavigationLab } from "./navigation-lab"

type Args = { width: number }

export default {
  title: "App/Desktop/Session tab strip",
  id: "app-desktop-session-tab-strip",
  args: { width: 880 },
  argTypes: { width: { control: { type: "range", min: 240, max: 1440, step: 8 } } },
}

export const SessionsAndDraft = { render: (args: Args) => <NavigationLab preset="sessions" width={args.width} /> }

export const ActiveDraft = { render: (args: Args) => <NavigationLab preset="draft" width={args.width} /> }

export const Crowded = {
  args: { width: 600 },
  render: (args: Args) => <NavigationLab preset="crowded" width={args.width} />,
}
