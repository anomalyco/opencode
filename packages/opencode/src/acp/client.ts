import type {
  Client,
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalCommandRequest,
  KillTerminalResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk"
import { Log } from "../util/log"

export class ACPClient implements Client {
  private log = Log.create({ service: "acp-client" })

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    this.log.debug("requestPermission", params)
    const firstOption = params.options[0]
    if (!firstOption) {
      return { outcome: { outcome: "cancelled" } }
    }
    return {
      outcome: {
        outcome: "selected",
        optionId: firstOption.optionId,
      },
    }
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.log.debug("sessionUpdate", { sessionId: params.sessionId })
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    this.log.debug("writeTextFile", { path: params.path })
    await Bun.write(params.path, params.content)
    return { _meta: {} }
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    this.log.debug("readTextFile", { path: params.path })
    const file = Bun.file(params.path)
    const exists = await file.exists()
    if (!exists) {
      throw new Error(`File not found: ${params.path}`)
    }
    const content = await file.text()
    return { content, _meta: {} }
  }

  async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    this.log.debug("createTerminal", params)
    throw new Error("Terminal support not yet implemented")
  }

  async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    this.log.debug("terminalOutput", params)
    throw new Error("Terminal support not yet implemented")
  }

  async releaseTerminal(params: ReleaseTerminalRequest): Promise<void | ReleaseTerminalResponse> {
    this.log.debug("releaseTerminal", params)
    throw new Error("Terminal support not yet implemented")
  }

  async waitForTerminalExit(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    this.log.debug("waitForTerminalExit", params)
    throw new Error("Terminal support not yet implemented")
  }

  async killTerminal(params: KillTerminalCommandRequest): Promise<void | KillTerminalResponse> {
    this.log.debug("killTerminal", params)
    throw new Error("Terminal support not yet implemented")
  }
}
