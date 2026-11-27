import { NavigationLab } from "./navigation-lab"

type Args = { width: number }

export default {
  title: "App/Desktop/Project sidebar",
  id: "app-desktop-project-sidebar",
  args: { width: 304 },
  argTypes: { width: { control: { type: "range", min: 192, max: 480, step: 8 } } },
}

export const ProjectGroups = { render: (args: Args) => <NavigationLab preset="projects" width={args.width} /> }

export const CollapsedCurrentProject = {
  render: (args: Args) => <NavigationLab preset="collapsed" width={args.width} />,
}
