/**
 * Re-export DurableObject from cloudflare:workers
 * This allows tests to mock this module instead of the special cloudflare:workers import
 */
export { DurableObject } from "cloudflare:workers"
