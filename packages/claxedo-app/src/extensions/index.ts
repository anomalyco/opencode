/**
 * Claxedo Extensions
 *
 * This module exports all extension factories for the cloud functionality.
 * Extensions are registered with the OpenCode extension system to add
 * cloud features without modifying upstream files.
 */

export { appExtensions } from "./app"
export { serverExtensions } from "./server"
export { persistExtensions } from "./persist"
export { syncExtensions } from "./sync"
