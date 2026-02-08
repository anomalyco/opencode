/**
 * Cloud Sandbox Abstraction
 * 
 * Represents a generic cloud development environment (Daytona, Cloudflare, etc.)
 */

export type ExecResult = { 
  code: number; 
  stdout: string; 
  stderr: string; 
};

export type ExecOptions = {
  cwd?: string;
  env?: Record<string, string>;
  timeoutSec?: number;
};

export type PtyOptions = {
  id: string;
  cols: number;
  rows: number;
  cwd?: string;
  env?: Record<string, string>;
  onData: (data: Uint8Array) => void;
};

export interface PtyHandle {
  sendInput(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  kill(): Promise<void>;
  waitForConnection(): Promise<void>;
}

export interface CloudSandbox {
  readonly id: string;
  readonly provider: string;

  /**
   * Ensure the sandbox is created and running.
   */
  ensureRunning(): Promise<void>;

  /**
   * Execute a command in the sandbox.
   */
  exec(cmd: string, options?: ExecOptions): Promise<ExecResult>;

  /**
   * Spawn a PTY (Pseudo Terminal).
   */
  spawnPty(options: PtyOptions): Promise<PtyHandle>;

  /**
   * Get the internal URL for a service running on a specific port.
   * This might be a detailed internal IP or a public URL depending on the provider.
   */
  getServiceUrl(port: number): Promise<string>;

  /**
   * Prepare a git repository in the sandbox.
   */
  ensureRepo(repoUrl: string, targetDir: string): Promise<void>;

  /**
   * Destroy the sandbox and release all resources.
   */
  destroy(): Promise<void>;
}

export interface SandboxProvider {
  create(params: { orgId: string; sessionId: string }): CloudSandbox;
}
