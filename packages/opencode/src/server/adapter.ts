import type { Hono } from "hono"
import type { UpgradeWebSocket } from "hono/ws"

export type FetchApp = {
  fetch(request: Request): Response | Promise<Response>
}

export type Opts = {
  port: number
  hostname: string
}

export type Listener = {
  port: number
  stop: (close?: boolean) => Promise<void>
}

export interface Runtime {
  upgradeWebSocket: UpgradeWebSocket
  listen(opts: Opts): Promise<Listener>
}

export interface Adapter {
  create(app: Hono): Runtime
  createFetch(app: FetchApp): Omit<Runtime, "upgradeWebSocket">
}
