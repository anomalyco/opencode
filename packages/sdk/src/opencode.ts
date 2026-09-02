import { PromiseSdk } from "./promise"

export type { LogEntry, LogLevel, LogOptions, LogWriter } from "./logging"

export type CreateOptions = PromiseSdk.CreateOptions
export type Interface = PromiseSdk.Interface
export type SessionClient = PromiseSdk.SessionClient

export const create = (options: CreateOptions = {}) => PromiseSdk.create(options)
