export interface Config {
  port: number;
  opencodeUrl: string;
  opencodeDirectory?: string;
  opencodePassword?: string;
  heartbeatInterval: number;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.OBSERVER_PORT || "3210", 10),
    opencodeUrl: process.env.OPENCODE_URL || "http://localhost:4096",
    opencodeDirectory: process.env.OPENCODE_DIRECTORY,
    opencodePassword: process.env.OPENCODE_PASSWORD,
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || "30000", 10),
  };
}
