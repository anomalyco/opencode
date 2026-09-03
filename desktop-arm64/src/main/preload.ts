import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(channel, ...args);

const api = {
  getState: () => invoke("state:init"),
  setConfig: (patch: unknown) => invoke("config:set", patch),
  chooseWorkspace: () => invoke("workspace:choose"),
  newSession: () => invoke("session:new"),
  listSessions: () => invoke("sessions:list"),
  send: (text: string) => invoke("chat:send", text),
  stop: () => invoke("chat:stop"),
  approve: (id: string, allowed: boolean) =>
    invoke("approval:respond", id, allowed),
  openExternal: (url: string) => invoke("shell:openExternal", url),

  onAgentEvent: (cb: (event: unknown) => void): (() => void) => {
    const listener = (_e: unknown, event: unknown) => cb(event);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  onApprovalRequest: (cb: (prompt: unknown) => void): (() => void) => {
    const listener = (_e: unknown, prompt: unknown) => cb(prompt);
    ipcRenderer.on("approval:request", listener);
    return () => ipcRenderer.removeListener("approval:request", listener);
  },
  onWorkspaceChanged: (cb: (info: unknown) => void): (() => void) => {
    const listener = (_e: unknown, info: unknown) => cb(info);
    ipcRenderer.on("workspace:changed", listener);
    return () => ipcRenderer.removeListener("workspace:changed", listener);
  },
};

contextBridge.exposeInMainWorld("opencode", api);
