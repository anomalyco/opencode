/**
 * SSH Desktop Connectivity Module
 *
 * Provides SSH tunnel management for connecting to remote OpenCode servers.
 * Implements explicit security model with bounded error classification and
 * formal diagnostics redaction.
 *
 * Phase A: Core SSH Infrastructure
 * - Tunnel invocation builder (buildTunnel, buildBootstrap)
 * - Port allocation with collision retry
 * - Tunnel manager orchestration
 * - Process lifecycle management
 * - Error classification system (Phase B)
 * - Diagnostics redaction (Phase E)
 */

export { SshInvocationBuilder, sshBuilder } from "./invocation-builder"
export { allocatePort } from "./port-allocator"
export type { PortAllocation, PortAllocationError, PortAllocatorConfig } from "./port-allocator"
export { SshTunnelManager, sshTunnelManager } from "./tunnel-manager"
export type { TunnelConfig, TunnelCreationResult, TunnelCreationError } from "./tunnel-manager"
export { ProcessManager, processManager } from "./process-manager"
export type { ProcessState, ProcessHandle, ProcessManagerOptions, SpawnResult, SpawnError } from "./process-manager"
export type {
  SshConfigMode,
  SshTunnelHandle,
  SshInvocationParams,
  SshCommandResult,
  SshErrorBucket,
  SshError,
} from "./types"
export { classifySshError } from "./error-classifier"
export { discoverServer } from "./server-discovery"
export type {
  ServerHealthInfo,
  ServerDiscoveryConfig,
  ServerDiscoveryResult,
  ServerDiscoveryError,
} from "./server-discovery"
export { createTunnelConnection } from "./tunnel-connection"
export type {
  TunnelProcess,
  TunnelSpawnResult,
  TunnelSpawnError,
  TunnelSpawner,
  TunnelConnectionConfig,
  TunnelConnectionResult,
  TunnelConnectionError,
} from "./tunnel-connection"
export { ProfileManager } from "./profile-manager"
export type { ConnectionProfile, ProfileManagerError } from "./profile-manager"
export { ConnectionManager, ConnectionState } from "./connection-manager"
export type { Connection, ConnectionError } from "./connection-manager"
export { parseSshConfig, listSshConfigHosts } from "./ssh-config"
export type { SshConfigHost, SshConfigParseResult, SshConfigParseError } from "./ssh-config"
export { ReconnectionManager } from "./reconnection-manager"
export type { ReconnectionConfig, ReconnectionAttempt } from "./reconnection-manager"
export { HealthMonitor } from "./health-monitor"
export type { HealthCheckConfig, HealthCheckResult, HealthStatusListener } from "./health-monitor"
export { getRecoverySuggestions, formatRecoveryMessage } from "./error-recovery"
export type { RecoverySuggestion, ErrorRecoveryInfo } from "./error-recovery"
export { exportDiagnostics, verifyRedaction, copyDiagnostics } from "./diagnostics"
export type { DiagnosticExport } from "./diagnostics"
