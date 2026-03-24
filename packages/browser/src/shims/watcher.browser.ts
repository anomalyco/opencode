// Stub for file watching (not needed in browser)
export function watch() { return { close() {} } }
export function subscribe() { return Promise.resolve({ close() {} }) }
export default { watch, subscribe }
