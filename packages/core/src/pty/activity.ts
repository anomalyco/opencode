import { InstanceActivity } from "../instance-activity"

export function identify(directory: string) {
  return InstanceActivity.identify(directory)
}

export function started(identity: InstanceActivity.Identity) {
  InstanceActivity.ptyStarted(identity)
}

export function stopped(identity: InstanceActivity.Identity) {
  InstanceActivity.ptyStopped(identity)
}

export function hasRunning(directory: string) {
  const identity = identify(directory)
  return InstanceActivity.hasRunningPty(identity)
}

export * as PtyActivity from "./activity"
