export { ShodanClient } from "./src/client.js"
export { ShodanExploitsClient } from "./src/exploits.js"
export { ShodanStreamClient } from "./src/stream.js"
export { auditLog, buildAuditEntry } from "./src/audit.js"
export {
  assertPermission,
  ShodanPermissionDeniedError,
  HIGH_RISK_OPERATIONS,
  MODERATE_RISK_OPERATIONS,
} from "./src/permission-gate.js"
export type {
  ShodanHostInfo,
  ShodanBanner,
  ShodanVuln,
  ShodanSearchResult,
  ShodanSearchCount,
  ShodanDNSResult,
  ShodanExploit,
  ShodanExploitResult,
  ShodanAccountProfile,
  ShodanApiInfo,
  ShodanScanResult,
  ShodanClientOptions,
} from "./src/types.js"
