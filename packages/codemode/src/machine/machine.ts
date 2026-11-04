import type { Interpreter } from "../interpreter/interpreter.js"
import type { Source } from "../interpreter/source.js"
import type { Call, Invoke } from "../interpreter/signals.js"
import { Frame } from "./frame.js"
import { enter } from "./calls.js"
import { ProgramKind } from "./statements.js"
import { MachineTask } from "./task.js"

/** Which evaluator runs program code: the machine (`src/machine`) or the generator evaluator in `interpreter.ts`. */
export type Evaluator = "machine" | "legacy"

/**
 * The machine evaluator for one execution. Program code runs as explicit frames on `MachineTask` stacks, stepped by a
 * loop, instead of host generators. Until the scheduler moves onto the machine too, each task is an activation body
 * the runner drives: the program, an async function's body, a generator's body, or a call the runner starts.
 */
export class Machine {
  /** Program calls on the running task's machine stacks, counted toward the call-depth limit with the runner's. */
  calls = 0

  constructor(readonly ctx: Interpreter<unknown>) {}

  /** The program's body as a task: it runs the program, adopts a returned thenable, and copies the result out. */
  program(source: Source): MachineTask {
    const task = new MachineTask(this, this.ctx.programScopes())
    task.stack.push(new Frame(ProgramKind, source.program, 0, task.scopes, []))
    return task
  }

  /** A call the runner reached (a built-in called a program function outside any task), as its own activation. */
  enter(invoke: Invoke): Call {
    return enter(this, invoke)
  }
}
