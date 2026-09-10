// CP-023 §7.7 / K106 — the self-maintaining caller inventory for `Session.updateMessage` and
// `Session.updatePart`.
//
// WHY THIS IS A SCANNER AND NOT A LIST. §7.7's classification of update callers was commit-message
// prose. Prose cannot fail. A caller added at Gate 5 or 6 would simply not appear in anyone's
// reasoning, and the classification would read as complete while being wrong. This module re-derives
// the caller set from source on every run, so the registry it is diffed against cannot silently rot.
//
// WHY THE AST AND NOT A REGEX. The call forms differ across the codebase — `session.ts:845` calls
// `updateMessage(...)` BARE (an in-file closure over the service) while other seams reach it through
// a service handle. An inventory keyed on the qualified string `Session.updateMessage` would report
// "all classified" while omitting the fork path entirely. Under-reporting is the one failure mode
// that matters here, because three later gates will trust this result.
//
// SCOPE DECISION (deliberate, not incidental): production sources only, resolved by DIRECTORY.
//   - `src/` is scanned because K106 exists to stop EXECUTION-CAPABLE mutation paths going
//     unclassified. Test callers are fixtures; they cannot execute in production.
//   - Including the 131 test call sites would bury 63 real ones and turn the registry into a
//     rubber-stamped maintenance chore — the exact rot K106 is meant to prevent.
//   - It is a directory walk rather than an enumerated file list SO THAT a production caller added
//     later, in a file nobody anticipated, is caught rather than silently omitted.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import ts from "typescript"

/**
 * The symbols §7.7 row-set K106 governs.
 *
 * `replacePart` joined them when the `replace_part` lease moved out of the HTTP handler and into
 * `Session.replacePart`. It has to be tracked for the same reason the other two are: it is a
 * part-write entry point on the Session service, so a caller added later would otherwise be
 * invisible to this inventory. Tracking it also keeps `handlers/session.ts::updatePart` a live
 * classification unit — the route still appears here, now as a caller of the guarded method rather
 * than as the place the guard lived.
 *
 * `updatePartDelta` is deliberately NOT tracked, and the reason is a fact rather than a judgement:
 * it publishes `MessageV2.Event.PartDelta`, and `packages/core/src/session/projector.ts` has no
 * projector for it at all. That file registers 34 events. The seven that write V1 rows are `Created`
 * (:216), `Updated` (:236), `Deleted` (:260), `MessageUpdated` (:263), `MessageRemoved` (:277),
 * `PartRemoved` (:296) and `PartUpdated` (:313); the remaining ~27 are `SessionEvent.*` routed to
 * `SessionMessageTable` (V2), a different table family that holds no V1 Part evidence. With no
 * projector there is no SQL and no durable row change, so `PartDelta` cannot delete, replace,
 * reorder, or alter the identity of anything a fence protects. That fact is pinned by its own
 * source-guard in `closure-update-authority.test.ts`, because tracking callers here would not catch
 * the change that would actually matter — someone ADDING a PartDelta projector.
 */
export const TRACKED = ["updateMessage", "updatePart", "replacePart"] as const
export type Tracked = (typeof TRACKED)[number]

/**
 * One classification unit: a named binding, in one production file, that calls a tracked symbol.
 *
 * Keyed by enclosing SYMBOL rather than by line, deliberately. A line-keyed registry is invalidated
 * by every unrelated edit above it, so it would be rewritten constantly and stop being read. The
 * authority story being classified is a property of the enclosing function — "what admission does
 * this code hold when it writes?" — not of the individual statement, so the symbol is both the
 * stable key and the meaningful one. A new call inside an already-classified function inherits that
 * function's authority and correctly does not fail; a call in a NEW function does.
 */
export type Site = {
  readonly file: string
  readonly symbol: string
  readonly calls: readonly { readonly symbol: Tracked; readonly line: number }[]
}

/**
 * A call form the scanner refuses to interpret.
 *
 * These FAIL the inventory rather than being skipped. A scanner that silently ignores what it cannot
 * parse manufactures exactly the false assurance this module exists to prevent, so an unresolvable
 * form is surfaced as a hard error demanding either a code change or an explicit decision.
 */
export type Unresolved = {
  readonly file: string
  readonly line: number
  readonly reason: string
  readonly text: string
}

export type Inventory = {
  readonly sites: readonly Site[]
  readonly unresolved: readonly Unresolved[]
}

const isTracked = (name: string): name is Tracked => (TRACKED as readonly string[]).includes(name)

const walkFiles = (root: string): string[] => {
  const out: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        visit(full)
        continue
      }
      if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full)
    }
  }
  visit(root)
  return out
}

/**
 * The nearest enclosing NAMED binding.
 *
 * Innermost rather than outermost: rolling every call up to a module-level `make` would collapse
 * eighteen distinct authority stories in `processor.ts` into one entry and defeat the point. Walking
 * up past anonymous arrows and function expressions is what lets a call inside
 * `parts.forEach((p) => updatePart(p))` still attribute to the helper that owns it.
 */
const isFunctionLike = (node: ts.Node) =>
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node)

/**
 * Name a function-like node by walking OUT through the wrappers that commonly enclose it.
 *
 * `Effect.gen(function* () {...})`, `Effect.fn("x")(function* ...)` and `pipe(...)` all sit between
 * the function and the binding that names it, so a direct parent check finds a CallExpression rather
 * than a name. Only non-function wrappers are traversed: hitting another function means this one is
 * genuinely anonymous and the caller should keep looking outward.
 */
const nameOfFunction = (fn: ts.Node): string | undefined => {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text
  if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) return fn.name.text
  let current: ts.Node | undefined = fn.parent
  while (current && !isFunctionLike(current)) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text
    if (ts.isPropertyAssignment(current) && ts.isIdentifier(current.name)) return current.name.text
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text
    if (
      !ts.isCallExpression(current) &&
      !ts.isParenthesizedExpression(current) &&
      !ts.isPropertyAccessExpression(current)
    )
      return undefined
    current = current.parent
  }
  return undefined
}

/**
 * The enclosing FUNCTION's name — not the nearest variable declaration.
 *
 * The distinction is load-bearing and was a real defect in the first version of this scanner. For
 * `const part = yield* session.updatePart(...)` the nearest VariableDeclaration is `part`, the
 * ASSIGNMENT TARGET, not the function doing the writing. Keying on that produced three separate
 * consequences, each fatal to the registry's purpose: keys changed when an unrelated local was
 * renamed; distinct bindings that happened to share a local name (`processor.ts` has three
 * `const part`) collapsed into one unit; and a NEW caller that assigned to an already-registered
 * local name would silently inherit its classification instead of failing as unclassified.
 *
 * Anonymous callbacks are stepped over rather than treated as units, so a write inside
 * `parts.forEach((p) => updatePart(p))` still attributes to the helper that owns it.
 */
const enclosingSymbol = (node: ts.Node): string | undefined => {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (isFunctionLike(current)) {
      const name = nameOfFunction(current)
      if (name) return name
    }
    current = current.parent
  }
  return undefined
}

export const scan = (root: string): Inventory => {
  const found = new Map<string, { file: string; symbol: string; calls: { symbol: Tracked; line: number }[] }>()
  const unresolved: Unresolved[] = []

  for (const path of walkFiles(root)) {
    const text = readFileSync(path, "utf8")
    // A cheap pre-filter: most files mention neither symbol, and parsing every file in `src/` on
    // every test run is wasted work.
    if (!TRACKED.some((name) => text.includes(name))) continue
    const file = relative(root, path).split(sep).join("/")
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true)
    const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1

    const record = (name: Tracked, node: ts.Node) => {
      const symbol = enclosingSymbol(node)
      if (!symbol) {
        unresolved.push({
          file,
          line: lineOf(node),
          reason: "call is not inside any named binding, so it has no stable classification key",
          text: node.getText(source).slice(0, 100),
        })
        return
      }
      const key = `${file}::${symbol}`
      const existing = found.get(key)
      if (existing) {
        existing.calls.push({ symbol: name, line: lineOf(node) })
        return
      }
      found.set(key, { file, symbol, calls: [{ symbol: name, line: lineOf(node) }] })
    }

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        // Bare form — `updateMessage({...})`, an in-file closure over the service. This is the form
        // a qualified-string inventory misses, and `session.ts`'s fork path uses it.
        if (ts.isIdentifier(callee) && isTracked(callee.text)) record(callee.text, node)
        // Qualified and service-handle forms — `Session.updateMessage(...)`, `svc.updatePart(...)`.
        // Matched on the property NAME, so the receiver's spelling is irrelevant.
        else if (ts.isPropertyAccessExpression(callee) && isTracked(callee.name.text)) record(callee.name.text, node)
        // Computed dispatch — `svc["updateMessage"](...)`. Statically knowable here, but it signals a
        // pattern that could just as easily be a non-literal key, so it is refused rather than
        // quietly accepted.
        else if (ts.isElementAccessExpression(callee)) {
          const arg = callee.argumentExpression
          const literal = ts.isStringLiteral(arg) ? arg.text : undefined
          if (literal && isTracked(literal))
            unresolved.push({
              file,
              line: lineOf(node),
              reason: "computed-property call; rewrite as a direct property access so the inventory can key it",
              text: node.getText(source).slice(0, 100),
            })
        }
      }
      // A REFERENCE that is not itself a call: `const write = svc.updatePart` or passing
      // `session.updateMessage` as a callback. The eventual call site is not statically knowable, so
      // the escape is reported rather than skipped — otherwise an aliased caller is invisible.
      if (
        ts.isPropertyAccessExpression(node) &&
        isTracked(node.name.text) &&
        !(ts.isCallExpression(node.parent) && node.parent.expression === node)
      )
        unresolved.push({
          file,
          line: lineOf(node),
          reason: "tracked symbol referenced without being called; its eventual call site cannot be resolved",
          text: node.getText(source).slice(0, 100),
        })
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(source, visit)
  }

  const sites = [...found.values()]
    .map((item) => ({ ...item, calls: [...item.calls].sort((a, b) => a.line - b.line) }))
    .sort((a, b) => (a.file === b.file ? a.symbol.localeCompare(b.symbol) : a.file.localeCompare(b.file)))
  return { sites, unresolved }
}

export const key = (site: { readonly file: string; readonly symbol: string }) => `${site.file}::${site.symbol}`

/**
 * CP-023 §7.7, EventV2 Session replay/projectors row: "All current Session replay must route through
 * the closure-aware EventV2Bridge wrapper; direct unguarded core Session replay is forbidden."
 *
 * WHY THIS EXISTS WHEN THERE IS NO DEFECT. `EventV2.Service` is acquired in exactly one place today
 * and every production replay site is lexically inside `SessionMutation.replayLeased`, so the rule
 * holds — by CONVENTION. Nothing stopped a new module from acquiring the raw tag and replaying
 * around `SessionReplayPermit`, and §7.7 calls that "forbidden" rather than "discouraged". A rule
 * enforced by nobody is a rule that survives exactly until the next author who has not read it.
 * This converts it into construction, using the walker and AST idiom `scan` already established.
 *
 * THREE FORMS, because a text search catches only the first and the other two are the realistic
 * evasions rather than hypothetical ones:
 *
 *   - `qualified` — `EventV2.Service`, the ordinary spelling.
 *   - `imported` — `import { Service } from "@opencode-ai/core/event"`, then a bare `Service`. This
 *     is invisible to a search for "EventV2.Service" and is the shape an auto-import produces.
 *   - `computed` — `EventV2["Service"]`. Statically readable here, but it signals a pattern that
 *     could just as easily be a non-literal key, so it is reported rather than quietly accepted —
 *     the same refusal `scan` applies to computed dispatch.
 *
 * It deliberately reports the ACQUISITION rather than the replay call. Holding the raw service is
 * what confers the ability to bypass the permit; where the call then happens is unbounded, which is
 * the same reason `scan` refuses an aliased reference instead of trying to follow it.
 */
export type ServiceAcquisition = {
  readonly file: string
  readonly line: number
  readonly form: "qualified" | "imported" | "computed"
  readonly text: string
}

export type ServiceAcquisitionInventory = {
  readonly acquisitions: readonly ServiceAcquisition[]
  readonly unresolved: readonly Unresolved[]
}

const CORE_EVENT_MODULE = "@opencode-ai/core/event"

/**
 * Every acquisition of `<namespace>.Service` for one module, in the three forms that reach it.
 *
 * Generalized at Gate 7's remediation from the EventV2-only version, because a second authority
 * needed exactly the same instrument and copying it would have made the next divergence invisible.
 * `scanEventServiceAcquisitions` below is now a thin application of this and its contract is
 * unchanged.
 *
 * `specifier` is matched exactly OR by final path segment, so a package path
 * (`@opencode-ai/core/event`) and the relative spellings of an in-package module
 * (`./toolpart-permit`, `../toolpart-permit`) are both reached. The segment match is what stops a
 * caller from evading the inventory by importing through a different relative depth.
 */
export const scanServiceAcquisitions = (
  root: string,
  target: { readonly specifier: string; readonly namespace: string; readonly member?: string },
): ServiceAcquisitionInventory => {
  const member = target.member ?? "Service"
  const found: ServiceAcquisition[] = []
  const unresolved: Unresolved[] = []
  const segment = target.specifier.split("/").pop()!
  const matches = (spec: string) => spec === target.specifier || spec.split("/").pop() === segment

  for (const path of walkFiles(root)) {
    const text = readFileSync(path, "utf8")
    // Same cheap pre-filter as `scan`: a file that names neither the module nor the namespace cannot
    // acquire from it. Both are checked because the namespace can arrive through a re-export.
    if (!text.includes(segment) && !text.includes(target.namespace)) continue
    const file = relative(root, path).split(sep).join("/")
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true)
    const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    const add = (form: ServiceAcquisition["form"], node: ts.Node) =>
      found.push({ file, line: lineOf(node), form, text: node.getText(source).slice(0, 100) })
    const refuse = (node: ts.Node, reason: string) =>
      unresolved.push({ file, line: lineOf(node), reason, text: node.getText(source).slice(0, 100) })

    /**
     * Local names that stand for the module object.
     *
     * SEEDED WITH THE CANONICAL NAME rather than derived only from imports, deliberately. The
     * namespace arrives in this codebase through a re-export (`export * as SessionToolPartPermit`)
     * as well as through a direct import, so requiring an import binding would under-report. Seeding
     * over-reports at worst — an unrelated local of the same name would be surfaced for review,
     * which is the safe direction for an inventory.
     */
    const namespaces = new Set<string>([target.namespace])

    // TWO PASSES, because an acquisition can lexically precede nothing but must be judged against
    // the file's whole import surface. `scanExportedCalls` established the idiom for the same reason.
    const collectImports = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        matches(node.moduleSpecifier.text)
      ) {
        const bindings = node.importClause?.namedBindings
        /**
         * `import * as Permits from "./toolpart-permit"`, then `Permits.Service`.
         *
         * THE EVASION GATE 7's THIRD AUDIT DEMONSTRATED. The previous version matched the receiver
         * by NAME against `target.namespace`, so a namespace import under any other local name was
         * invisible and the acquisition set kept reading as complete. It is REFUSED rather than
         * followed: resolving an alias would be guessing, and skipping it manufactures exactly the
         * assurance this inventory exists to provide. The local name is still tracked so the
         * acquisition itself is reported too — the refusal and the row are complementary signals.
         */
        if (bindings && ts.isNamespaceImport(bindings)) {
          if (bindings.name.text !== target.namespace)
            refuse(
              bindings,
              "module namespace imported under a different local name; the inventory cannot key an alias",
            )
          namespaces.add(bindings.name.text)
        }
        if (bindings && ts.isNamedImports(bindings))
          for (const element of bindings.elements) {
            const exported = (element.propertyName ?? element.name).text
            const local = element.name.text
            // `import { SessionToolPartPermit as Permits }` and `import { Service as Tag }` alike.
            if (exported !== local) {
              refuse(element, "tracked binding imported under an alias; the inventory cannot key an alias")
              namespaces.add(local)
              continue
            }
            if (exported === target.namespace) namespaces.add(local)
            if (exported === member) add("imported", element)
          }
      }
      ts.forEachChild(node, collectImports)
    }
    ts.forEachChild(source, collectImports)

    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text)
      )
        if (node.name.text === member) add("qualified", node)
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text)
      ) {
        const arg = node.argumentExpression
        if (ts.isStringLiteral(arg)) {
          if (arg.text === member) add("computed", node)
        } else
          // A non-literal key on a receiver that IS the tracked module. Unlike `scanMemberCalls`,
          // where the receiver is any value and refusing dynamic dispatch would be unworkable, the
          // receiver here is bounded — so an unreadable key is a genuine hole and is refused.
          refuse(node, "computed acquisition with a non-literal key; the inventory cannot resolve the member reached")
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(source, visit)
  }

  return {
    acquisitions: found.sort((left, right) =>
      left.file === right.file ? left.line - right.line : left.file.localeCompare(right.file),
    ),
    unresolved,
  }
}

/**
 * CP-023 §7.7, EventV2 Session replay/projectors row: "All current Session replay must route through
 * the closure-aware EventV2Bridge wrapper; direct unguarded core Session replay is forbidden."
 *
 * WHY THIS EXISTS WHEN THERE IS NO DEFECT. `EventV2.Service` is acquired in exactly one place today
 * and every production replay site is lexically inside `SessionMutation.replayLeased`, so the rule
 * holds — by CONVENTION. Nothing stopped a new module from acquiring the raw tag and replaying
 * around `SessionReplayPermit`, and §7.7 calls that "forbidden" rather than "discouraged". A rule
 * enforced by nobody is a rule that survives exactly until the next author who has not read it.
 * This converts it into construction, using the walker and AST idiom `scan` already established.
 *
 * THREE FORMS, because a text search catches only the first and the other two are the realistic
 * evasions rather than hypothetical ones:
 *
 *   - `qualified` — `EventV2.Service`, the ordinary spelling.
 *   - `imported` — `import { Service } from "@opencode-ai/core/event"`, then a bare `Service`. This
 *     is invisible to a search for "EventV2.Service" and is the shape an auto-import produces.
 *   - `computed` — `EventV2["Service"]`. Statically readable here, but it signals a pattern that
 *     could just as easily be a non-literal key, so it is reported rather than quietly accepted —
 *     the same refusal `scan` applies to computed dispatch.
 *
 * It deliberately reports the ACQUISITION rather than the replay call. Holding the raw service is
 * what confers the ability to bypass the permit; where the call then happens is unbounded, which is
 * the same reason `scan` refuses an aliased reference instead of trying to follow it.
 */
export const scanEventServiceAcquisitions = (root: string): ServiceAcquisitionInventory =>
  scanServiceAcquisitions(root, { specifier: CORE_EVENT_MODULE, namespace: "EventV2" })

/**
 * One call of a tracked EXPORTED function, attributed to the symbol that made it.
 *
 * The sibling of `scan` for a different question. `scan` asks "who calls a Session mutation method?"
 * and keys on the method NAME regardless of receiver, because the receiver is a service handle whose
 * spelling is irrelevant. This asks "who calls this exported FUNCTION?", where the receiver is a
 * module namespace and the spelling is the whole binding — so it resolves the import instead of
 * matching a name, and an alias is refused rather than followed.
 */
export type ExportedCall = {
  readonly file: string
  readonly symbol: string
  readonly member: string
  readonly line: number
  readonly form: "qualified" | "imported"
  readonly text: string
}

export type ExportedCallInventory = {
  readonly calls: readonly ExportedCall[]
  readonly unresolved: readonly Unresolved[]
}

/**
 * CP-023 §7.5/§7.7, Gate 7 re-audit MUST-FIX 2: an exported function whose callers are not
 * inventoried is not bounded, whatever its prose claims.
 *
 * WHY A SUBSTRING SEARCH WAS NOT ENOUGH, stated because the thing it replaced looked sufficient and
 * passed. The previous instrument read the source of every file and asked whether it `includes` a
 * literal call spelling. Gate 7's re-audit put a second, aliased production mint in the tree and the
 * whole suite stayed green: a named import, an alias, or a local wrapper defeats a substring search,
 * and none of those is exotic — the first is what an auto-import produces.
 *
 * WHAT IS REFUSED RATHER THAN FOLLOWED, on `scan`'s reasoning. An aliased import, a computed member,
 * and a reference that is not itself a call all become `unresolved`, which FAILS the inventory. A
 * scanner that quietly followed an alias would be guessing; one that quietly skipped it would
 * manufacture the assurance this exists to prevent. Refusing demands either a code change or an
 * explicit decision, which is the only honest third option.
 */
export const scanExportedCalls = (
  root: string,
  target: { readonly specifier: string; readonly namespace: string; readonly members: readonly string[] },
): ExportedCallInventory => {
  const calls: ExportedCall[] = []
  const unresolved: Unresolved[] = []
  const segment = target.specifier.split("/").pop()!
  const matches = (spec: string) => spec === target.specifier || spec.split("/").pop() === segment
  const tracked = (name: string) => target.members.includes(name)

  for (const path of walkFiles(root)) {
    const text = readFileSync(path, "utf8")
    if (!text.includes(segment) && !text.includes(target.namespace)) continue
    const file = relative(root, path).split(sep).join("/")
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true)
    const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    const refuse = (node: ts.Node, reason: string) =>
      unresolved.push({ file, line: lineOf(node), reason, text: node.getText(source).slice(0, 100) })

    // Local names that resolve to the tracked module. `namespaces` hold the module object;
    // `direct` hold one member each. Both are populated only from an UNALIASED import, so a local
    // name here always equals the exported name it stands for.
    const namespaces = new Set<string>()
    const direct = new Map<string, string>()

    const collectImports = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        matches(node.moduleSpecifier.text)
      ) {
        const bindings = node.importClause?.namedBindings
        if (bindings && ts.isNamespaceImport(bindings)) {
          if (bindings.name.text !== target.namespace)
            refuse(bindings, "namespace imported under a different local name; the inventory cannot key an alias")
          namespaces.add(bindings.name.text)
        }
        if (bindings && ts.isNamedImports(bindings))
          for (const element of bindings.elements) {
            const exported = (element.propertyName ?? element.name).text
            const local = element.name.text
            if (exported !== local) {
              refuse(element, "tracked binding imported under an alias; the inventory cannot key an alias")
              continue
            }
            if (exported === target.namespace) namespaces.add(local)
            else if (tracked(exported)) direct.set(local, exported)
          }
      }
      ts.forEachChild(node, collectImports)
    }
    ts.forEachChild(source, collectImports)
    if (namespaces.size === 0 && direct.size === 0) continue

    const record = (member: string, form: ExportedCall["form"], node: ts.Node) => {
      const symbol = enclosingSymbol(node)
      if (!symbol) {
        refuse(node, "call is not inside any named binding, so it has no stable classification key")
        return
      }
      calls.push({ file, symbol, member, line: lineOf(node), form, text: node.getText(source).slice(0, 100) })
    }

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        if (ts.isIdentifier(callee) && direct.has(callee.text)) record(direct.get(callee.text)!, "imported", node)
        else if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          namespaces.has(callee.expression.text) &&
          tracked(callee.name.text)
        )
          record(callee.name.text, "qualified", node)
      }
      // Computed dispatch through the namespace — statically readable, refused for `scan`'s reason:
      // the same shape could just as easily carry a non-literal key.
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text)
      ) {
        const arg = node.argumentExpression
        if (ts.isStringLiteral(arg) && tracked(arg.text))
          refuse(node, "computed-property access; rewrite as a direct property access so the inventory can key it")
      }
      // A tracked member REFERENCED without being called: `const f = NS.terminalizeExact`, or passed
      // as a callback. The eventual call site is not statically knowable, so the escape is reported.
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text) &&
        tracked(node.name.text) &&
        !(ts.isCallExpression(node.parent) && node.parent.expression === node)
      )
        refuse(node, "tracked symbol referenced without being called; its eventual call site cannot be resolved")
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(source, visit)
  }

  return {
    calls: calls.sort((left, right) =>
      left.file === right.file ? left.line - right.line : left.file.localeCompare(right.file),
    ),
    unresolved,
  }
}

/**
 * Every call of a bare member NAME, whatever the receiver, keyed by enclosing symbol.
 *
 * The complement of `scanExportedCalls` and needed for one narrow case it cannot see: a method
 * reached through a value rather than through the module namespace. `SessionToolPartPermit.grant` is
 * now a SERVICE method, so the mint reads `runtime.toolPartPermit.grant(...)` and no import binding
 * connects that receiver to the module.
 *
 * IT IS SOUND ONLY FOR A NAME NOTHING ELSE USES, and the caller must establish that rather than
 * assume it — which is why this takes the names as an argument and the assertion, not this function,
 * owns the claim. `mint` currently has no other `.mint(` in `src/`; `issue` and `consume` do
 * (`handlers/pty.ts` ticket methods), which is precisely why the mint assertion tracks `mint` alone
 * and the bound on `issue`/`consume` comes from the acquisition inventory instead.
 *
 * THREE FORMS, and the last two are why this function was rebuilt at Gate 7's third audit. It
 * previously reported only direct property calls and returned no `unresolved` channel at all, so
 * `permits["grant"](...)` and `const mint = permits.grant` were both invisible — the first was
 * placed in the real adapter path with the whole suite still green. Both are now REFUSED, which
 * fails the inventory rather than quietly shrinking it.
 */
export type MemberCallInventory = {
  readonly sites: readonly Site[]
  readonly unresolved: readonly Unresolved[]
}

export const scanMemberCalls = (root: string, names: readonly string[]): MemberCallInventory => {
  const found = new Map<string, { file: string; symbol: string; calls: { symbol: Tracked; line: number }[] }>()
  const unresolved: Unresolved[] = []

  for (const path of walkFiles(root)) {
    const text = readFileSync(path, "utf8")
    if (!names.some((name) => text.includes(name))) continue
    const file = relative(root, path).split(sep).join("/")
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true)
    const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    const refuse = (node: ts.Node, reason: string) =>
      unresolved.push({ file, line: lineOf(node), reason, text: node.getText(source).slice(0, 100) })

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        if (ts.isPropertyAccessExpression(callee) && names.includes(callee.name.text)) {
          const symbol = enclosingSymbol(node) ?? "<anonymous>"
          const key = `${file}::${symbol}`
          const existing = found.get(key)
          const call = { symbol: callee.name.text as Tracked, line: lineOf(node) }
          if (existing) existing.calls.push(call)
          else found.set(key, { file, symbol, calls: [call] })
        } else if (ts.isElementAccessExpression(callee)) {
          /**
           * `permits["grant"](...)` — THE EVASION, verbatim.
           *
           * Gate 7's third audit placed exactly this inside the real adapter path: the suite stayed
           * at 40 pass / 0 fail, typecheck exited 0, and the inventory went on asserting exactly one
           * mint call site. An `ElementAccessExpression` is not a `PropertyAccessExpression`, so the
           * previous version walked straight past it — a scanner that silently skips a form is worse
           * than no scanner, because it launders the claim.
           */
          const arg = callee.argumentExpression
          if (ts.isStringLiteral(arg) && names.includes(arg.text))
            refuse(node, "computed-property call; rewrite as a direct property access so the inventory can key it")
        }
      }
      /**
       * `const mint = permits.grant` — the OTHER demonstrated evasion, and the reason a call-shaped
       * scan is not sufficient on its own. The eventual call site of a captured reference is not
       * statically knowable, so the escape is reported rather than skipped.
       *
       * THE RESIDUAL THIS CANNOT REACH, stated rather than implied: a receiver-blind scan cannot
       * refuse `permits[computeName()](...)`, because refusing every non-literal element access
       * across `src/` would be unworkable. That hole is closed on the other axis — the ACQUISITION
       * inventory bounds who may hold the receiver at all, and the split interfaces mean the value
       * the adapter holds has no such member to reach under any spelling.
       */
      if (
        ts.isPropertyAccessExpression(node) &&
        names.includes(node.name.text) &&
        !(ts.isCallExpression(node.parent) && node.parent.expression === node)
      )
        refuse(node, "tracked member referenced without being called; its eventual call site cannot be resolved")
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(source, visit)
  }

  return {
    sites: [...found.values()]
      .map((item) => ({ ...item, calls: [...item.calls].sort((a, b) => a.line - b.line) }))
      .sort((a, b) => (a.file === b.file ? a.symbol.localeCompare(b.symbol) : a.file.localeCompare(b.file))),
    unresolved,
  }
}
