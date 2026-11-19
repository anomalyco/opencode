const out = []
const r = /(?<y>\d{4})-(?<m>\d\d)/d
const m = r.exec("on 2024-05 ok")
out.push([...m], m.index, m.input, m.groups, m.indices.map((x) => x), m.indices.groups)
out.push("aXbXc".split(/x/i), "abc".split(/(b)/), "".split(/a/), "".split(/(?:)/), "test".split(/(?:)/, 2), "a1b22c".split(/\d+/))
out.push("x".replace(/x/, "$<y>|$1|$0|$&|$$"), "abc".replace(/(?<n>b)/, "[$<n>]"), "aaa".replace(/a/g, "b"), "abc".replace(/(.)/g, "$1$1"))
out.push("a-b-c".replace(/-/g, (m, off, s) => `${m}${off}`), "John Smith".replace(/(\w+)\s(\w+)/, "$2, $1"))
const g = /o/g
out.push(g.test("foo"), g.lastIndex, g.test("foo"), g.lastIndex, g.test("foo"), g.lastIndex)
out.push("foo bar foo".match(/foo/g), "foo".match(/x/), "abc".match(/b/).index, "abc".search(/c/), "abc".search("z"))
out.push([..."a1b2c3".matchAll(/[a-z](\d)/g)].map((m) => [m[0], m[1], m.index]))
out.push(String(/a\/b/gi), /x/y.flags, /x/.source, new RegExp("a/b", "g").source, new RegExp("").source, RegExp("x", "i").ignoreCase)
out.push(/a/.global, /a/g.global, /a/s.dotAll, /a/m.multiline, /a/u.unicode, /a/y.sticky, /a/d.hasIndices)
const re = /a/g
re.lastIndex = "2"
out.push(re.lastIndex, re.hasOwnProperty("lastIndex"), Object.keys(re), JSON.stringify(re), typeof re, re instanceof RegExp, Object.prototype.toString.call(re))
out.push("héllo wörld".replace(/ö/, "o"), "héllo".match(/l+/).index, "😀a😀b".split(/[ab]/), "😀".match(/./)[0].length, "😀".match(/./u)[0].length)
out.push(RegExp.escape("1a.b-c"), "a.b.c".replaceAll(".", "!"), "a.b.c".replaceAll(/\./g, "!"))
try { "x".replaceAll(/x/, "y") } catch (e) { out.push(e.name) }
try { new RegExp("(") } catch (e) { out.push(e.name) }
try { "x".includes(/x/) } catch (e) { out.push(e.name) }
console.log(/ab+c/gi, [/x/])
out.push("a1b2".replace(/(?<d>\d)/g, (...args) => JSON.stringify(args)))
out.push("aaa".lastIndexOf("a"), /\bfoo\b/.test("a foo b"), /^\p{Lu}/u.test("Éa"), /[\u{1F600}]/u.test("😀"))
const sticky = /foo/y
sticky.lastIndex = 3
out.push(sticky.test("barfoo"), sticky.lastIndex, sticky.test("barfoo"), sticky.lastIndex)
return out
