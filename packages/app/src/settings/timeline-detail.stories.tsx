import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { timelinePresets, type TimelineDetail } from "@opencode-ai/session-ui/timeline/detail"
import { SettingsList } from "./list"
import { TimelineDetailControl } from "./timeline-detail"
import "./settings.css"

export default {
  title: "OpenCode/Settings/Timeline detail",
  id: "settings-timeline-detail",
}

export const Interactive = {
  render: () => {
    const [state, setState] = createStore<{ value: TimelineDetail }>({
      value: structuredClone(timelinePresets[2].value),
    })

    return (
      <div class="flex w-[560px] max-w-full flex-col gap-4">
        <SettingsList>
          <div class="py-5">
            <TimelineDetailControl value={state.value} onChange={(value) => setState("value", value)} />
          </div>
        </SettingsList>
        <Button onClick={() => setState("value", structuredClone(timelinePresets[2].value))}>Reset</Button>
        <output data-slot="timeline-detail-fixture-value" hidden>
          {JSON.stringify(state.value)}
        </output>
      </div>
    )
  },
}
