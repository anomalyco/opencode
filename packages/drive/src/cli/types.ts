import type { Frontend } from "../client/index.js"

export interface DriveCommand {
  readonly operation: Exclude<Frontend.Capability, "ui.click.semantic">
  readonly value?: string
}

export interface StartOptions {
  readonly kind: "start"
  readonly name: string
  readonly daemon: boolean
  readonly script?: string
  readonly visible: boolean
  readonly record: boolean
  readonly dev?: string
  readonly command: ReadonlyArray<string>
}

export interface SendOptions {
  readonly kind: "send"
  readonly name?: string
  readonly commands: ReadonlyArray<DriveCommand>
}

export type CliOptions = StartOptions | SendOptions
