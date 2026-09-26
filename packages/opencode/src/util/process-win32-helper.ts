import { dlopen, ptr } from "bun:ffi"
import path from "node:path"

const CREATE_SUSPENDED = 0x00000004
const EXTENDED_STARTUPINFO_PRESENT = 0x00080000
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
const JobObjectExtendedLimitInformation = 9
const PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000d
const STARTF_USESTDHANDLES = 0x00000100
const WAIT_OBJECT_0 = 0
const INFINITE = 0xffffffff
const INVALID_THREAD_RETURN = 0xffffffff
const ERROR_INSUFFICIENT_BUFFER = 122
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g

const kernel = dlopen("kernel32.dll", {
  CreateJobObjectW: { args: ["ptr", "ptr"], returns: "u64" },
  SetInformationJobObject: { args: ["u64", "i32", "ptr", "u32"], returns: "i32" },
  InitializeProcThreadAttributeList: { args: ["ptr", "u32", "u32", "ptr"], returns: "i32" },
  UpdateProcThreadAttribute: { args: ["ptr", "u32", "u64", "ptr", "u64", "ptr", "ptr"], returns: "i32" },
  DeleteProcThreadAttributeList: { args: ["ptr"], returns: "void" },
  SearchPathW: { args: ["ptr", "ptr", "ptr", "u32", "ptr", "ptr"], returns: "u32" },
  CreateProcessW: {
    args: ["ptr", "ptr", "ptr", "ptr", "i32", "u32", "ptr", "ptr", "ptr", "ptr"],
    returns: "i32",
  },
  ResumeThread: { args: ["u64"], returns: "u32" },
  WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
  GetExitCodeProcess: { args: ["u64", "ptr"], returns: "i32" },
  GetStdHandle: { args: ["i32"], returns: "u64" },
  CloseHandle: { args: ["u64"], returns: "i32" },
  GetLastError: { args: [], returns: "u32" },
})

let job = 0n
let processHandle = 0n
let threadHandle = 0n
let attributes: BigUint64Array | undefined
let attributesInitialized = false
let exitCode = 1

try {
  const request = JSON.parse(Buffer.from(process.argv.at(-1) ?? "", "base64").toString("utf8")) as {
    cmd: string[]
  }
  if (request.cmd.length === 0) throw new Error("Command is required")

  job = kernel.symbols.CreateJobObjectW(null, null)
  if (job === 0n) throw win32Error("CreateJobObjectW")

  const limits = new Uint8Array(144)
  new DataView(limits.buffer).setUint32(16, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, true)
  if (kernel.symbols.SetInformationJobObject(job, JobObjectExtendedLimitInformation, limits, limits.byteLength) === 0) {
    throw win32Error("SetInformationJobObject")
  }

  const size = new BigUint64Array(1)
  if (
    kernel.symbols.InitializeProcThreadAttributeList(null, 1, 0, size) !== 0 ||
    kernel.symbols.GetLastError() !== ERROR_INSUFFICIENT_BUFFER
  ) {
    throw win32Error("InitializeProcThreadAttributeList")
  }
  attributes = new BigUint64Array(Math.ceil(Number(size[0]) / BigUint64Array.BYTES_PER_ELEMENT))
  if (kernel.symbols.InitializeProcThreadAttributeList(attributes, 1, 0, size) === 0) {
    throw win32Error("InitializeProcThreadAttributeList")
  }
  attributesInitialized = true

  const jobs = new BigUint64Array([job])
  if (
    kernel.symbols.UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, jobs, 8n, null, null) === 0
  ) {
    throw win32Error("UpdateProcThreadAttribute")
  }

  const startup = startupInfo(attributes)
  const processInfo = new Uint8Array(24)
  const command = commandLine(request.cmd)
  if (
    kernel.symbols.CreateProcessW(
      wide(command.applicationName),
      wide(command.commandLine),
      null,
      null,
      1,
      CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT,
      null,
      null,
      startup,
      processInfo,
    ) === 0
  ) {
    throw win32Error("CreateProcessW")
  }

  const info = new DataView(processInfo.buffer)
  processHandle = info.getBigUint64(0, true)
  threadHandle = info.getBigUint64(8, true)

  if (kernel.symbols.ResumeThread(threadHandle) === INVALID_THREAD_RETURN) throw win32Error("ResumeThread")
  if (kernel.symbols.WaitForSingleObject(processHandle, INFINITE) !== WAIT_OBJECT_0) {
    throw win32Error("WaitForSingleObject")
  }

  const code = new Uint32Array(1)
  if (kernel.symbols.GetExitCodeProcess(processHandle, code) === 0) throw win32Error("GetExitCodeProcess")
  exitCode = code[0]
} catch (error) {
  console.error(`opencode-process-win32: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  close(threadHandle)
  close(processHandle)
  if (attributes && attributesInitialized) kernel.symbols.DeleteProcThreadAttributeList(attributes)
  close(job)
}

process.exit(exitCode)

function startupInfo(attributes: BigUint64Array) {
  const info = new Uint8Array(112)
  const view = new DataView(info.buffer)
  view.setUint32(0, info.byteLength, true)
  view.setUint32(60, STARTF_USESTDHANDLES, true)
  view.setBigUint64(80, kernel.symbols.GetStdHandle(-10), true)
  view.setBigUint64(88, kernel.symbols.GetStdHandle(-11), true)
  view.setBigUint64(96, kernel.symbols.GetStdHandle(-12), true)
  view.setBigUint64(104, BigInt(ptr(attributes)), true)
  return info
}

function commandLine(cmd: string[]) {
  const executable = resolveExecutable(cmd[0])
  if (/\.(cmd|bat)$/i.test(executable)) return cmdCommand([executable, ...cmd.slice(1)])
  return {
    applicationName: executable,
    commandLine: [executable, ...cmd.slice(1)].map(quote).join(" "),
  }
}

function cmdCommand(cmd: string[]) {
  const executable = resolveExecutable(process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(cmd[0])
  const command = [escapeCmdCommand(cmd[0]), ...cmd.slice(1).map((arg) => escapeCmdArgument(arg, doubleEscape))].join(
    " ",
  )
  return {
    applicationName: executable,
    commandLine: [quote(executable), "/d", "/v:off", "/s", "/c", `"${command}"`].join(" "),
  }
}

function escapeCmdCommand(value: string) {
  return value.replace(CMD_META_CHARS, "^$1")
}

function escapeCmdArgument(value: string, doubleEscape: boolean) {
  const escaped = quote(value).replace(CMD_META_CHARS, "^$1")
  if (!doubleEscape) return escaped
  return escaped.replace(CMD_META_CHARS, "^$1")
}

function resolveExecutable(command: string) {
  const explicit = /^[a-z]:/i.test(command) || /[\\/]/.test(command)
  const file = explicit ? path.win32.basename(path.win32.resolve(process.cwd(), command)) : command
  const searchPath = explicit ? path.win32.dirname(path.win32.resolve(process.cwd(), command)) : trustedPath()
  const extensions = path.win32.extname(file) ? [undefined] : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
  for (const extension of extensions) {
    const result = searchPathW(searchPath, file, extension)
    if (result) return result
  }
  throw win32Error("SearchPathW")
}

function trustedPath() {
  const cwd = path.win32.resolve(process.cwd()).toLowerCase()
  const entries = (process.env.PATH ?? process.env.Path ?? "")
    .split(";")
    .filter((entry) => path.win32.isAbsolute(entry) && path.win32.resolve(entry).toLowerCase() !== cwd)
  if (entries.length === 0) throw new Error("PATH does not contain an absolute executable directory")
  return entries.join(";")
}

function searchPathW(searchPath: string, file: string, extension: string | undefined) {
  const output = new Uint16Array(32768)
  const length = kernel.symbols.SearchPathW(
    wide(searchPath),
    wide(file),
    extension ? wide(extension) : null,
    output.length,
    output,
    null,
  )
  if (length === 0) return
  if (length >= output.length) throw new Error("Executable path exceeds Windows maximum path length")
  return Buffer.from(output.buffer, 0, length * Uint16Array.BYTES_PER_ELEMENT).toString("utf16le")
}

function quote(value: string) {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`
}

function wide(value: string) {
  return Buffer.from(value + "\0", "utf16le")
}

function close(handle: bigint) {
  if (handle !== 0n) kernel.symbols.CloseHandle(handle)
}

function win32Error(operation: string) {
  return new Error(`${operation} failed with error ${kernel.symbols.GetLastError()}`)
}
