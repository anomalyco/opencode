import { statfsSync } from "node:fs"

const NETWORK_FILESYSTEM_TYPES = new Set([
  0x0000517b, // SMB
  0x01021997, // 9P
  0x65735546, // FUSE (including VirtioFS and SSHFS)
  0x00006969, // NFS
  0xff534d42, // CIFS
])

export function isNetworkFilesystemType(type: number) {
  return NETWORK_FILESYSTEM_TYPES.has(type >>> 0)
}

export function isNetworkFilesystem(filename: string) {
  return isNetworkFilesystemType(statfsSync(filename).type)
}
