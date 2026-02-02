/** @jsxImportSource react */
// Ink files use React JSX. Run with: bun --no-plugins
// Tests work normally via bun test (ink-testing-library mocks React)

export { App } from "./App"
export { theme } from "./theme"
export * from "./state/types"
export { appReducer, initialState, type Action } from "./state/reducer"
