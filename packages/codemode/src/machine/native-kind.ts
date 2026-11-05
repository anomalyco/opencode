import type { AstNode } from "../interpreter/model.js"
import type { Value } from "../interpreter/objects.js"
import { type Frame, kind, type Kind, type Out } from "./frame.js"
import type { MachineTask } from "./task.js"

// Built-ins that call program code run as frames whose state is plain data: a kind (a module constant, named once)
// and the frame's phase and slots. A built-in returns `Push(kind, slots)`; the frame runs at the call site, so a
// failure it raises, or one that unwinds through it, is located there, as a host built-in's would be. This module
// only defines things, so built-ins can make their kinds while the modules they import are still loading.

/** A built-in's frame kind: `step` runs from `frame.phase` with `input`, what the work it started gave back. */
export const nativeKind = (
  name: string,
  step: (task: MachineTask, frame: Frame, input: unknown) => Out<Value>,
  options?: Pick<Kind, "unwind" | "cut" | "counts">,
): Kind => kind(name, (task, frame, _node, input) => step(task, frame!, input), { locates: true, ...options })

/** The call site a built-in's frame runs at, for the operations that report failures there. */
export const site = (frame: Frame) => frame.node as AstNode
