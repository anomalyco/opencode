import { verificationUnavailable } from "./file-verification.js"

// workerd exposes no kernel path for a file descriptor.
export function handlePath(_fd: number) {
  return verificationUnavailable()
}
