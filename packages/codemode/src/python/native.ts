import type { Interpreter } from "../interpreter/interpreter.js"
import { type AstNode, typeError } from "../interpreter/model.js"
import { Native, type Value, type Obj, type NativeCall } from "../interpreter/objects.js"
import type { Eval } from "../interpreter/runner.js"

export class PythonType extends Native {
  constructor(
    proto: Obj,
    readonly pythonName: string,
    call: NativeCall,
  ) {
    super(proto, { name: pythonName, call })
  }
}

type KeywordCall = (args: Value[], kw: ReadonlyMap<string, Value>, site?: AstNode) => Eval<Value>
const empty = new Map<string, Value>()
export class KeywordFunction extends Native {
  constructor(
    proto: Obj,
    name: string,
    readonly invoke: KeywordCall,
  ) {
    super(proto, { name, call: (_, args, site) => invoke(args, empty, site) })
  }
}
export function keyword<R>(ctx: Interpreter<R>, name: string, invoke: KeywordCall) {
  return new KeywordFunction(ctx.builtins.Function, name, invoke)
}
export function onlyKeywords(kw: ReadonlyMap<string, Value>, ...allowed: string[]) {
  for (const name of kw.keys()) if (!allowed.includes(name)) throw typeError(`Unexpected keyword argument '${name}'.`)
}
