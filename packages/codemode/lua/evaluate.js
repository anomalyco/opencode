import {
  LuaClosure,
  LuaError,
  LuaTable,
  arith,
  compare,
  concat,
  index,
  len,
  luaToNumber,
  newindex,
  truthy,
} from "v8lua/src/runtime.js"

// One generator per active Lua function. Expressions delegate within this frame;
// calls yield a request to the VM rather than delegating to another Lua frame.
export class Call {
  constructor(fn, args) {
    this.fn = fn
    this.args = args
  }
}

const stop = Symbol("break")
const arithmetic = { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod", "^": "pow" }

function isCall(node) {
  return node.type === "CallExpression" || node.type === "StringCallExpression" || node.type === "TableCallExpression"
}

// Each declaration extends the lexical chain, never mutating the set of names
// seen by earlier closures. Assignment changes the value in the existing cell.
function bind(parent, name, value) {
  return { parent, name, value }
}

function lookup(scope, name) {
  for (let cell = scope; cell; cell = cell.parent) if (cell.name === name) return cell
}

export class Frame {
  constructor(vm, closure, args) {
    this.vm = vm
    this.closure = closure
    this.line = closure.proto.loc.start.line
    let scope = closure.scope
    const proto = closure.proto
    let i = 0
    if (proto.identifier?.indexer === ":") scope = bind(scope, "self", args[i++])
    for (const param of proto.parameters ?? []) {
      if (param.type === "VarargLiteral") break
      scope = bind(scope, param.name, args[i++])
    }
    this.varargs = args.slice(i)
    if (proto.legacyArg) {
      const arg = new LuaTable()
      this.varargs.forEach((v, i) => arg.set(i + 1, v))
      arg.set("n", this.varargs.length)
      scope = bind(scope, "arg", arg)
    } else if (proto.legacyArg === false) scope = bind(scope, "arg", undefined)
    this.code = this.block(proto.body, scope)
  }

  close(proto, scope) {
    const fn = new LuaClosure(proto, scope, proto.identifier?.name, this.vm)
    fn.chunkname = this.closure.chunkname
    fn.env = this.closure.env
    return fn
  }

  *args(nodes, scope) {
    const result = []
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (i === nodes.length - 1 && !node.inParens) {
        if (node.type === "VarargLiteral") return result.concat(this.varargs)
        if (isCall(node)) return result.concat(yield* this.call(node, scope))
      }
      result.push(yield* this.expr(node, scope))
    }
    return result
  }

  *call(node, scope) {
    const request = yield* this.prepareCall(node, scope)
    return yield request
  }

  *prepareCall(node, scope) {
    const method = node.base.indexer === ":"
    const self = method ? yield* this.expr(node.base.base, scope) : undefined
    const fn = method ? this.vm.atomic(index(self, node.base.identifier.name)) : yield* this.expr(node.base, scope)
    const args =
      node.type === "CallExpression"
        ? yield* this.args(node.arguments, scope)
        : [yield* this.expr(node.argument ?? node.arguments, scope)]
    this.line = node.loc.start.line
    return new Call(fn, method ? [self, ...args] : args)
  }

  *ref(node, scope) {
    if (node.type === "Identifier") {
      const cell = lookup(scope, node.name)
      return cell ? { cell } : { obj: this.closure.env, key: node.name }
    }
    const obj = yield* this.expr(node.base, scope)
    const key = node.type === "MemberExpression" ? node.identifier.name : yield* this.expr(node.index, scope)
    return { obj, key }
  }

  store(ref, value) {
    if (ref.cell) ref.cell.value = value
    else this.vm.atomic(newindex(ref.obj, ref.key, value))
  }

  *expr(node, scope) {
    switch (node.type) {
      case "NilLiteral":
        return undefined
      case "StringLiteral":
      case "NumericLiteral":
      case "BooleanLiteral":
        return node.value
      case "VarargLiteral":
        return this.varargs[0]
      case "Identifier":
      case "IndexExpression":
      case "MemberExpression": {
        const ref = yield* this.ref(node, scope)
        this.line = node.loc.start.line
        return ref.cell ? ref.cell.value : this.vm.atomic(index(ref.obj, ref.key))
      }
      case "FunctionDeclaration":
        return this.close(node, scope)
      case "CallExpression":
      case "TableCallExpression":
      case "StringCallExpression":
        return (yield* this.call(node, scope))[0]
      case "TableConstructorExpression": {
        const table = new LuaTable()
        let at = 1
        for (let i = 0; i < node.fields.length; i++) {
          const field = node.fields[i]
          if (field.type === "TableValue") {
            if (i === node.fields.length - 1) {
              for (const v of yield* this.args([field.value], scope)) table.set(at++, v)
            } else table.set(at++, yield* this.expr(field.value, scope))
          } else {
            const key = field.type === "TableKeyString" ? field.key.name : yield* this.expr(field.key, scope)
            table.set(key, yield* this.expr(field.value, scope))
          }
        }
        return table
      }
      case "UnaryExpression": {
        const value = yield* this.expr(node.argument, scope)
        if (node.operator === "not") return !truthy(value)
        return this.vm.atomic(node.operator === "#" ? len(value) : arith("unm", value, value))
      }
      case "LogicalExpression": {
        const left = yield* this.expr(node.left, scope)
        return truthy(left) === (node.operator === "and") ? yield* this.expr(node.right, scope) : left
      }
      case "BinaryExpression": {
        const a = yield* this.expr(node.left, scope)
        const b = yield* this.expr(node.right, scope)
        this.line = node.loc.start.line
        switch (node.operator) {
          case "..":
            return this.vm.atomic(concat(a, b))
          case "==":
            return this.vm.atomic(compare("eq", a, b))
          case "~=":
            return !this.vm.atomic(compare("eq", a, b))
          case "<":
            return this.vm.atomic(compare("lt", a, b))
          case ">":
            return this.vm.atomic(compare("lt", b, a))
          case "<=":
            return this.vm.atomic(compare("le", a, b))
          case ">=":
            return this.vm.atomic(compare("le", b, a))
          default:
            return this.vm.atomic(arith(arithmetic[node.operator], a, b))
        }
      }
      default:
        throw new Error(`unknown Lua expression: ${node.type}`)
    }
  }

  *block(nodes, scope, until) {
    for (const node of nodes) {
      this.line = node.loc.start.line
      switch (node.type) {
        case "CallStatement":
          yield* this.call(node.expression, scope)
          break
        case "LocalStatement": {
          const values = yield* this.args(node.init, scope)
          for (const [i, variable] of node.variables.entries()) scope = bind(scope, variable.name, values[i])
          break
        }
        case "AssignmentStatement": {
          const refs = []
          for (const variable of node.variables) refs.push(yield* this.ref(variable, scope))
          const values = yield* this.args(node.init, scope)
          for (let i = refs.length - 1; i >= 0; i--) this.store(refs[i], values[i])
          break
        }
        case "FunctionDeclaration": {
          if (node.isLocal) scope = bind(scope, node.identifier.name, undefined)
          this.store(yield* this.ref(node.identifier, scope), this.close(node, scope))
          break
        }
        case "ReturnStatement": {
          const args = node.arguments
          if (args.length === 1 && isCall(args[0]) && !args[0].inParens) return yield* this.prepareCall(args[0], scope)
          return yield* this.args(args, scope)
        }
        case "BreakStatement":
          return stop
        case "DoStatement": {
          const result = yield* this.block(node.body, scope)
          if (result !== undefined) return result
          break
        }
        case "IfStatement": {
          for (const clause of node.clauses) {
            if (clause.condition && !truthy(yield* this.expr(clause.condition, scope))) continue
            const result = yield* this.block(clause.body, scope)
            if (result !== undefined) return result
            break
          }
          break
        }
        case "WhileStatement":
        case "RepeatStatement": {
          const repeat = node.type === "RepeatStatement"
          while (repeat || truthy(yield* this.expr(node.condition, scope))) {
            const result = yield* this.block(node.body, scope, repeat && node.condition)
            if (result === stop) break
            if (result !== undefined) return result
          }
          break
        }
        case "ForNumericStatement": {
          const start = luaToNumber(yield* this.expr(node.start, scope))
          const limit = luaToNumber(yield* this.expr(node.end, scope))
          const step = node.step ? luaToNumber(yield* this.expr(node.step, scope)) : 1
          if ([start, limit, step].includes(undefined)) throw new LuaError("'for' values must be numbers")
          for (let i = start; step > 0 ? i <= limit : i >= limit; i += step) {
            const result = yield* this.block(node.body, bind(scope, node.variable.name, i))
            if (result === stop) break
            if (result !== undefined) return result
          }
          break
        }
        case "ForGenericStatement": {
          const [iterator, state, first] = yield* this.args(node.iterators, scope)
          let control = first
          for (;;) {
            const values = this.vm.atomic(this.vm.invoke(iterator, [state, control]))
            control = values[0]
            if (control === undefined) break
            const locals = node.variables.reduce((s, v, i) => bind(s, v.name, values[i]), scope)
            const result = yield* this.block(node.body, locals)
            if (result === stop) break
            if (result !== undefined) return result
          }
          break
        }
        default:
          throw new Error(`unknown Lua statement: ${node.type}`)
      }
    }
    // The repeat condition is inside the body's lexical scope.
    if (until && truthy(yield* this.expr(until, scope))) return stop
  }
}
