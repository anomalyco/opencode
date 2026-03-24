const EOL = "\n"

function inferPlatform(): NodeJS.Platform {
  const value = navigator.userAgent.toLowerCase()
  if (value.includes("windows")) return "win32"
  if (value.includes("mac os") || value.includes("macintosh")) return "darwin"
  if (value.includes("linux")) return "linux"
  return "linux"
}

function inferArch(): string {
  const value = navigator.userAgent.toLowerCase()
  if (value.includes("arm64") || value.includes("aarch64")) return "arm64"
  if (value.includes("x86_64") || value.includes("win64") || value.includes("x64")) return "x64"
  return "x64"
}

const platformValue = inferPlatform()
const archValue = inferArch()
const homeValue = "/home/user"
const tmpValue = "/tmp"

function homedir(): string {
  return homeValue
}

function tmpdir(): string {
  return tmpValue
}

function platform(): NodeJS.Platform {
  return platformValue
}

function release(): string {
  return "browser"
}

function arch(): string {
  return archValue
}

function userInfo(): { username: string; homedir: string; shell: string; uid: number; gid: number } {
  return {
    username: "browser",
    homedir: homeValue,
    shell: "/bin/sh",
    uid: 1000,
    gid: 1000,
  }
}

function networkInterfaces(): NodeJS.Dict<NodeJS.NetworkInterfaceInfo[]> {
  return {}
}

const browserOs = {
  EOL,
  arch,
  homedir,
  networkInterfaces,
  platform,
  release,
  tmpdir,
  userInfo,
}

export { EOL, arch, homedir, networkInterfaces, platform, release, tmpdir, userInfo }
export default browserOs
