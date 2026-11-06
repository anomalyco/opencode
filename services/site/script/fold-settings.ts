// Production only: Settings and Design mode are development tools, so a production page always
// renders the default settings (settings-defaults.json) with Design mode off. This is the JavaScript
// counterpart of cssVariantsForProduction() in vite.config.ts: before Solid compiles a module, it
// reads every `siteSettings.<key>` as the default's literal, `designMode()` as false and
// `import.meta.env.DEV` as false, then folds what that decides (`<Show>`, `<Switch>`/`<Match>`,
// ternaries, `&&`/`||`, `if`), so the branches production never takes, and everything only they
// import, leave the bundle. The server and the browser builds fold the same way, so hydration keys
// still match. The development server is untouched.
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { transformSync, types, type NodePath, type PluginObj } from "@babel/core"
import type { Plugin } from "vite"
import defaults from "../src/component/site/settings-defaults.json"

// Settings that production pages change at runtime, so they stay live: ⇧A and ⇧N turn the home
// announcement on and off on any page (site-banner.tsx). Production reads and writes them in a store
// of their own (liveModule), so the Settings store and everything it needs leave the bundle. The
// build fails if production code writes any other setting (see generateBundle below).
const live = new Set(["homeAnnouncement"])
const liveModule = "virtual:fold-settings-live"

// Design mode's reordering and renaming, which save only while Design mode is on.
const designWrites = [
  "component/site/nav-order.tsx",
  "component/site/products-order.tsx",
  "component/site/home-order.tsx",
]

const root = path.resolve(import.meta.dirname, "..", "src")
const settingsModule = path.join(root, "component/site/settings.ts")
// Modules that export `siteSettings`: its own and Site's re-export.
const settingsModules = [settingsModule, path.join(root, "component/site/site.tsx")]
const designModules = [
  path.join(root, "component/site/design-copy.ts"),
  path.join(root, "component/site/design-mode.tsx"),
]
// A page's link preview card (lib/og.ts), from og-images.json, which script/og.ts writes before the
// build: `ogImage("/press")` becomes the card itself, so a page whose cards are all named that way
// doesn't download the list.
const ogModule = path.join(root, "lib/og.ts")
const ogCards = path.join(root, "lib/og-images.json")
const candidate =
  /\b(siteSettings|siteSettingsDefaults|setSiteSetting|designMode|designEditing|designCopy|ogImage|import\.meta\.env\.(DEV|PROD))\b/

export function foldSettingsForProduction(): Plugin {
  let cards: Record<string, unknown> = {}
  return {
    name: "fold-settings-for-production",
    apply: "build",
    enforce: "pre",
    async buildStart() {
      cards = existsSync(ogCards) ? JSON.parse(await readFile(ogCards, "utf8")) : {}
    },
    resolveId: (id) => (id === liveModule ? `\0${liveModule}` : undefined),
    load(id) {
      if (id !== `\0${liveModule}`) return
      const values = Object.fromEntries([...live].map((key) => [key, valueAt([key])]))
      return [
        `import { createStore } from "solid-js/store"`,
        `const [settings, set] = createStore(${JSON.stringify(values)})`,
        `export default { settings, set }`,
      ].join("\n")
    },
    async transform(code, id) {
      const file = id.split("?")[0]
      const result = foldModule(code, file, cards)
      if (!result?.code) return
      // FOLD_DEBUG=<directory> writes each folded module there, to see what production compiles.
      if (process.env.FOLD_DEBUG) {
        const out = path.join(process.env.FOLD_DEBUG, this.environment.name, path.relative(root, file))
        await mkdir(path.dirname(out), { recursive: true })
        await writeFile(out, result.code)
      }
      return { code: result.code, map: result.map }
    },
    // Checks what reaches the output. A production write to a folded setting would change nothing
    // on the page, so it fails the build: add the setting to `live` above (Settings never reaches
    // the output, and Design mode's own modules, designWrites, only write while it is on). Any read
    // left unfolded fails it too, as production's Settings store starts empty (settings.ts).
    generateBundle(_, bundle) {
      const modules = Object.values(bundle)
        .flatMap((chunk) => (chunk.type === "chunk" ? Object.entries(chunk.modules) : []))
        .map(([id, module]) => ({
          file: id.split("?")[0],
          code: (module.code ?? "").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""),
        }))
        .filter((module) => module.file.startsWith(root + path.sep) && module.file !== settingsModule)
      const name = (file: string) => path.relative(root, file)
      const written = modules
        .filter((module) => !designWrites.some((file) => module.file === path.join(root, file)))
        .flatMap((module) =>
          [...module.code.matchAll(/(?<!function )\bsetSiteSetting(?:\$\d+)?\(\s*(?:"(\w+)"|([^,)]+))/g)]
            .map((match) => match[1] ?? `<${match[2].trim()}>`)
            .map((key) => `${key} (${name(module.file)})`),
        )
      if (written.length)
        this.error(
          `fold-settings: production code writes folded settings: ${[...new Set(written)].join(", ")}. Add them to \`live\` in script/fold-settings.ts.`,
        )
      const read = modules
        .filter((module) => /\bsiteSettings(?:\$\d+)?\b/.test(module.code))
        .map((module) => name(module.file))
      if (read.length)
        this.error(
          `fold-settings: production code reads Settings in a way the build can't fold (a dynamic key, or the whole store): ${[...new Set(read)].join(", ")}. Read each setting as siteSettings.<key>.`,
        )
    },
  }
}

/**
 * One module as production compiles it, or undefined when nothing in it folds. `trimImports` also
 * drops imports left unused, for script/i18n-slices.ts, which reads the client's import graph to
 * find the strings each page can show; the build keeps them, as an imported module's CSS still
 * loads.
 */
export function foldModule(code: string, file: string, cards: Record<string, unknown> = {}, trimImports = false) {
  if (!file.startsWith(root + path.sep) || !/\.(ts|tsx)$/.test(file)) return
  if (file === settingsModule || designModules.includes(file)) return
  if (!candidate.test(code)) return
  // Babel installs its own Error.prepareStackTrace on first use, which breaks Error.captureStackTrace
  // for non-Error objects under Bun (vite's errors, in the same test process); keep the original.
  const prepare = Error.prepareStackTrace
  const result = transformSync(code, {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    parserOpts: { plugins: ["jsx", "typescript"] },
    plugins: [foldSettings(file, cards, trimImports)],
  })
  Error.prepareStackTrace = prepare
  return result
}

type Imports = {
  settings: Set<string>
  defaults: Set<string>
  setters: Set<string>
  og: Set<string>
  design: Map<string, string>
  solid: Map<string, string>
}

function foldSettings(file: string, cards: Record<string, unknown>, trimImports: boolean) {
  return (): PluginObj => ({
    name: "fold-settings",
    visitor: {
      Program(program) {
        const imports = readImports(program, file)
        const hoisted = new Map<string, types.Identifier>()
        // The live store, imported on first use.
        let liveStore: types.Identifier | undefined
        const store = () => (liveStore ??= program.scope.generateUidIdentifier("live"))
        program.traverse({
          MetaProperty(meta) {
            const env = meta.parentPath.parentPath
            if (!env?.isMemberExpression() || !meta.parentPath.isMemberExpression()) return
            const object = meta.parentPath.node
            if (!types.isIdentifier(object.property, { name: "env" }) || object.computed) return
            const flag = env.node.property
            if (env.node.computed || !types.isIdentifier(flag) || !["DEV", "PROD"].includes(flag.name)) return
            if (isWritten(env)) return
            env.replaceWith(types.booleanLiteral(flag.name === "PROD"))
          },
          Identifier(identifier) {
            if (!identifier.isReferencedIdentifier()) return
            const name = identifier.node.name
            if (imports.settings.has(name) || imports.defaults.has(name)) {
              replaceSetting(identifier, imports.settings.has(name), program, hoisted, store)
              return
            }
            const call = identifier.parentPath
            const key = call.isCallExpression() ? call.node.arguments[0] : undefined
            if (
              imports.og.has(name) &&
              isImported(identifier, name) &&
              call.isCallExpression({ callee: identifier.node })
            )
              if (types.isStringLiteral(key) && Object.hasOwn(cards, key.value))
                call.replaceWith(types.valueToNode(cards[key.value]))
            if (
              imports.setters.has(name) &&
              isImported(identifier, name) &&
              call.isCallExpression({ callee: identifier.node })
            )
              if (types.isStringLiteral(key) && live.has(key.value))
                identifier.replaceWith(types.memberExpression(types.cloneNode(store()), types.identifier("set")))
            const design = imports.design.get(name)
            if (!design || !isImported(identifier, name)) return
            if (!call.isCallExpression() || call.node.callee !== identifier.node) return
            const fallback = call.node.arguments[1]
            if (design === "designMode" || design === "designEditing") call.replaceWith(types.booleanLiteral(false))
            else if (design === "editing") call.replaceWith(types.identifier("undefined"))
            else if (
              design === "designCopy" &&
              types.isExpression(fallback) &&
              types.isStringLiteral(call.node.arguments[0])
            )
              call.replaceWith(fallback)
          },
        })
        const body = program.get("body")
        const last = body.findLast((statement) => statement.isImportDeclaration())
        const declarations = [...hoisted].map(([key, uid]) =>
          types.variableDeclaration("const", [types.variableDeclarator(uid, settingValue(key))]),
        )
        const liveImport = liveStore
          ? [types.importDeclaration([types.importDefaultSpecifier(liveStore)], types.stringLiteral(liveModule))]
          : []
        if (declarations.length && last) last.insertAfter(declarations)
        if (declarations.length && !last) program.unshiftContainer("body", declarations)
        if (liveImport.length) program.unshiftContainer("body", liveImport)
        program.scope.crawl()
        fold(program, imports)
        if (trimImports) removeUnusedImports(program)
      },
    },
  })
}

function removeUnusedImports(program: NodePath<types.Program>) {
  program.get("body").forEach((statement) => {
    if (!statement.isImportDeclaration() || !statement.node.specifiers.length) return
    const used = statement.node.specifiers.filter(
      (specifier) => program.scope.getBinding(specifier.local.name)?.referenced,
    )
    if (used.length === statement.node.specifiers.length) return
    if (!used.length) return statement.remove()
    statement.node.specifiers = used
  })
}

function readImports(program: NodePath<types.Program>, file: string): Imports {
  const imports: Imports = {
    settings: new Set(),
    defaults: new Set(),
    setters: new Set(),
    og: new Set(),
    design: new Map(),
    solid: new Map(),
  }
  program.get("body").forEach((statement) => {
    if (!statement.isImportDeclaration() || statement.node.importKind === "type") return
    const source = resolveSource(statement.node.source.value, file)
    statement.node.specifiers.forEach((specifier) => {
      if (!types.isImportSpecifier(specifier) || specifier.importKind === "type") return
      const imported = types.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value
      const local = specifier.local.name
      if (source === "solid-js") return imports.solid.set(local, imported)
      if (settingsModules.includes(source) && imported === "siteSettings") return imports.settings.add(local)
      if (settingsModules.includes(source) && imported === "setSiteSetting") return imports.setters.add(local)
      if (source === ogModule && imported === "ogImage") return imports.og.add(local)
      if (source === settingsModule && imported === "siteSettingsDefaults") return imports.defaults.add(local)
      if (designModules.includes(source) && ["designMode", "designEditing", "designCopy", "editing"].includes(imported))
        imports.design.set(local, imported)
    })
  })
  return imports
}

function resolveSource(source: string, file: string) {
  if (source.startsWith("~/")) return withExtension(path.join(root, source.slice(2)))
  if (source.startsWith(".")) return withExtension(path.resolve(path.dirname(file), source))
  return source
}

function withExtension(file: string) {
  if (/\.(ts|tsx)$/.test(file)) return file
  const known = [...settingsModules, ...designModules, ogModule]
  return [".ts", ".tsx"].map((extension) => file + extension).find((name) => known.includes(name)) ?? file
}

function isImported(identifier: NodePath<types.Identifier>, name: string) {
  return identifier.scope.getBinding(name)?.kind === "module"
}

// `siteSettings.a.b` becomes the default's literal when it is a string, number, boolean or null, or
// a module constant holding the default (one per key path, so it keeps its identity) when it is an
// object or array. A bare `siteSettings` stays the store.
function replaceSetting(
  identifier: NodePath<types.Identifier>,
  store: boolean,
  program: NodePath<types.Program>,
  hoisted: Map<string, types.Identifier>,
  liveStore: () => types.Identifier,
) {
  if (!isImported(identifier, identifier.node.name)) return
  const chain = memberChain(identifier)
  if (!chain.keys.length) {
    const read = store ? readKeys(identifier) : undefined
    if (read) identifier.replaceWith(types.valueToNode(Object.fromEntries(read.map((key) => [key, valueAt([key])]))))
    return
  }
  if (isWritten(chain.path)) return
  if (store && live.has(chain.keys[0])) {
    identifier.replaceWith(types.memberExpression(types.cloneNode(liveStore()), types.identifier("settings")))
    return
  }
  const value = valueAt(chain.keys)
  if (value === missing) return
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    chain.path.replaceWith(types.valueToNode(value))
    return
  }
  const key = chain.keys.join(".")
  const uid = hoisted.get(key) ?? program.scope.generateUidIdentifier(`setting_${chain.keys.join("_")}`)
  hoisted.set(key, uid)
  chain.path.replaceWith(types.cloneNode(uid))
}

const missing = Symbol("missing")

// The keys a local function reads from the settings passed to it (`searchLook(siteSettings)`), when
// it only ever reads static keys of that parameter, so the call can get those defaults instead.
function readKeys(identifier: NodePath<types.Identifier>) {
  const call = identifier.parentPath
  if (!call.isCallExpression() || !types.isIdentifier(call.node.callee)) return undefined
  const index = call.node.arguments.indexOf(identifier.node)
  const binding = call.scope.getBinding(call.node.callee.name)
  const target = binding?.path.isVariableDeclarator() ? binding.path.get("init") : binding?.path
  if (index < 0 || !target || (!target.isFunctionDeclaration() && !target.isArrowFunctionExpression())) return undefined
  if (binding?.constantViolations.length) return undefined
  const param = target.node.params[index]
  if (!types.isIdentifier(param)) return undefined
  const references = target.scope.getBinding(param.name)?.referencePaths ?? []
  const keys = references.map((reference) => {
    const member = reference.parentPath
    if (!member?.isMemberExpression({ object: reference.node }) || isWritten(member)) return undefined
    const key = staticKey(member.node)
    return key !== undefined && valueAt([key]) !== missing ? key : undefined
  })
  if (!keys.length || keys.includes(undefined)) return undefined
  return [...new Set(keys as string[])]
}

function valueAt(keys: string[]): unknown {
  return keys.reduce<unknown>((value, key) => {
    if (value === missing || typeof value !== "object" || value === null || !Object.hasOwn(value, key)) return missing
    return (value as Record<string, unknown>)[key]
  }, defaults)
}

function settingValue(key: string) {
  return types.valueToNode(valueAt(key.split(".")))
}

// The longest run of static property reads off `identifier` (`siteSettings.carousel.xl`), stopping
// before a method call so `siteSettings.navConfig.find(...)` keeps the call.
function memberChain(identifier: NodePath<types.Identifier>) {
  const keys: string[] = []
  let current: NodePath = identifier
  while (
    current.parentPath?.isMemberExpression({ object: current.node }) ||
    current.parentPath?.isOptionalMemberExpression({ object: current.node })
  ) {
    const member = current.parentPath.node as types.MemberExpression
    const key = staticKey(member)
    if (key === undefined) break
    const next = valueAt([...keys, key])
    if (next === missing) break
    keys.push(key)
    current = current.parentPath
    if (next === null || typeof next !== "object") break
  }
  return { keys, path: current }
}

function staticKey(member: types.MemberExpression) {
  if (!member.computed && types.isIdentifier(member.property)) return member.property.name
  if (member.computed && types.isStringLiteral(member.property)) return member.property.value
  if (member.computed && types.isNumericLiteral(member.property)) return String(member.property.value)
  return undefined
}

function isWritten(expression: NodePath) {
  const parent = expression.parentPath
  if (!parent) return false
  if (parent.isAssignmentExpression({ left: expression.node })) return true
  if (parent.isUpdateExpression()) return true
  if (parent.isUnaryExpression({ operator: "delete" })) return true
  return false
}

// Folds what the constants decide until nothing changes.
function fold(program: NodePath<types.Program>, imports: Imports) {
  let changed = true
  while (changed) {
    changed = false
    const mark = () => {
      changed = true
    }
    program.traverse({
      CallExpression: {
        exit(call) {
          const accessor = callValue(call)
          // Babel decides string methods on literals ("3 columns".charAt(0)) and Math, Number and String.
          const value = accessor === missing ? known(call) : accessor
          if (value === missing) return
          call.replaceWith(types.valueToNode(value))
          mark()
        },
      },
      // A static read of an object literal of constants (`{ src: "/og/home.png", alt }.src`).
      MemberExpression: {
        exit(member) {
          const object = member.get("object")
          const key = staticKey(member.node)
          if (!object.isObjectExpression() || key === undefined || isWritten(member)) return
          if (member.parentPath.isCallExpression({ callee: member.node })) return
          const properties = object.node.properties
          const plain = properties.every(
            (property) =>
              types.isObjectProperty(property) &&
              !property.computed &&
              (types.isIdentifier(property.key) || types.isStringLiteral(property.key)) &&
              types.isLiteral(property.value) &&
              !types.isTemplateLiteral(property.value),
          )
          if (!plain) return
          const found = properties.findLast(
            (property) =>
              types.isObjectProperty(property) &&
              (types.isIdentifier(property.key) ? property.key.name : (property.key as types.StringLiteral).value) ===
                key,
          ) as types.ObjectProperty | undefined
          if (!found) return
          member.replaceWith(found.value as types.Expression)
          mark()
        },
      },
      ConditionalExpression: {
        exit(conditional) {
          const test = known(conditional.get("test"))
          if (test === missing) return
          conditional.replaceWith(test ? conditional.node.consequent : conditional.node.alternate)
          mark()
        },
      },
      LogicalExpression: {
        exit(logical) {
          const left = known(logical.get("left"))
          if (left === missing) return
          const operator = logical.node.operator
          const keepLeft = operator === "&&" ? !left : operator === "||" ? !!left : left !== null && left !== undefined
          logical.replaceWith(keepLeft ? logical.node.left : logical.node.right)
          mark()
        },
      },
      "BinaryExpression|UnaryExpression": {
        exit(expression: NodePath) {
          if (expression.isUnaryExpression() && !["!", "typeof"].includes(expression.node.operator)) return
          if (expression.isBinaryExpression() && !["===", "!==", "==", "!="].includes(expression.node.operator)) return
          const value = known(expression)
          if (value === missing || !["boolean", "string"].includes(typeof value)) return
          expression.replaceWith(types.valueToNode(value))
          mark()
        },
      },
      // Statements after a return or throw never run (a folded `if (!designMode()) return`); hoisted
      // function and var declarations stay.
      "ReturnStatement|ThrowStatement": {
        exit(statement: NodePath) {
          if (!Array.isArray(statement.container)) return
          const after = statement.getAllNextSiblings()
          // A function declared there is dead too when only dead code calls it.
          const inside = (reference: NodePath) => after.some((next) => reference.isDescendant(next))
          const dead = after.filter((next) => {
            if (next.isVariableDeclaration({ kind: "var" })) return false
            if (!next.isFunctionDeclaration() || !next.node.id) return true
            return !!next.scope.parent?.getBinding(next.node.id.name)?.referencePaths.every(inside)
          })
          if (!dead.length) return
          dead.forEach((next) => next.remove())
          mark()
        },
      },
      IfStatement: {
        exit(statement) {
          const test = known(statement.get("test"))
          if (test === missing) return
          const branch = test ? statement.node.consequent : statement.node.alternate
          mark()
          if (!branch || (types.isBlockStatement(branch) && !branch.body.length)) return statement.remove()
          // A block's statements go in its place unless they declare something scoped to it.
          const lexical = types.isBlockStatement(branch)
            ? branch.body.some(
                (item) =>
                  types.isFunctionDeclaration(item) ||
                  types.isClassDeclaration(item) ||
                  (types.isVariableDeclaration(item) && item.kind !== "var"),
              )
            : true
          if (types.isBlockStatement(branch) && !lexical && Array.isArray(statement.container))
            statement.replaceWithMultiple(branch.body)
          else statement.replaceWith(branch)
        },
      },
      JSXExpressionContainer: {
        exit(container) {
          if (!container.parentPath.isJSXElement() && !container.parentPath.isJSXFragment()) return
          // Nothing to render: a boolean, null or undefined, written out or decided.
          const value = known(container.get("expression"))
          if (value !== null && value !== undefined && typeof value !== "boolean") return
          container.remove()
          mark()
        },
      },
      JSXElement: {
        exit(element) {
          const name = element.node.openingElement.name
          if (!types.isJSXIdentifier(name)) return
          const component = imports.solid.get(name.name)
          if (component === "Show" && foldShow(element)) return mark()
          if (component === "Switch" && foldSwitch(element, imports)) return mark()
        },
      },
    })
    program.scope.crawl()
  }
}

// A call to a local `const name = (...) => <constant>` arrow is its constant when the arguments are
// plain reads (`groupStart(index())`), and `["a", "b"].includes(<constant>)` is decided too.
function callValue(call: NodePath<types.CallExpression>): unknown {
  const callee = call.get("callee")
  if (callee.isIdentifier() && call.node.arguments.every(plainRead)) {
    const binding = call.scope.getBinding(callee.node.name)
    if (!binding || binding.kind !== "const" || binding.constantViolations.length) return missing
    const init = binding.path.isVariableDeclarator() ? binding.path.get("init") : undefined
    if (!init?.isArrowFunctionExpression() || init.node.async) return missing
    const body = init.get("body")
    if (Array.isArray(body) || !body.isExpression()) return missing
    const value = known(body)
    return value === missing || (value !== null && typeof value === "object") ? missing : value
  }
  if (callee.isMemberExpression() && types.isIdentifier(callee.node.property, { name: "includes" })) {
    const list = callee.get("object")
    const argument = call.get("arguments")[0]
    if (!list.isArrayExpression() || !argument || call.node.arguments.length !== 1 || !argument.isExpression())
      return missing
    const items = list.get("elements").map((item) => (item.isExpression() ? known(item) : missing))
    const value = known(argument)
    if (value === missing || items.includes(missing)) return missing
    return items.includes(value)
  }
  return missing
}

// An argument whose evaluation does nothing but read: a literal, a name, a property, or a call to
// an accessor with no arguments.
function plainRead(argument: types.Node): boolean {
  if (types.isLiteral(argument) || types.isIdentifier(argument)) return true
  if (types.isMemberExpression(argument)) return !argument.computed && plainRead(argument.object)
  return types.isCallExpression(argument) && !argument.arguments.length && types.isIdentifier(argument.callee)
}

// A constant value for `expression` when it has one and no side effects are lost by folding it.
function known(expression: NodePath): unknown {
  if (!expression.isExpression()) return missing
  let effects = false
  expression.traverse({
    "SequenceExpression|AssignmentExpression|UpdateExpression|AwaitExpression|YieldExpression"() {
      effects = true
    },
  })
  if (effects || expression.isSequenceExpression()) return missing
  const result = expression.evaluate()
  if (!result.confident) return missing
  const value = result.value
  if (typeof value === "function" || (typeof value === "object" && value !== null)) return missing
  return value
}

function attribute(element: NodePath<types.JSXElement>, name: string) {
  return element.node.openingElement.attributes.find(
    (item): item is types.JSXAttribute => types.isJSXAttribute(item) && types.isJSXIdentifier(item.name, { name }),
  )
}

function attributeExpression(element: NodePath<types.JSXElement>, name: string) {
  const index = element.node.openingElement.attributes.findIndex(
    (item) => types.isJSXAttribute(item) && types.isJSXIdentifier(item.name, { name }),
  )
  if (index < 0) return undefined
  const value = element.get(`openingElement.attributes.${index}.value`) as NodePath
  if (value.isJSXExpressionContainer()) return value.get("expression") as NodePath
  return value
}

function hasSpread(element: NodePath<types.JSXElement>) {
  return element.node.openingElement.attributes.some((item) => types.isJSXSpreadAttribute(item))
}

// The children to render in place of the element, or undefined when they're a callback
// (`{(value) => ...}`), which needs the `when` value. Whitespace-only text with a line break, which
// JSX drops, is left out.
function contents(children: types.JSXElement["children"]) {
  const kept = children.filter(
    (child) => !(types.isJSXText(child) && !child.value.trim() && child.value.includes("\n")),
  )
  if (kept.some((child) => types.isJSXExpressionContainer(child) && types.isFunction(child.expression)))
    return undefined
  return kept
}

function fallbackOf(element: NodePath<types.JSXElement>) {
  const value = attribute(element, "fallback")?.value
  if (!value) return null
  if (types.isJSXExpressionContainer(value))
    return types.isJSXEmptyExpression(value.expression) ? null : value.expression
  return value
}

// Puts `replacement` (an expression, or JSX children) where the element was: spliced into the
// parent's children inside JSX, or as one expression elsewhere.
function replaceElement(
  element: NodePath<types.JSXElement>,
  replacement: types.Expression | types.JSXElement["children"] | null,
) {
  const inJsx = element.parentPath.isJSXElement() || element.parentPath.isJSXFragment()
  const children = (replacement === null ? [] : Array.isArray(replacement) ? replacement : [replacement]).map(
    (child) =>
      types.isJSXElement(child) ||
      types.isJSXFragment(child) ||
      types.isJSXText(child) ||
      types.isJSXExpressionContainer(child) ||
      types.isJSXSpreadChild(child)
        ? child
        : types.jsxExpressionContainer(child),
  )
  if (inJsx) {
    if (!children.length) return element.remove()
    return element.replaceWithMultiple(children)
  }
  if (!children.length) return element.replaceWith(types.identifier("undefined"))
  const only = children[0]
  if (children.length === 1 && (types.isJSXElement(only) || types.isJSXFragment(only))) return element.replaceWith(only)
  if (children.length === 1 && types.isJSXExpressionContainer(only) && types.isExpression(only.expression))
    return element.replaceWith(only.expression)
  element.replaceWith(types.jsxFragment(types.jsxOpeningFragment(), types.jsxClosingFragment(), children))
}

function foldShow(element: NodePath<types.JSXElement>) {
  if (hasSpread(element)) return false
  const when = attributeExpression(element, "when")
  if (!when) return false
  const value = known(when)
  if (value === missing) return false
  if (!value) {
    replaceElement(element, fallbackOf(element))
    return true
  }
  const shown = contents(element.node.children)
  if (shown === undefined) return false
  replaceElement(element, shown)
  return true
}

// Drops each `<Match>` whose `when` is false; a first `<Match>` that is true becomes the whole switch.
function foldSwitch(element: NodePath<types.JSXElement>, imports: Imports) {
  if (hasSpread(element)) return false
  const matches = element.get("children").filter((child): child is NodePath<types.JSXElement> => {
    if (!child.isJSXElement()) return false
    const name = child.node.openingElement.name
    return types.isJSXIdentifier(name) && imports.solid.get(name.name) === "Match"
  })
  if (
    matches.length !== element.node.children.filter((child) => !(types.isJSXText(child) && !child.value.trim())).length
  )
    return false
  const decided = matches.map((match) => {
    const when = attributeExpression(match, "when")
    const value = hasSpread(match) || !when ? missing : known(when)
    return value === missing ? missing : !!value
  })
  // Matches that can never be chosen: false ones, and every one after a true one.
  const chosen = decided.indexOf(true)
  const kept = matches.filter((_, index) => decided[index] !== false && (chosen < 0 || index <= chosen))
  if (!kept.length) {
    replaceElement(element, fallbackOf(element))
    return true
  }
  const shown = decided[matches.indexOf(kept[0])] === true ? contents(kept[0].node.children) : undefined
  if (shown !== undefined) {
    replaceElement(element, shown)
    return true
  }
  if (kept.length === matches.length) return false
  matches.filter((match) => !kept.includes(match)).forEach((match) => match.remove())
  return true
}
