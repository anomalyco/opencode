import { createContext, useContext, type Accessor } from "solid-js"

// Work Mode context for session-ui.
//
// The app's settings store owns the workMode flag, but session-ui components
// (message-part.tsx) need to read it to swap tool labels. We bridge the two
// with a lightweight SolidJS context so session-ui never imports from the app
// package. The provider is mounted in work-mode-sync.tsx.

const WorkModeContext = createContext<Accessor<boolean>>()

export function WorkModeProvider(props: { value: Accessor<boolean>; children: any }) {
  return <WorkModeContext.Provider value={props.value}>{props.children}</WorkModeContext.Provider>
}

export function useWorkMode(): Accessor<boolean> | undefined {
  return useContext(WorkModeContext)
}
