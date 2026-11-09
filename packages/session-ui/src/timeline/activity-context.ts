import { createContext, useContext, type Accessor } from "solid-js"

const off = () => false

// Whether the rows below render for the Activity timeline experiment, for components deep in a row, such as a tool's
// diff, that change their look with it.
const ActivityTimelineContext = createContext<Accessor<boolean>>(off)

export const ActivityTimelineProvider = ActivityTimelineContext.Provider

export function useActivityTimeline() {
  return useContext(ActivityTimelineContext)
}
