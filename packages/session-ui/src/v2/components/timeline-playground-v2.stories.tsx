import { TimelinePlayground } from "../../components/timeline-playground"

export default {
  title: "Playground/Timeline V2",
  id: "playground-timeline-v2",
  parameters: {
    layout: "fullscreen",
  },
}

export const Basic = {
  render: () => <TimelinePlayground version="v2" />,
}
