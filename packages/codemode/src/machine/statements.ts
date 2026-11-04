import type {
  BlockStatement,
  DoWhileStatement,
  ExpressionStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  IfStatement,
  LabeledStatement,
  ModuleDeclaration,
  Pattern,
  Program,
  ReturnStatement,
  Statement,
  SwitchStatement,
  ThrowStatement,
  TryStatement,
  VariableDeclaration,
  WhileStatement,
} from "acorn"
import { toBoundary } from "../data.js"
import { materialize } from "../interpreter/errors.js"
import {
  type Binding,
  GeneratorReturn,
  invalidData,
  type StatementResult,
  syntaxError,
  Throw,
  typeError,
  unsupportedSyntax,
} from "../interpreter/model.js"
import type { Value } from "../interpreter/objects.js"
import {
  bindImport,
  builtinCursor,
  createsClosure,
  type CustomIterator,
  declaresLexically,
  enumerableKeys,
  hoistFunctions,
  hoistVars,
  isAbrupt,
  isThenable,
  loopDeclaration,
  loopExit,
  none,
  predeclareLexical,
  predeclarePattern,
} from "../interpreter/operations.js"
import { describeValue } from "../interpreter/references.js"
import { abrupt, Await, Interruption, normal } from "../interpreter/signals.js"
import { type Frame, kind, type Out, PENDING, type Pending } from "./frame.js"
import { ev, named } from "./expressions.js"
import { type Iter, iteratorClose, iteratorStep, openIterator } from "./iteration.js"
import { assigning, bind, declaring } from "./patterns.js"
import type { MachineTask } from "./task.js"

/** Executes a statement: simple ones finish within the step; loops and `try` always run as frames of their own. */
export function exec(task: MachineTask, node: Statement | ModuleDeclaration): Out<StatementResult> {
  switch (node.type) {
    case "ExpressionStatement": {
      const mark = task.stack.length
      if (ev(task, node.expression) === PENDING) return task.park(undefined, mark, ExpressionKind, node, 1)
      return none
    }
    case "VariableDeclaration":
      return variableDeclaration(task, undefined, node, undefined)
    case "ReturnStatement":
      return returnStatement(task, undefined, node, undefined)
    case "BlockStatement":
      return blockStatement(task, undefined, node, undefined)
    case "IfStatement":
      return ifStatement(task, undefined, node, undefined)
    case "SwitchStatement":
      return switchStatement(task, undefined, node, undefined)
    case "LabeledStatement":
      return labeledStatement(task, undefined, node, undefined)
    case "WhileStatement":
      return task.push(While, node, [undefined])
    case "DoWhileStatement":
      return task.push(DoWhile, node, [undefined])
    case "ForStatement":
      return task.push(For, node, [undefined])
    case "ForOfStatement":
      return task.push(ForOf, node, [undefined])
    case "ForInStatement":
      return task.push(ForIn, node, [undefined])
    case "BreakStatement":
      return node.label ? { kind: "break", label: node.label.name } : { kind: "break" }
    case "ContinueStatement":
      return node.label ? { kind: "continue", label: node.label.name } : { kind: "continue" }
    case "ThrowStatement":
      return throwStatement(task, undefined, node, undefined)
    case "TryStatement":
      return task.push(Try, node)
    case "EmptyStatement":
      return none
    case "FunctionDeclaration":
      return none
    case "ImportDeclaration":
      throw syntaxError("An import declaration may only appear at the top level of the program.", node)
    default:
      throw unsupportedSyntax(node.type, node)
  }
}

const ExpressionKind = kind("ExpressionStatement", (_task, _frame, _node: ExpressionStatement) => none)

// Slots: the declarator being evaluated. Phase 1 has its initializer's value; phase 0 starts the declarator.
function variableDeclaration(
  task: MachineTask,
  frame: Frame | undefined,
  node: VariableDeclaration,
  input: unknown,
): Out<StatementResult> {
  const mark = task.stack.length
  const kind = node.kind
  let phase = frame?.phase ?? 0
  const declarations = node.declarations
  for (let index = frame === undefined ? 0 : (frame.slots[0] as number); index < declarations.length; index++) {
    const declaration = declarations[index]!
    if (declaration.type !== "VariableDeclarator") {
      throw typeError("Unsupported variable declaration shape.", declaration)
    }
    const init = declaration.init
    const id = declaration.id
    let value = input as Value
    if (phase === 0) {
      // `var x` alone is a no-op: the binding was hoisted on function entry.
      if (kind === "var" && !init) continue
      const evaluated = !init ? undefined : id.type === "Identifier" ? named(task, init, id.name) : ev(task, init)
      if (evaluated === PENDING) return task.park(frame, mark, Variables, node, 1, [index])
      value = evaluated
    }
    phase = 0
    const mode = kind === "var" ? assigning : declaring(kind !== "const", true)
    if (bind(task, id, value, declaration, mode) === PENDING) {
      return task.park(frame, mark, Variables, node, 0, [index + 1])
    }
  }
  return none
}

const Variables = kind("VariableDeclaration", variableDeclaration)

function returnStatement(
  task: MachineTask,
  frame: Frame | undefined,
  node: ReturnStatement,
  input: unknown,
): Out<StatementResult> {
  const mark = task.stack.length
  const argument = node.argument
  if (!argument) return { kind: "return", value: undefined }
  const phase = frame?.phase ?? 0
  let value = input as Value
  if (phase === 0) {
    const evaluated = ev(task, argument)
    if (evaluated === PENDING) return task.park(frame, mark, Return, node, 1)
    value = evaluated
  }
  // An async generator awaits what it returns, as it awaits what it yields.
  const fn = task.scopes.fn
  if (phase <= 1 && fn?.generator && fn.async) {
    task.request(new Await(value, node), node)
    return task.park(frame, mark, Return, node, 2)
  }
  return { kind: "return", value }
}

const Return = kind("ReturnStatement", returnStatement)

// Slots: the statement running and whether the block pushed a scope.
export function blockStatement(
  task: MachineTask,
  frame: Frame | undefined,
  node: BlockStatement,
  input: unknown,
): Out<StatementResult> {
  const mark = task.stack.length
  const body = node.body
  let index = 0
  let scoped: boolean
  if (frame === undefined) {
    scoped = declaresLexically(body)
    if (scoped) {
      task.scopes.push()
      predeclareLexical(task.scopes, body)
      hoistFunctions(task.ctx.builtins, task.scopes, body)
    }
  } else {
    index = frame.slots[0] as number
    scoped = frame.slots[1] as boolean
    const result = input as StatementResult
    if (result.kind !== "none") {
      if (scoped) task.scopes.pop()
      return result
    }
    index++
  }
  for (; index < body.length; index++) {
    const result = exec(task, body[index]!)
    if (result === PENDING) return task.park(frame, mark, Block, node, 1, [index, scoped])
    if (result.kind !== "none") {
      if (scoped) task.scopes.pop()
      return result
    }
  }
  if (scoped) task.scopes.pop()
  return none
}

const Block = kind("BlockStatement", blockStatement)

function ifStatement(task: MachineTask, frame: Frame | undefined, node: IfStatement, input: unknown) {
  let test = input as Value
  if (frame === undefined) {
    const mark = task.stack.length
    const evaluated = ev(task, node.test)
    if (evaluated === PENDING) return task.park(frame, mark, If, node, 1)
    test = evaluated
  }
  const branch = test ? node.consequent : node.alternate
  if (!branch) return none
  return task.tail(frame, exec(task, branch))
}

const If = kind("IfStatement", ifStatement)

function throwStatement(
  task: MachineTask,
  frame: Frame | undefined,
  node: ThrowStatement,
  input: unknown,
): never | typeof PENDING {
  let value = input as Value
  if (frame === undefined) {
    const mark = task.stack.length
    const evaluated = ev(task, node.argument)
    if (evaluated === PENDING) return task.park(frame, mark, ThrowKind, node, 1)
    value = evaluated
  }
  throw new Throw(value)
}

const ThrowKind = kind("ThrowStatement", throwStatement)

// Slots: the discriminant, the case being tested or run, the default case, and the statement running in it.
// Phases: 1 has the discriminant, 2 has a case's test value, 3 has a statement's result.
function switchStatement(task: MachineTask, frame: Frame | undefined, node: SwitchStatement, input: unknown) {
  const mark = task.stack.length
  const cases = node.cases
  let phase = frame?.phase ?? 0
  let slots = frame?.slots ?? []
  const park = (next: number): Pending => task.park(frame, mark, Switch, node, next, slots)
  if (phase === 0) {
    const evaluated = ev(task, node.discriminant)
    if (evaluated === PENDING) return park(1)
    input = evaluated
    phase = 1
  }
  if (phase === 1) {
    slots = [input, 0, undefined, 0]
    task.scopes.push()
    const statements = cases.flatMap((branch) => branch.consequent)
    predeclareLexical(task.scopes, statements)
    hoistFunctions(task.ctx.builtins, task.scopes, statements)
  }
  if (phase <= 2) {
    for (let index = slots[1] as number; index < cases.length; index++) {
      slots[1] = index
      const test = cases[index]!.test
      if (phase === 2) phase = 1
      else {
        if (!test) {
          slots[2] = index
          continue
        }
        const evaluated = ev(task, test)
        if (evaluated === PENDING) return park(2)
        input = evaluated
      }
      if (input === slots[0]) {
        slots[3] = 0
        phase = 3
        input = undefined
        break
      }
    }
    if (phase !== 3) {
      if (slots[2] === undefined) {
        task.scopes.pop()
        return none
      }
      slots[1] = slots[2]
      slots[3] = 0
    }
  } else {
    const result = input as StatementResult
    const done = switchExit(result)
    if (done !== undefined) {
      task.scopes.pop()
      return done
    }
    slots[3] = (slots[3] as number) + 1
  }
  for (let index = slots[1] as number; index < cases.length; index++, slots[3] = 0) {
    slots[1] = index
    const consequent = cases[index]!.consequent
    for (let at = slots[3] as number; at < consequent.length; at++) {
      slots[3] = at
      const result = exec(task, consequent[at]!)
      if (result === PENDING) return park(3)
      const done = switchExit(result)
      if (done !== undefined) {
        task.scopes.pop()
        return done
      }
    }
  }
  task.scopes.pop()
  return none
}

// An unlabelled break ends the switch; anything else abrupt goes on outward.
const switchExit = (result: StatementResult): StatementResult | undefined => {
  if (result.kind === "break") return result.label === undefined ? none : result
  if (result.kind === "return" || result.kind === "continue") return result
  return undefined
}

const Switch = kind("SwitchStatement", switchStatement)

const loopKinds = new Set(["WhileStatement", "DoWhileStatement", "ForStatement", "ForOfStatement", "ForInStatement"])

// Slots: the labels. A loop gets them, so `continue label` continues it; a labelled break of any statement ends it.
function labeledStatement(task: MachineTask, frame: Frame | undefined, node: LabeledStatement, input: unknown) {
  let labels = frame?.slots[0] as Set<string>
  let result = input as StatementResult
  if (frame === undefined) {
    const mark = task.stack.length
    labels = new Set<string>()
    let body: Statement = node
    while (body.type === "LabeledStatement") {
      labels.add(body.label.name)
      body = body.body
    }
    const executed = loopKinds.has(body.type) ? task.push(loopKind(body.type), body, [labels]) : exec(task, body)
    if (executed === PENDING) return task.park(frame, mark, Labeled, node, 1, [labels])
    result = executed
  }
  return result.kind === "break" && result.label !== undefined && labels.has(result.label) ? none : result
}

const Labeled = kind("LabeledStatement", labeledStatement)

// The machine checks for a slice at each loop back-edge, so a long loop lets the host run.
const backEdge = (task: MachineTask, frame: Frame, phase: number): boolean => {
  if (!task.machine.tick() && !task.slice) return false
  task.slice = true
  frame.phase = phase
  return true
}

// Slots: the labels. Phases: 0 tests, 1 has the test, 2 has the body's result.
function whileStatement(task: MachineTask, frame: Frame, node: WhileStatement, input: unknown) {
  const labels = frame.slots[0] as ReadonlySet<string> | undefined
  let phase = frame.phase
  while (true) {
    if (phase === 0) {
      const test = ev(task, node.test)
      if (test === PENDING) {
        frame.phase = 1
        return PENDING
      }
      input = test
    }
    if (phase <= 1) {
      if (!input) return none
      const result = exec(task, node.body)
      if (result === PENDING) {
        frame.phase = 2
        return PENDING
      }
      input = result
    }
    const exit = loopExit(input as StatementResult, labels)
    if (exit !== undefined) return exit
    phase = 0
    if (backEdge(task, frame, 0)) return PENDING
  }
}

const While = kind("WhileStatement", whileStatement)

// Slots: the labels. Phases: 0 runs the body, 1 has its result, 2 tests, 3 has the test.
function doWhileStatement(task: MachineTask, frame: Frame, node: DoWhileStatement, input: unknown) {
  const labels = frame.slots[0] as ReadonlySet<string> | undefined
  let phase = frame.phase
  while (true) {
    if (phase === 0) {
      const result = exec(task, node.body)
      if (result === PENDING) {
        frame.phase = 1
        return PENDING
      }
      input = result
    }
    if (phase <= 1) {
      const exit = loopExit(input as StatementResult, labels)
      if (exit !== undefined) return exit
      if (backEdge(task, frame, 2)) return PENDING
    }
    if (phase <= 2) {
      const test = ev(task, node.test)
      if (test === PENDING) {
        frame.phase = 3
        return PENDING
      }
      input = test
    }
    if (!input) return none
    phase = 0
  }
}

const DoWhile = kind("DoWhileStatement", doWhileStatement)

// Slots: the labels and the names each iteration copies. Phases: 0 starts, 1 has the initializer done, 2 tests,
// 3 has the test, 4 has the body's result, 5 has the update done.
function forStatement(task: MachineTask, frame: Frame, node: ForStatement, input: unknown) {
  const slots = frame.slots
  const labels = slots[0] as ReadonlySet<string> | undefined
  const init = node.init
  let phase = frame.phase
  if (phase === 0) {
    task.scopes.push()
    if (init?.type === "VariableDeclaration" && init.kind !== "var") predeclareLexical(task.scopes, [init])
    if (init) {
      const done =
        init.type === "VariableDeclaration" ? variableDeclaration(task, undefined, init, undefined) : ev(task, init)
      if (done === PENDING) {
        frame.phase = 1
        return PENDING
      }
    }
    phase = 1
  }
  if (phase === 1) {
    // Each iteration gets fresh copies of the loop's `let` bindings, but only closures can tell them apart.
    slots[1] =
      init?.type === "VariableDeclaration" &&
      init.kind !== "var" &&
      [node.init, node.test, node.update, node.body].some((part) => part && createsClosure(part))
        ? Array.from(task.scopes.current().keys())
        : []
    nextIteration(task, slots[1] as Array<string>)
    phase = 2
  }
  while (true) {
    if (phase === 2) {
      if (node.test) {
        const test = ev(task, node.test)
        if (test === PENDING) {
          frame.phase = 3
          return PENDING
        }
        input = test
      } else input = true
      phase = 3
    }
    if (phase === 3) {
      if (!input) {
        task.scopes.pop()
        return none
      }
      const result = exec(task, node.body)
      if (result === PENDING) {
        frame.phase = 4
        return PENDING
      }
      input = result
      phase = 4
    }
    if (phase === 4) {
      const exit = loopExit(input as StatementResult, labels)
      if (exit !== undefined) {
        task.scopes.pop()
        return exit
      }
      nextIteration(task, slots[1] as Array<string>)
      if (node.update && ev(task, node.update) === PENDING) {
        frame.phase = 5
        return PENDING
      }
    }
    phase = 2
    if (backEdge(task, frame, 2)) return PENDING
  }
}

const nextIteration = (task: MachineTask, names: Array<string>) => {
  if (names.length === 0) return
  const scopes = task.scopes
  const current = scopes.current()
  scopes.pop()
  scopes.push(new Map(names.map((name): [string, Binding] => [name, { ...current.get(name)! }])))
}

const For = kind("ForStatement", forStatement)

type Declared = ReturnType<typeof loopDeclaration>

// Slots: the labels, the declaration, the keys, and the next key. Phases: 0 starts, 1 has the object, 2 starts the
// iteration at the index, 3 has the binding done, 4 has the body's result.
function forInStatement(task: MachineTask, frame: Frame, node: ForInStatement, input: unknown) {
  const slots = frame.slots
  const labels = slots[0] as ReadonlySet<string> | undefined
  const left = node.left
  let phase = frame.phase
  if (phase === 0) {
    const declared = loopDeclaration(left, "for...in")
    slots[1] = declared
    if (declared?.lexical) {
      task.scopes.push()
      predeclarePattern(task.scopes, declared.pattern, declared.mutable, left)
    }
    const right = ev(task, node.right)
    if (right === PENDING) {
      frame.phase = 1
      return PENDING
    }
    input = right
    phase = 1
  }
  const declared = slots[1] as Declared
  if (phase === 1) {
    slots[2] = enumerableKeys(task.ctx, input as Value, node.right)
    if (left.type === "RestElement" || left.type === "AssignmentPattern") {
      throw typeError("Unsupported for...in binding.", left)
    }
    slots[3] = 0
    phase = 2
  }
  const keys = slots[2] as Array<string>
  while (true) {
    if (phase === 2) {
      const index = slots[3] as number
      if (index >= keys.length) {
        if (declared?.lexical) task.scopes.pop()
        return none
      }
      const key = keys[index]!
      let bound
      if (declared?.lexical) {
        task.scopes.push()
        predeclarePattern(task.scopes, declared.pattern, declared.mutable, left)
        bound = bind(task, declared.pattern, key, left, declaring(declared.mutable, true))
      } else bound = bind(task, declared ? declared.pattern : (left as Pattern), key, left, assigning)
      if (bound === PENDING) {
        frame.phase = 3
        return PENDING
      }
      phase = 3
    }
    if (phase === 3) {
      const result = exec(task, node.body)
      if (result === PENDING) {
        frame.phase = 4
        return PENDING
      }
      input = result
    }
    if (declared?.lexical) task.scopes.pop()
    const exit = loopExit(input as StatementResult, labels)
    if (exit !== undefined) {
      if (declared?.lexical) task.scopes.pop()
      return exit
    }
    slots[3] = (slots[3] as number) + 1
    phase = 2
    if (backEdge(task, frame, 2)) return PENDING
  }
}

const ForIn = kind("ForInStatement", forInStatement)

// The phases of `for...of`: start, have the iterable, have the iterator, step (the loop top), have the step, run the
// body after binding (the region where a failure closes the iterator), have the body's result, close after an exit,
// and close after a failure and rethrow it.
const OF_ITERABLE = 1
const OF_ITERATOR = 2
const OF_STEP = 3
const OF_STEPPED = 4
const OF_BOUND = 5
const OF_BODY = 6
const OF_EXIT = 7
const OF_FAILING = 8
const OF_FAILED = 9

// Slots: the labels, the declaration, the iterable, the iterator, the reused binding, the exit or failure.
function forOfStatement(task: MachineTask, frame: Frame, node: ForOfStatement, input: unknown) {
  const slots = frame.slots
  const labels = slots[0] as ReadonlySet<string> | undefined
  const left = node.left
  const awaiting = node.await
  let phase = frame.phase
  if (phase === 0) {
    const declared = loopDeclaration(left, "for...of")
    slots[1] = declared
    if (declared?.lexical) {
      task.scopes.push()
      predeclarePattern(task.scopes, declared.pattern, declared.mutable, left)
    }
    const right = ev(task, node.right)
    if (right === PENDING) {
      frame.phase = OF_ITERABLE
      return PENDING
    }
    input = right
    phase = OF_ITERABLE
  }
  const declared = slots[1] as Declared
  if (phase === OF_ITERABLE) {
    slots[2] = input
    const builtin = builtinCursor(task.ctx.builtins, input as Value)
    if (builtin !== undefined) {
      slots[3] = builtin
      input = undefined
    } else {
      const custom = openIterator(task, input as Value, node, awaiting)
      if (custom === PENDING) {
        frame.phase = OF_ITERATOR
        return PENDING
      }
      input = custom
    }
    phase = OF_ITERATOR
  }
  if (phase === OF_ITERATOR) {
    const builtin = slots[3] as Iter | undefined
    const custom = input as CustomIterator | undefined
    if (custom === undefined && builtin === undefined) {
      throw invalidData(
        `${awaiting ? "for await...of" : "for...of"} requires an iterable value, received ${describeValue(slots[2] as Value)}.`,
        node,
      )
    }
    // `for await` over a synchronous iterator drives it through CreateAsyncFromSyncIterator, as JS does.
    slots[3] =
      awaiting && !custom?.asynchronous
        ? task.ctx.asyncFromSync(custom ? undefined : (builtin as Exclude<Iter, CustomIterator>), custom, node)
        : (custom ?? builtin)
    if (left.type === "RestElement" || left.type === "AssignmentPattern") {
      throw typeError("Unsupported for...of binding.", left)
    }
    // Each iteration gets a fresh binding, but only a closure in the body can tell; without one, a single
    // `for (const x of ...)` binding is reused.
    if (declared?.lexical && declared.pattern.type === "Identifier" && !createsClosure(node.body)) {
      const reused: Binding = { mutable: declared.mutable, value: undefined, initialized: false }
      slots[4] = reused
      task.scopes.push(new Map([[declared.pattern.name, reused]]))
    }
    phase = OF_STEP
  }
  if (phase === OF_FAILING) return failOf(task, frame, node)
  if (phase === OF_FAILED) throw slots[5]
  if (phase === OF_EXIT) {
    leaveOf(task, slots)
    return slots[5] as StatementResult
  }
  const iterator = slots[3] as Iter
  const reused = slots[4] as Binding | undefined
  while (true) {
    if (phase === OF_STEP) {
      const step = iteratorStep(task, iterator, node)
      if (step === PENDING) {
        frame.phase = OF_STEPPED
        return PENDING
      }
      input = step
      phase = OF_STEPPED
    }
    if (phase === OF_STEPPED) {
      const step = input as { done: boolean; value: Value }
      if (step.done) {
        leaveOf(task, slots)
        return none
      }
      frame.phase = OF_BOUND
      if (reused !== undefined) {
        reused.value = step.value
        reused.initialized = true
      } else {
        let bound
        if (declared?.lexical) {
          task.scopes.push()
          predeclarePattern(task.scopes, declared.pattern, declared.mutable, left)
          bound = bind(task, declared.pattern, step.value, left, declaring(declared.mutable, true))
        } else bound = bind(task, declared ? declared.pattern : (left as Pattern), step.value, left, assigning)
        if (bound === PENDING) return PENDING
      }
      phase = OF_BOUND
    }
    if (phase === OF_BOUND) {
      frame.phase = OF_BODY
      const result = exec(task, node.body)
      if (result === PENDING) return PENDING
      input = result
    }
    if (reused === undefined && declared?.lexical) task.scopes.pop()
    frame.phase = OF_STEP
    const exit = loopExit(input as StatementResult, labels)
    if (exit !== undefined) {
      slots[5] = exit
      frame.phase = OF_EXIT
      if (iteratorClose(task, iterator, node) === PENDING) return PENDING
      leaveOf(task, slots)
      return exit
    }
    phase = OF_STEP
    if (backEdge(task, frame, OF_STEP)) return PENDING
  }
}

// Pops the scopes the loop pushed: the reused binding's and the declaration's.
const leaveOf = (task: MachineTask, slots: Array<unknown>) => {
  if (slots[4] !== undefined) task.scopes.pop()
  if ((slots[1] as Declared)?.lexical) task.scopes.pop()
}

// IteratorClose after a failure in the body: the failure wins over a failing close, except that a generator's
// return() is a return completion, so a failing close wins over it.
function failOf(task: MachineTask, frame: Frame, node: ForOfStatement) {
  const failure = frame.slots[5]
  let closed
  try {
    closed = iteratorClose(task, frame.slots[3] as Iter, node)
  } catch (error) {
    if (failure instanceof GeneratorReturn) throw error
    throw failure
  }
  if (closed === PENDING) {
    frame.phase = OF_FAILED
    return PENDING
  }
  throw failure
}

const ForOf = kind("ForOfStatement", forOfStatement, {
  unwind: (_task, frame, error) => {
    if (frame.phase === OF_FAILED) {
      if (frame.slots[5] instanceof GeneratorReturn) return false
      throw frame.slots[5]
    }
    if ((frame.phase !== OF_BOUND && frame.phase !== OF_BODY) || error instanceof Interruption) return false
    frame.slots[5] = error
    frame.phase = OF_FAILING
    return true
  },
})

const loopKind = (type: string) =>
  type === "WhileStatement"
    ? While
    : type === "DoWhileStatement"
      ? DoWhile
      : type === "ForStatement"
        ? For
        : type === "ForOfStatement"
          ? ForOf
          : ForIn

// The phases of `try`: start, run the block, start the handler, bind its parameter, run its body, start the
// finalizer, run it.
const TRY_BLOCK = 1
const TRY_CATCH = 2
const TRY_BOUND = 3
const TRY_HANDLER = 4
const TRY_FINALLY = 5
const TRY_FINAL = 6

// Slots: the scope height at the start, the result, the failure caught for the finalizer, and the error to catch.
function tryStatement(task: MachineTask, frame: Frame, node: TryStatement, input: unknown) {
  const slots = frame.slots
  const handler = node.handler
  const finalizer = node.finalizer
  let phase = frame.phase
  if (phase === 0) {
    slots[0] = frame.scope.height
    slots[1] = none
    frame.phase = TRY_BLOCK
    const result = exec(task, node.block)
    if (result === PENDING) return PENDING
    input = result
    phase = TRY_BLOCK
  }
  if (phase === TRY_BLOCK) {
    if (!finalizer) return input
    slots[1] = input
    phase = TRY_FINALLY
  }
  if (phase === TRY_CATCH) {
    const caught = materialize(task.ctx, slots[3])
    slots[3] = undefined
    task.scopes.push()
    frame.phase = TRY_BOUND
    const parameter = handler!.param
    if (parameter && bind(task, parameter, caught, handler!, declaring(true, false)) === PENDING) return PENDING
    phase = TRY_BOUND
  }
  if (phase === TRY_BOUND) {
    frame.phase = TRY_HANDLER
    const result = exec(task, handler!.body)
    if (result === PENDING) return PENDING
    input = result
    phase = TRY_HANDLER
  }
  if (phase === TRY_HANDLER) {
    task.scopes.pop()
    if (!finalizer) return input
    slots[1] = input
    phase = TRY_FINALLY
  }
  if (phase === TRY_FINALLY) {
    frame.phase = TRY_FINAL
    const final = exec(task, finalizer!)
    if (final === PENDING) return PENDING
    input = final
  }
  const final = input as StatementResult
  if (isAbrupt(final)) return final
  const failure = slots[2] as { readonly error: unknown } | undefined
  if (failure) throw failure.error
  return slots[1]
}

const Try = kind("TryStatement", tryStatement, {
  unwind: (_task, frame, error) => {
    const node = frame.node as TryStatement
    const phase = frame.phase
    if (error instanceof Interruption) return false
    if (phase === TRY_BLOCK) {
      frame.scope.truncate(frame.slots[0] as number)
      // A generator's return() unwinds through `finally` but is not an exception `catch` sees.
      if (error instanceof GeneratorReturn || !node.handler) {
        if (!node.finalizer) return false
        frame.slots[2] = { error }
        frame.phase = TRY_FINALLY
        return true
      }
      frame.slots[3] = error
      frame.phase = TRY_CATCH
      return true
    }
    if ((phase === TRY_BOUND || phase === TRY_HANDLER) && node.finalizer) {
      frame.scope.truncate(frame.slots[0] as number)
      frame.slots[2] = { error }
      frame.phase = TRY_FINALLY
      return true
    }
    return false
  },
})

// Slots: the statement running and the value of the last expression statement. Phases: 1 has a statement's result,
// 2 has the last expression's value, 3 has a returned thenable settled, 4 has the result copied out.
// The phases of the program's frame: 0 starts, 1 has a statement's result, 2 has the body's value, 3 has it adopted,
// 4 has it copied out, and `ENDED` has ended the program, its outcome recorded on the machine.
const ENDED = 5

function programStep(task: MachineTask, frame: Frame, node: Program, input: unknown) {
  const slots = frame.slots
  const body = node.body
  let phase = frame.phase
  if (phase === ENDED) return undefined
  let value: Value = undefined
  let index = 0
  if (phase === 0) {
    // Keep top-level declarations separate so they can shadow builtins.
    task.scopes.push()
    // Imports load before any code runs, as in a module.
    for (const statement of body)
      if (statement.type === "ImportDeclaration") bindImport(task.ctx, task.scopes, statement)
    predeclareLexical(task.scopes, body)
    hoistFunctions(task.ctx.builtins, task.scopes, body)
    hoistVars(task.scopes, body)
  } else if (phase === 1) {
    index = slots[0] as number
    const result = input as StatementResult
    if (result.kind === "return") {
      value = result.value
      phase = 2
    } else {
      outsideLoop(result, body[index]!)
      index++
    }
  } else if (phase === 2) value = input as Value
  if (phase <= 1) {
    phase = 2
    for (; index < body.length; index++) {
      const statement = body[index]!
      if (statement.type === "ImportDeclaration") continue
      if (index === body.length - 1 && statement.type === "ExpressionStatement") {
        const evaluated = ev(task, statement.expression)
        if (evaluated === PENDING) {
          frame.phase = 2
          return PENDING
        }
        value = evaluated
        break
      }
      const result = exec(task, statement)
      if (result === PENDING) {
        slots[0] = index
        frame.phase = 1
        return PENDING
      }
      if (result.kind === "return") {
        value = result.value
        break
      }
      outsideLoop(result, statement)
    }
  }
  if (phase === 2) {
    // The implicit async body adopts returned promises before copy-out.
    if (isThenable(value)) {
      frame.phase = 3
      return task.request(new Await(value, undefined), node)
    }
    input = value
    phase = 3
  }
  if (phase === 3) {
    frame.phase = 4
    const copied = task.native(toBoundary(task.ctx, input as Value), node, false)
    if (copied === PENDING) return PENDING
    input = copied
  }
  task.machine.outcome = normal(input)
  return undefined
}

const outsideLoop = (result: StatementResult, statement: Statement | ModuleDeclaration) => {
  if (result.kind === "break" || result.kind === "continue") {
    throw typeError(`Unexpected '${result.kind}' outside of a loop.`, statement)
  }
}

/**
 * The program's body, the first job. It is an async boundary: an `await` in it parks the whole body, and how the body
 * ends, normally or by a throw, is the program's outcome.
 */
export const ProgramKind = kind("Program", programStep, {
  unwind: (task, frame, error) => {
    if (frame.phase === ENDED) return false
    task.machine.outcome = abrupt(error)
    frame.phase = ENDED
    return true
  },
  cut: () => normal(undefined),
  counts: () => true,
})
