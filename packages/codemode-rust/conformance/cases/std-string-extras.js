const out = []
out.push("\u0041\u030A".normalize(), "Å".normalize("NFD").length, "ﬁ".normalize("NFKC"), "ﬁ".normalize("NFKD"), "abc".normalize("NFC"))
try { "a".normalize("nope") } catch (e) { out.push(e.name, e.message) }
out.push("abc".isWellFormed(), "abc".toWellFormed())
out.push(String.raw({ raw: ["x", "y", "z"] }, 1), String.raw({ raw: { length: 2, 0: "p", 1: "q" } }, { toString() { return "!" } }))
try { String.raw({}) } catch (e) { out.push(e.name, e.message) }
try { "a".repeat(-1) } catch (e) { out.push(e.name, e.message) }
try { "a".padStart(2 ** 25) } catch (e) { out.push(e.name, e.message) }
out.push("a".split(undefined, 0), "a".split(undefined))
return out
