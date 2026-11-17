const out = []
const probe = (f) => { try { out.push(f()) } catch (e) { out.push([e.name, e.message]) } }
for (const k of ["source", "flags", "lastIndex", "global", "ignoreCase", "multiline", "dotAll", "unicode", "unicodeSets", "sticky", "hasIndices"]) probe(() => RegExp.prototype[k])
probe(() => Uint8Array.prototype.length); probe(() => Map.prototype.size); probe(() => Set.prototype.size); probe(() => URLSearchParams.prototype.size); probe(() => URL.prototype.href); probe(() => URL.prototype.searchParams); probe(() => TextDecoder.prototype.encoding); probe(() => TextEncoder.prototype.encoding)
probe(() => Object.create(RegExp.prototype).global); probe(() => Object.create(Map.prototype).size)
probe(() => [/a/g.global, /a/.source, new Map([[1, 1]]).size, new Uint8Array(3).length, "global" in RegExp.prototype, RegExp.prototype.hasOwnProperty("global"), Object.keys(RegExp.prototype), /x/y.flags, new URL("https://a.test").href, new TextDecoder().encoding])
probe(() => { RegExp.prototype.global = 1 })
probe(() => { const re = /a/g; re.lastIndex = 3; return [re.lastIndex, re.hasOwnProperty("lastIndex")] })
return out
