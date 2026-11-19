const out = []
out.push("a1b".match(1), "xnullx".search(null), "abc".match(), "abc".matchAll ? [..."abc".matchAll()].length : 0, "a.b".match("."), "a+b".search({ toString() { return "\\+" } }))
try { "abc".match("(") } catch (e) { out.push(e.name, e.message.slice(0, 40)) }
try { "abc".matchAll(/a/) } catch (e) { out.push(e.name) }
out.push("3.7".replace(/\d\.\d/, Math.floor), "abc".replace(/b/, () => Promise.resolve(1)))
out.push("aaa".split(/a/), "a,b,c".split(/,/, 2), "abc".split(/(?:)/u), "a b  c".split(/\s+/), "Hello".split(/(l)/))
out.push("x".replace(/(y)?x/, "[$1]"), "abc".replace(/b/, "$`|$'"), "abc".replace(/(b)/, "$01$10$2"), "abc".replace("b", "$&$&"), "abc".replace("b", "$1"))
const r = /a/g; r.lastIndex = 5; out.push("aaa".match(r), r.lastIndex)
const r2 = /a/g; r2.lastIndex = 1; out.push([..."aaa".matchAll(r2)].length, r2.lastIndex)
const r3 = /a/y; out.push("baa".replace(r3, "x"), r3.lastIndex)
out.push(new RegExp(/ab/g).flags, new RegExp(/ab/g, "i").flags, new RegExp(/ab/g).source)
try { new RegExp("a", 1) } catch (e) { out.push(e.name, e.message) }
try { new RegExp("a", "gg") } catch (e) { out.push(e.name, e.message) }
out.push(/[/]/.source, /\//.source, `${/x/g}`, /x/ + "", /(a)|(b)/.exec("b"))
const re = /(\d+)/g
let m, found = []
while ((m = re.exec("1 22 333")) !== null) found.push(m[1], re.lastIndex)
out.push(found)
out.push("ab".replace(/(?:)/g, "-"), "😀".replace(/(?:)/gu, "-"), "😀".replace(/(?:)/g, "-").length)
out.push(/a/i.test("A"), /ß/i.test("SS"), /\u212A/i.test("k"), /\u212A/iu.test("k"))
return out
