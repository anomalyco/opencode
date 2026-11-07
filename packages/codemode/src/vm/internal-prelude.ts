import { fromJson, type Json } from "./data.js"
import { conversions } from "./runtime/callback.js"
import type { Builtins } from "./runtime/intrinsics.js"
import { checkStringLength, MAX_VALUE_DEPTH } from "./runtime/limits.js"
import { invalidData, rangeError, typeError } from "./runtime/model.js"
import {
  Arr,
  Builtin,
  Bytes,
  Callable,
  coerceToNumber,
  coerceToString,
  DateObj,
  ErrorObj,
  get,
  HeadersObj,
  keys,
  type NativeResult,
  Obj,
  PromiseObj,
  SetObj,
  URLSearchParamsObj,
  type Value,
} from "./runtime/objects.js"
import { applyBinaryOperator, operatorConversion, propertyKey } from "./runtime/operations.js"
import { isOpaque, typeofValue } from "./runtime/references.js"
import { Convert } from "./runtime/signals.js"
import type { Code } from "./code.js"
import { builtinCodes } from "./prelude/bytecode.js"
import { UnaryOp } from "./opcodes.js"
import { type Vm, VmInternalFn } from "./vm.js"

/**
 * Lightweight internal callable for VM-only `$` intrinsics. Does not extend `Obj` or `Native`,
 * so it never touches `builtins.Function`, `nativeRule.sealed`, or static intrinsic numbering.
 */
export class VmIntrinsic {
  constructor(
    readonly name: string,
    readonly call: (args: Array<Value>) => NativeResult,
  ) {}
}

export const INTERNAL_SOURCE = String.raw`
function $vmToPrimitive(v, hint) {
  if (!$IsDataObj(v)) return v
  const first = hint === "string" || (hint === "default" && $IsDate(v)) ? "toString" : "valueOf"
  const second = first === "toString" ? "valueOf" : "toString"
  const m1 = $GetMethod(v, first)
  if (m1 !== undefined) {
    const r1 = $Call(m1, v)
    if (!$IsObj(r1)) return r1
  }
  const m2 = $GetMethod(v, second)
  if (m2 !== undefined) {
    const r2 = $Call(m2, v)
    if (!$IsObj(r2)) return r2
  }
  $Throw("TypeError", "Cannot convert object to primitive value.")
}

function $vmToKey(v) {
  return $PropKey($vmToPrimitive(v, "string"))
}

function $vmToString(v) {
  return $CoerceToString($vmToPrimitive(v, "string"))
}

function $vmToNumeric(incFlag, v) {
  return $ApplyToNumeric(incFlag, $vmToPrimitive(v, "number"))
}

function $vmInc(incFlag, v) {
  const n = $ApplyToNumeric(incFlag, $vmToPrimitive(v, "number"))
  return incFlag === 0 ? n + 1 : n - 1
}

function $vmUnary(sub, v) {
  return $ApplyUnary(sub, $vmToPrimitive(v, "number"))
}

function $vmBinary(op, lhs, rhs) {
  const kind = $OpConvKind(op, lhs, rhs)
  if (kind === 0) return $ApplyBinary(op, lhs, rhs)
  if (kind === 1) {
    const key = $vmToPrimitive(lhs, "string")
    return $ApplyBinary(op, key, rhs)
  }
  const hint = kind === 2 ? "default" : "number"
  const l = $vmToPrimitive(lhs, hint)
  const r = $vmToPrimitive(rhs, hint)
  return $ApplyBinary(op, l, r)
}

function $vmGetElem(o, k) {
  return o[$vmToKey(k)]
}

function $vmDeleteElem(o, k) {
  return delete o[$vmToKey(k)]
}

function $vmConvert(callable, target, args, constructing, replay, req) {
  while (true) {
    const values = $ConvValues(req)
    const coerce = $ConvFlag(req, 0)
    const ordinal = $ConvFlag(req, 1)
    const len = values.length
    const converted = []
    let i = 0
    while (i < len) {
      const val = values[i]
      const hint = $ConvHint(req, i)
      const prim = $IsObj(val) ? $vmToPrimitive(val, hint) : val
      converted[i] = coerce ? $ConvCoerce(hint, prim) : prim
      i++
    }
    replay[ordinal] = converted
    const res = $ConvReplay(callable, target, args, constructing, replay)
    if (!$IsConvert(res)) return res
    req = res
  }
}

// A JSON walk's step for one value, holder[key]: its JSON as program data, or undefined when it is left out. A promise
// is yielded at the host boundary, which resumes the walk with its value.
function $vmJsonVisitor(boundary, replacer, properties) {
  const ancestors = []
  function* visit(holder, key, depth) {
    if (depth > 100) $Throw("RangeError", "Value exceeds the maximum depth of 100.")
    let val = holder[key]
    if ($IsPromise(val)) {
      if (!boundary) {
        $Throw("InvalidData", "JSON.stringify received an un-awaited Promise; await it first - e.g. \x60const result = await tools.ns.tool(...)\x60.")
      }
      val = yield val
    }
    if ($IsObj(val)) {
      const toJSON = val.toJSON
      if ($IsCallableAny(toJSON)) val = $Call(toJSON, val, key)
    }
    if (replacer !== undefined) val = $Call(replacer, holder, key, val)
    const kind = $JsonClassify(val, boundary, ancestors)
    if (kind === 0) return undefined
    if (kind === 1) return val
    if (kind === 2) return null
    if (kind === 3) return $JsonSpecial(val, boundary)
    const target = kind === 4 ? $SetToArray(val) : val
    ancestors[ancestors.length] = target
    let out
    if ($IsArray(target)) {
      out = []
      const len = target.length
      let i = 0
      while (i < len) {
        const elem = yield* visit(target, String(i), depth + 1)
        out[i] = elem === undefined ? null : elem
        i++
      }
    } else {
      out = $NewNullProtoObj()
      const names = $JsonNames(target, boundary, properties)
      let i = 0
      while (i < names.length) {
        const k = names[i]
        const propVal = yield* visit(target, k, depth + 1)
        if (propVal !== undefined) $Define(out, k, propVal, true)
        i++
      }
    }
    $ArrayPop(ancestors)
    return out
  }
  return visit
}

function $vmJsonWalk(replacer, value, properties, indent) {
  const json = $vmJsonVisitor(false, replacer, properties)({ "": value }, "", 0).next().value
  return $JsonFinish(false, json, properties, indent)
}

function $vmSettleCall(callable, thisVal, args) {
  return $Apply(callable, thisVal, args)
}

function $vmCombine(name, items) {
  const c = $CombineStart(name, items)
  for (const item of items) {
    $CombineAdd(c, item)
  }
  $CombineEnd(c)
}

function $vmOpenSyncForAsync(v, method) {
  return $WrapAsyncFromSync($Call(method, v))
}

function $vmAsyncFromSync(adapter, kind, hasArg, val) {
  const iter = $AfsGetIter(adapter)
  const method = kind === "next" ? $AfsGetNext(adapter) : $AfsGetMethod(adapter, iter, kind)
  if (method === undefined || method === null) {
    if (kind === "return") {
      $AfsResolveDone(val)
      return
    }
    const ret = $AfsGetMethod(adapter, iter, "return")
    if (ret !== undefined && ret !== null) {
      $AfsCheckObj(adapter, $Call(ret, iter), "return")
    }
    $AfsRejectNoThrow(adapter)
    return
  }
  const res = hasArg ? $Call(method, iter, val) : $Call(method, iter)
  $AfsCheckObj(adapter, res, kind)
  const done = !!res.done
  const value = res.value
  $AfsSettle(adapter, value, done, kind !== "return")
}

function $vmAsyncFromSyncClose(iter) {
  const ret = iter.return
  if (ret !== undefined && ret !== null) $Call(ret, iter)
}

async function $vmCross(roots, path, resolving) {
  const crossed = []
  let r = 0
  while (r < roots.length) {
    let root = roots[r]
    if (path === undefined && $IsThenable(root)) root = await root
    const walk = $vmJsonVisitor(true, undefined, null)({ "": root }, "", 0)
    let step = walk.next()
    while (!step.done) step = walk.next(await step.value)
    crossed[r] = $JsonFinish(true, step.value, null, undefined)
    r++
  }
  if (path === undefined) return crossed[0]
  if (path === "search") return $HostSearch(crossed)
  $HostTool(path, crossed, resolving)
}
`

let compiledInternal: ReturnType<typeof builtinCodes> | undefined

/** The VM's internal helpers' bytecode, and their functions' code by name. */
export const getInternalPrelude = () => (compiledInternal ??= builtinCodes("@vm-internal", INTERNAL_SOURCE))

/** The code of the internal helper `name`. */
export const internalCode = (name: string): Code => getInternalPrelude().byName.get(name)!

/**
 * Adds the intrinsics available to `CodeFlags.INTERNAL` functions (both `@prelude` and `@vm-internal`) to `map`: the
 * internal helpers, and the `$` natives. Uses `VmIntrinsic` rather than `Native` so it never touches
 * `builtins.Function` or `nativeRule.sealed`.
 */
export const registerVmIntrinsics = (map: Map<string, unknown>, vm: Vm): void => {
  const ctx = vm.ctx
  const builtins = ctx.builtins
  const currentSite = () => vm.currentSite()
  for (const [name, code] of getInternalPrelude().byName) map.set(name, new VmInternalFn(code))

  const add = (name: string, fn: (args: Array<Value>) => NativeResult) => {
    map.set(name, new VmIntrinsic(name, fn))
  }

  add("$IsObj", ([v]) => v instanceof Obj)
  add("$IsDataObj", ([v]) => v instanceof Obj && !isOpaque(v))
  add("$IsDate", ([v]) => v instanceof DateObj)
  add("$IsPromise", ([v]) => v instanceof PromiseObj)
  add("$IsArray", ([v]) => v instanceof Arr)
  add("$IsCallableAny", ([v]) => v instanceof Callable)
  add("$GetMethod", ([v, name]) => {
    const m = get(v as Obj, name as string)
    return m instanceof Callable ? m : undefined
  })
  add("$PropKey", ([v]) => propertyKey(v) as Value)
  add("$CoerceToString", ([v]) => coerceToString(v))
  add("$ApplyToNumeric", ([incFlag, v]) => {
    if (isOpaque(v)) {
      const op = incFlag === 0 ? "++" : "--"
      throw invalidData(`'${op}' requires a data value.`, currentSite())
    }
    return coerceToNumber(v)
  })
  add("$ApplyUnary", ([sub, v]) => {
    if (isOpaque(v)) throw invalidData("Unary operators require data values.", currentSite())
    const n = coerceToNumber(v)
    return sub === UnaryOp.NEG ? -n : sub === UnaryOp.PLUS ? +n : ~n
  })
  add("$OpConvKind", ([op, lhs, rhs]) => {
    const conv = operatorConversion(op as string, lhs, rhs)
    if (conv === undefined) return 0
    if (conv.kind === "key") return 1
    return conv.hint === "default" ? 2 : 3
  })
  add("$ApplyBinary", ([op, lhs, rhs]) => applyBinaryOperator(op as string, lhs, rhs, currentSite()!))

  // Convert helpers
  add("$ConvValues", ([req]) => new Arr(builtins.Array, [...(req as unknown as Convert).values]))
  add("$ConvFlag", ([req, which]) => {
    const c = req as unknown as Convert
    return which === 0 ? c.coerce : c.ordinal
  })
  add("$ConvHint", ([req, idx]) => {
    const hints = (req as unknown as Convert).hints
    return typeof hints === "string" ? hints : hints[idx as number]!
  })
  add("$ConvCoerce", ([hint, val]) => (hint === "string" ? coerceToString(val) : coerceToNumber(val)))
  add("$IsConvert", ([res]) => res instanceof Convert)
  add("$ConvReplay", ([callable, target, args, constructing, replay]) => {
    const rep = (replay as Arr).items.map((item) => (item instanceof Arr ? item.items : undefined))
    conversions.count = 0
    conversions.replay = rep
    try {
      const fnObj = callable as Builtin
      const argList = (args as Arr).items
      return constructing
        ? fnObj.construct!(argList, target as Builtin, currentSite())
        : fnObj.invoke(target, argList, currentSite())
    } finally {
      conversions.replay = undefined
    }
  })

  // JSON walk helpers
  add("$JsonClassify", ([val, boundary, ancestors]) => {
    if (val === undefined || typeofValue(val) === "function") return 0
    if (typeof val === "number") return Number.isFinite(val) ? 1 : 2
    if (val === null || typeof val === "string" || typeof val === "boolean") return 1
    if (!(val instanceof Obj)) return 3
    if (boundary && val instanceof Bytes) {
      throw invalidData(
        "A Uint8Array cannot cross to the host; pass text instead, e.g. `new TextDecoder().decode(bytes)` or `bytes.toBase64()`.",
      )
    }
    if ((boundary && val instanceof URLSearchParamsObj) || val instanceof HeadersObj) return 3
    if ((ancestors as Arr).items.includes(val)) throw typeError("Converting circular structure to JSON.")
    if (boundary && val instanceof SetObj) return 4
    return 5
  })
  add("$JsonSpecial", ([val, boundary]) => {
    if (!(val instanceof Obj)) return new Obj(builtins.Object)
    if (boundary && val instanceof URLSearchParamsObj) return val.params.toString()
    if (val instanceof HeadersObj) return fromJson(ctx, Object.fromEntries(val.headers))
    return new Obj(builtins.Object)
  })
  add("$SetToArray", ([val]) => new Arr(builtins.Array, [...(val as SetObj).set.liveKeys()]))
  add("$NewNullProtoObj", () => new Obj(null))
  // The keys a JSON walk writes, in order: an error's name and message come first, then its other own keys.
  add("$JsonNames", ([target, boundary, properties]) => {
    const error = target instanceof ErrorObj
    const propFilter = properties instanceof Arr ? new Set(properties.items as Array<string>) : undefined
    const list = keys(target as Obj).filter(
      (k) =>
        !(error && (k === "name" || k === "message")) &&
        !(boundary && k === "__proto__") &&
        (propFilter === undefined || propFilter.has(k)),
    )
    return new Arr(builtins.Array, error ? ["name", "message", ...list] : list)
  })
  add("$ArrayPop", ([arr]) => (arr as Arr).items.pop())
  add("$JsonFinish", ([boundary, root, properties, indent]) => {
    const plain = toPlainJson(root)
    if (boundary) return plain as Value
    const props = properties instanceof Arr ? (properties.items as Array<string>) : null
    const text = JSON.stringify(plain, props, indent as string | number | undefined)
    if (text !== undefined) checkStringLength(text.length)
    return text
  })
}

const toPlainJson = (val: Value): Json | undefined => {
  if (val === undefined) return undefined
  if (val === null || typeof val === "string" || typeof val === "number" || typeof val === "boolean") return val
  if (val instanceof Arr) return val.items.map((item) => toPlainJson(item) ?? null)
  if (val instanceof Obj) {
    const out: Record<string, Json> = {}
    for (const [k, slot] of val.props) {
      if (typeof k !== "string" || !slot.enumerable || !("value" in slot)) continue
      const v = toPlainJson(slot.value)
      if (v !== undefined) {
        if (k === "__proto__") {
          Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true })
        } else {
          out[k] = v
        }
      }
    }
    return out
  }
  return {}
}

/**
 * Budgeted native fast path for copying plain data at the host boundary (`boundary`) or for `JSON.stringify`. Returns
 * `{ ok: true, json }` if the tree has no custom `toJSON`, promises, or shared references revisited more than `budget`
 * times; otherwise the prelude walk (`$vmJsonWalk`) does the work, ticking fuel.
 *
 * Both give the text `JSON.stringify` would: `toJSON` is honored, functions and `undefined` vanish, non-finite numbers
 * become null, and everything else is copied. Two departures from JS so a mistake is not a silent `{}`: an Error
 * serializes as `{ name, message, ...own }`, and a promise throws. At the host boundary a promise is awaited, a Set
 * crosses as an array, a URLSearchParams as its query string, a Uint8Array asks to be encoded as text first, and a
 * `__proto__` key is dropped so host code can never receive one.
 */
export const tryFastBoundaryOrJson = (
  builtins: Builtins,
  value: Value,
  boundary: boolean,
  revisitBudget = 2048,
): { readonly ok: true; readonly json: Json | undefined } | { readonly ok: false } => {
  if (value === undefined) return { ok: true, json: undefined }
  if (value === null || typeof value === "string" || typeof value === "boolean") return { ok: true, json: value }
  if (typeof value === "number") return { ok: true, json: Number.isFinite(value) ? value : null }
  if (
    value instanceof Obj &&
    value.constructor === Obj &&
    value.proto === builtins.Object &&
    value.proto.intrinsic > 0 &&
    value.props.size <= 4 &&
    !value.props.has("toJSON")
  ) {
    const flatOut: Record<string, Json> = {}
    let flatOk = true
    for (const [k, slot] of value.props) {
      if (typeof k !== "string" || !slot.enumerable) continue
      if (k === "__proto__") {
        if (!boundary) flatOk = false
        continue
      }
      if (!("value" in slot)) {
        flatOk = false
        break
      }
      const pv = slot.value
      if (pv === undefined) continue
      if (pv === null || typeof pv === "string" || typeof pv === "boolean") {
        flatOut[k] = pv
      } else if (typeof pv === "number") {
        flatOut[k] = Number.isFinite(pv) ? pv : null
      } else {
        flatOk = false
        break
      }
    }
    if (flatOk) return { ok: true, json: flatOut }
  }
  let remainingRevisits = revisitBudget
  const ancestors = new Set<Obj>()
  const seen = new Set<Obj>()
  const objectProto = builtins.Object
  let dateProtoToJSON: Value | undefined
  let urlProtoToJSON: Value | undefined

  const visit = (
    cur: Value,
    depth: number,
  ): { readonly ok: true; readonly json: Json | undefined } | { readonly ok: false } => {
    if (depth > MAX_VALUE_DEPTH) throw rangeError(`Value exceeds the maximum depth of ${MAX_VALUE_DEPTH}.`)
    if (cur === undefined || typeofValue(cur) === "function") return { ok: true, json: undefined }
    if (typeof cur === "number") return { ok: true, json: Number.isFinite(cur) ? cur : null }
    if (cur === null || typeof cur === "string" || typeof cur === "boolean") return { ok: true, json: cur }
    if (cur instanceof PromiseObj) return { ok: false }
    if (!(cur instanceof Obj)) return { ok: true, json: {} }
    if (seen.has(cur)) {
      if (--remainingRevisits <= 0) return { ok: false }
    } else {
      seen.add(cur)
    }
    const plain = cur.constructor === Obj
    const toJSON =
      plain && cur.proto === objectProto && objectProto.intrinsic > 0 && !cur.props.has("toJSON")
        ? undefined
        : get(cur, "toJSON")
    if (toJSON instanceof Callable) {
      if (cur instanceof DateObj && toJSON === (dateProtoToJSON ??= get(builtins.Date, "toJSON"))) {
        return { ok: true, json: Number.isFinite(cur.time) ? new Date(cur.time).toISOString() : null }
      }
      if (cur.tag === "URL" && toJSON === (urlProtoToJSON ??= get(builtins.URL, "toJSON"))) {
        return { ok: true, json: cur.toString() }
      }
      return { ok: false }
    }
    if (boundary && cur instanceof Bytes) {
      throw invalidData(
        "A Uint8Array cannot cross to the host; pass text instead, e.g. `new TextDecoder().decode(bytes)` or `bytes.toBase64()`.",
      )
    }
    if (boundary && cur instanceof URLSearchParamsObj) return { ok: true, json: cur.params.toString() }
    if (cur instanceof HeadersObj) return { ok: true, json: Object.fromEntries(cur.headers) }
    if (ancestors.has(cur)) throw typeError("Converting circular structure to JSON.")
    ancestors.add(cur)
    try {
      if (cur instanceof Arr || (boundary && cur instanceof SetObj)) {
        const items = cur instanceof Arr ? cur.items : [...cur.set.liveKeys()]
        const out: Array<Json> = new Array(items.length)
        for (let i = 0; i < items.length; i++) {
          const r = visit(items[i], depth + 1)
          if (!r.ok) return r
          out[i] = r.json ?? null
        }
        return { ok: true, json: out }
      }
      const out: Record<string, Json> = {}
      if (cur instanceof ErrorObj) {
        for (const k of ["name", "message"]) {
          const r = visit(get(cur, k), depth + 1)
          if (!r.ok) return r
          if (r.json !== undefined) out[k] = r.json
        }
      }
      // A plain object's own data is its property table; a wrapper (bytes, say) presents its own keys.
      for (const [k, slot] of plain ? cur.props : keys(cur).map((key) => [key, undefined] as const)) {
        if (typeof k !== "string" || (slot !== undefined && !slot.enumerable)) continue
        if (boundary && k === "__proto__") continue
        const propVal = slot === undefined ? get(cur, k) : "value" in slot ? slot.value : slot.get?.(cur)
        const r = visit(propVal, depth + 1)
        if (!r.ok) return r
        if (r.json !== undefined) {
          if (k === "__proto__") {
            Object.defineProperty(out, k, { value: r.json, enumerable: true, writable: true, configurable: true })
          } else {
            out[k] = r.json
          }
        }
      }
      return { ok: true, json: out }
    } finally {
      ancestors.delete(cur)
    }
  }

  return visit(value, 0)
}
