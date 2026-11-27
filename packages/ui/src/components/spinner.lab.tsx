import { Spinner } from "./spinner"

const docs = `### Overview
Dot-matrix indicator for AI activity: a running session, turn, subagent or tool. Busy session tabs, \`ActivityRing\`
and the session progress indicator render it. Other loading states use \`Loader\`.

### Variants and states
- Soft Radar: a lit head sweeps each ring of a 5×5 grid, leaving a fading trail, around a steady centre.

### Behavior
- One element painted through a CSS mask whose frames are a pre-rendered 90 fps APNG, so it runs no CSS animation and
  every spinner on screen shares one loop and stays in phase.
- Reduced motion freezes it on a still pose.

### Accessibility
- Use alongside text or aria-live regions to convey loading state.
`

type Args = { size: number }

export default {
  title: "UI/Spinner",
  id: "components-spinner",
  component: Spinner,
  tags: ["autodocs"],
  args: { size: 16 },
  argTypes: {
    size: { control: { type: "range", min: 12, max: 48, step: 1 } },
  },
  render: (args: Args) => <Spinner style={{ width: `${args.size}px`, height: `${args.size}px` }} />,
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const SoftRadar = {}
