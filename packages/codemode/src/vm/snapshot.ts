import packageJson from "../../package.json" with { type: "json" }
import type { Interruption } from "./runtime/signals.js"
import { staticNames, unchanged } from "./runtime/intrinsic-names.js"
import { Fn, Obj } from "./runtime/objects.js"
import { nodeId, type Source } from "./runtime/source.js"
import { type ClassSpec, codecShape, decode, encode, type Json, SnapshotError } from "./snapshot/codec.js"
import { FORMAT, hash, hostsId, type Snapshot, validate } from "./snapshot/snapshot.js"
import { AsyncFromSyncCloseTarget, FinallyTarget, VmScheduler } from "./async.js"
import { Code, hashOf } from "./code.js"
import { COMPILER_VERSION, compileSource } from "./compiler/compile.js"
import { HostCalls } from "./host.js"
import { getInternalPrelude } from "./internal-prelude.js"
import { compiledPrelude } from "./prelude/prelude.js"
import { Cell, CodeFlags, EMPTY_CELLS, HOLE, Op } from "./opcodes.js"
import { CustomIter, Frame, Mode, Vm, VmInternalFn } from "./vm.js"

// Snapshots of the bytecode VM (plan §6): the generic graph codec, plus records for the VM's own classes.
//
// - **Code is never saved.** A function's code is `["x", ["code", source, index]]`; restore recompiles every saved
//   source eagerly and refuses one whose bytecode hash differs from the saved one, so a pc always means the same
//   instruction. The prelude and the VM's internal helpers are named by the build id, which hashes their bytecode.
// - **A frame** saves its registers up to `sp` (locals, then the live operand stack), its function, pc, mode and the
//   promise or generator it settles. Restore checks it against its code before anything runs (§6.5).
// - **The VM's internal callables** (`$` intrinsics, internal helpers) are named, never copied.
// - New VM state must be listed in the `Vm` spec: an unknown own field is a codec gap, so nothing is silently dropped.

export type CaptureOptions = {
  /** Throw on the first value with no data form, instead of reporting it in `lost`. */
  readonly strict: boolean
}

export type RestoreOptions = {
  /** Parses a saved program source (cached by text). */
  readonly parse: (code: string) => Source
  readonly interruption: () => Interruption
}

let specs: ReadonlyArray<ClassSpec> | undefined

// Built on first use: this module and vm.ts import each other, so the classes aren't there at load time.
const vmSpecs = (): ReadonlyArray<ClassSpec> =>
  (specs ??= [
    {
      name: "Vm",
      ctor: Vm,
      anchor: "vm",
      fields: ["frames", "templates", "scheduler", "hosts", "depth", "sliced", "outcome"],
      skip: ["ctx", "pool", "sourceCodes", "intrinsics", "fuel", "sliceStart", "tripEvery"],
      reset: restoreStack,
    },
    {
      name: "VmScheduler",
      ctor: VmScheduler,
      anchor: "scheduler",
      fields: ["intrinsicThen", "parked", "queue", "head", "pending", "nextID", "unhandled"],
      skip: ["vm"],
    },
    {
      name: "HostCalls",
      ctor: HostCalls,
      anchor: "hosts",
      fields: ["queued", "running", "inbox", "nextID", "blocked", "input"],
      skip: ["ctx", "promises", "extension", "extensionResume"],
    },
    {
      name: "Frame",
      ctor: Frame,
      fields: ["fn", "code", "pc", "sp", "regs", "thisValue", "args", "mode", "target", "answer", "origin", "counted"],
      view: (frame: Frame) => [
        frame.fn,
        frame.code,
        frame.pc,
        frame.sp,
        frame.regs.slice(0, frame.sp),
        frame.thisValue,
        frame.args,
        frame.mode,
        frame.target,
        frame.answer,
        frame.origin,
        frame.counted,
      ],
      reset: restoreFrame,
    },
    {
      name: "Fn",
      ctor: Fn,
      fields: ["code", "cells"],
      skip: ["length"],
      obj: true,
      constants: { tag: "Function" },
      reset: restoreFn,
    },
    { name: "VmInternalFn", ctor: VmInternalFn, fields: ["code", "boundArgs"] },
    { name: "FinallyTarget", ctor: FinallyTarget, fields: ["vm", "made", "site", "outcome"] },
    { name: "AsyncFromSyncCloseTarget", ctor: AsyncFromSyncCloseTarget, fields: ["made", "reason"] },
    { name: "Cell", ctor: Cell, fields: ["v"] },
    { name: "CustomIter", ctor: CustomIter, fields: ["done", "rawGen", "iterator", "next"] },
  ])

let build: string | undefined

/**
 * The VM build a snapshot belongs to: the package version, and a hash of the format, the opcode table, the frame
 * modes, the compiler version, the prelude's and the internal helpers' bytecode, the static intrinsic names, and the
 * codec's shape. A runtime must have been made first (the intrinsic names come from it).
 */
export const buildId = (): string =>
  (build ??= `${packageJson.version}+${hash(
    [
      FORMAT,
      JSON.stringify(Object.entries(Op)),
      JSON.stringify(Object.entries(Mode)),
      COMPILER_VERSION,
      hashOf(compiledPrelude().codes),
      hashOf(getInternalPrelude().codes),
      staticNames().join("\n"),
      codecShape(vmSpecs()),
    ].join("\n"),
  )}`)

/** Saves a VM's state as it is now, with every built-in or host global the run changed. Changes nothing. */
export const captureVm = (
  vm: Vm,
  options: CaptureOptions,
): { readonly snapshot: Snapshot; readonly lost: ReadonlyArray<string> } => {
  vm.compact()
  const ctx = vm.ctx
  const lost: Array<string> = []
  const names = ctx.intrinsics
  const programs = [...ctx.sources.values()]
  const sources = sourcesOf(vm)
  const anchors = new Map(anchorsOf(vm))
  const internals = new Map<unknown, string>()
  for (const [name, value] of vm.intrinsics) if (!(value instanceof Obj)) internals.set(value, name)
  const encoded = encode([vm, ctx, ctx.globalScope, ...names.changed()], {
    nameOf: (value) => names.nameOf(value),
    unchanged,
    anchorOf: (value) => anchors.get(value),
    nodeId: (node) => {
      const id = nodeId(node)
      return id !== undefined && sources.get(id.source)?.nodes[id.index] === node ? [id.source, id.index] : undefined
    },
    lost,
    strict: options.strict,
    specs: vmSpecs(),
    external: (value): Json | undefined => {
      if (value === HOLE) return "hole"
      if (typeof value === "symbol" || value instanceof Obj) return undefined
      const internal = internals.get(value)
      if (internal !== undefined) return ["intrinsic", internal]
      return codeRef(vm, value)
    },
  })
  const snapshot: Snapshot = {
    format: FORMAT,
    header: {
      build: buildId(),
      hosts: hostsId(ctx),
      sources: programs.map((source) => ({
        id: source.id,
        code: source.code,
        hash: hash(source.code),
        bytecode: vm.sourceCodes.get(source.id)![0]!.source.hash,
      })),
      toolCalls: ctx.tools.calls.map((call) => ({ name: call.name })),
    },
    roots: encoded.roots,
    records: encoded.records,
  }
  return { snapshot, lost }
}

/**
 * Restores a saved state into `vm`, a fresh one made for a new runtime with the same host globals and no bindings,
 * after checking the snapshot belongs to this build, these host globals, its own sources and their bytecode.
 */
export const restoreVm = (vm: Vm, saved: unknown, options: RestoreOptions): Snapshot => {
  const snapshot = validate(saved)
  const header = snapshot.header
  const ctx = vm.ctx
  const expected = buildId()
  if (snapshot.format !== FORMAT || header.build !== expected) {
    throw new SnapshotError(
      `This state was saved by another Code Mode build (${header.build}); this runtime is ${expected}, so it can't resume it.`,
    )
  }
  if (header.hosts !== hostsId(ctx)) {
    throw new SnapshotError(
      "This state was saved by a runtime with other host globals (extensions); resume it with the same ones.",
    )
  }
  for (const source of header.sources) {
    if (hash(source.code) !== source.hash) throw new SnapshotError(`Source ${source.id} does not match its hash.`)
    const parsed = options.parse(source.code)
    if (parsed.id !== source.id || vm.sourceCodes.has(source.id)) {
      throw new SnapshotError(`Source ${source.id} is not a program source.`)
    }
    const codes = compileSource(parsed)
    if (codes[0]!.source.hash !== source.bytecode) {
      throw new SnapshotError(`Source ${source.id} compiles to other bytecode in this build, so it can't resume.`)
    }
    ctx.sources.set(source.id, parsed)
    vm.sourceCodes.set(source.id, codes)
  }
  const sources = sourcesOf(vm)
  const anchors = new Map(anchorsOf(vm).map(([object, name]) => [name, object]))
  decode(snapshot, {
    named: (name) => ctx.intrinsics.valueOf(name),
    anchor: (name) => anchors.get(name),
    node: (source, index) => sources.get(source)?.nodes[index],
    interruption: options.interruption,
    specs: vmSpecs(),
    external: (data) => {
      if (data === "hole") return HOLE
      if (!Array.isArray(data)) return undefined
      if (data[0] === "intrinsic" && typeof data[1] === "string") {
        const value = vm.intrinsics.get(data[1])
        return value instanceof Obj ? undefined : value
      }
      if (data[0] === "code" && typeof data[1] === "string" && typeof data[2] === "number") {
        return vm.sourceCodes.get(data[1])?.[data[2]]
      }
      return undefined
    },
  })
  ctx.tools.calls.push(...header.toolCalls.map((call) => ({ name: call.name })))
  return snapshot
}

// --- Helpers ---

// The objects a fresh runtime already has, saved by name and filled in place on restore.
const anchorsOf = (vm: Vm): ReadonlyArray<readonly [object, string]> => [
  [vm, "vm"],
  [vm.scheduler, "scheduler"],
  [vm.hosts, "hosts"],
  [vm.ctx, "ctx"],
  [vm.ctx.globalScope, "globals"],
]

// Every source a saved node can belong to: the programs, and the prelude's and the internal helpers' sources.
const sourcesOf = (vm: Vm): Map<string, Source> => {
  const sources = new Map(vm.ctx.sources)
  for (const codes of vm.sourceCodes.values()) {
    const source = codes[0]?.sourceObj
    if (source !== undefined) sources.set(source.id, source)
  }
  return sources
}

const codeRef = (vm: Vm, code: object): Json | undefined => {
  if (!(code instanceof Code)) return undefined
  if (vm.sourceCodes.get(code.source.id)?.[code.index] !== code) {
    throw new SnapshotError(`Codec gap: function ${code.index} of ${code.source.id} is not this run's code.`)
  }
  return ["code", code.source.id, code.index]
}

const invalid = (message: string): never => {
  throw new SnapshotError(`Invalid snapshot: ${message}`)
}

// A frame as saved, checked against its code before anything runs (§6.5): pc on an instruction, sp within the
// frame's registers, holes only in locals, finally tags in range, a mode it can complete by. Then its registers are
// padded to the code's size and its cells taken from its function.
function restoreFrame(frame: Frame): void {
  const code = frame.code as unknown
  if (!(code instanceof Code)) return invalid("a frame has no code.")
  const regs = frame.regs as unknown
  if (!Array.isArray(regs)) return invalid("a frame's registers are not a list.")
  const pc = frame.pc
  if (!Number.isSafeInteger(pc) || pc < 0 || pc >= code.code.length)
    return invalid(`a frame's pc ${pc} is out of range.`)
  const sp = frame.sp
  if (!Number.isSafeInteger(sp) || sp < code.locals || sp > code.locals + code.maxStack || regs.length !== sp) {
    return invalid(`a frame's stack pointer ${sp} is out of range.`)
  }
  for (let at = code.locals; at < sp; at++) if (regs[at] === HOLE) invalid("a hole is on a frame's operand stack.")
  for (let level = 0; level < code.finallyOffsets.length; level++) {
    const offset = code.finallyOffsets[level]!
    const tag = regs[code.finallies[offset]!]
    const targets = code.finallies[offset + 3]!
    if (
      tag !== HOLE &&
      tag !== undefined &&
      !(Number.isSafeInteger(tag) && (tag as number) >= 0 && (tag as number) < targets)
    ) {
      invalid(`a frame's finally tag ${String(tag)} is out of range.`)
    }
  }
  if (!(Object.values(Mode) as Array<number>).includes(frame.mode))
    invalid(`a frame's mode ${String(frame.mode)} is unknown.`)
  if (frame.mode === Mode.PROGRAM && (code.flags & CodeFlags.PROGRAM) === 0)
    invalid("a frame's mode does not fit its code.")
  const settles = frame.mode !== Mode.CALLER && frame.mode !== Mode.PROGRAM && frame.mode !== Mode.BOUNDARY_OUT
  if (!settles && frame.target !== undefined) invalid("a frame that settles nothing has a target.")
  const fn = frame.fn as unknown
  if (fn !== null && !(fn instanceof Fn)) invalid("a frame's function is not a function.")
  if (fn instanceof Fn && fn.code !== code) invalid("a frame's function does not run its code.")
  if (typeof frame.counted !== "boolean") invalid("a frame's call depth flag is not a boolean.")
  if (frame.args !== undefined && !Array.isArray(frame.args)) invalid("a frame's arguments are not a list.")
  for (let at = sp, size = code.locals + code.maxStack; at < size; at++) regs.push(HOLE)
  frame.cells = fn instanceof Fn ? fn.cells : EMPTY_CELLS
}

// The job stack, checked: frames only, the program's frame only at the bottom, and a caller under every `CALLER` one.
function restoreStack(vm: Vm): void {
  const frames = vm.frames as unknown
  if (!Array.isArray(frames) || frames.some((frame) => !(frame instanceof Frame)))
    invalid("the job stack is not frames.")
  vm.frames.forEach((frame, at) => {
    const bottomOnly = frame.mode === Mode.PROGRAM || frame.mode === Mode.BOUNDARY_OUT
    if ((at === 0 && frame.mode === Mode.CALLER) || (at > 0 && bottomOnly))
      invalid("a frame is out of place on the job stack.")
  })
  if (!Number.isSafeInteger(vm.depth) || vm.depth < 0) invalid("the call depth is not a count.")
}

// A closure's code and cells, checked; its length comes from its code.
function restoreFn(fn: Fn): void {
  const code = fn.code as unknown
  if (!(code instanceof Code)) return invalid("a closure has no code.")
  const cells = fn.cells as unknown
  if (
    !Array.isArray(cells) ||
    cells.length !== code.captures.length >>> 1 ||
    cells.some((cell) => !(cell instanceof Cell))
  ) {
    invalid("a closure's cells do not match its captures.")
  }
  Object.assign(fn, { length: code.length })
}
