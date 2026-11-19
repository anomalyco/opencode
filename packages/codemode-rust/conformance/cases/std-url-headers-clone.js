const out = []
const u = new URL("https://user:pw@example.com:8080/p/a?x=1#h")
for (const k of ["href","origin","protocol","username","password","host","hostname","port","pathname","search","hash"]) out.push(u[k])
u.port = "443"; u.protocol = "http"; u.search = "?a b"; u.hash = "x y"; u.pathname = "a b"; u.host = "foo:99"; out.push(u.href, u.searchParams.get("a b"))
u.searchParams.append("k", "v w"); out.push(u.href, u.search); u.search = ""; out.push(u.searchParams.size, String(u), JSON.stringify({ u }), u.toJSON(), u instanceof URL, Object.prototype.toString.call(u), Object.keys(u))
out.push(new URL("../x?y#z", "http://a/b/c/d").href, new URL("HTTP://EXAMPLE.com/./a/../b").href, new URL("http://[::1]:80/").href, new URL("file:///C:/a").href, new URL("mailto:x@y").pathname, new URL("http://bücher.de").hostname, new URL("blob:https://a.com/x").origin, new URL("/q", new URL("https://z.test/a")).href)
out.push(URL.canParse("nope"), URL.canParse("x", "https://a.test"), URL.parse("nope"), URL.parse("https://a.test/b").pathname)
for (const f of [() => new URL("nope"), () => new URL("x", "nope"), () => new URL(), () => URL("https://a"), () => { u.href = "nope" }, () => { u.origin = "x" }, () => { u.searchParams = 1 }]) { try { out.push(f()) } catch (e) { out.push([e.name, e.message]) } }
u.port = "nope"; u.protocol = "1x"; out.push(u.href)
const p = new URLSearchParams("?a=1&b=2&a=3&c=%20+d")
out.push(p.toString(), p.get("c"), p.getAll("a"), p.size, p.has("a", "3"), p.has("z"), p.get("z"))
p.sort(); out.push(String(p)); p.delete("a", "1"); p.set("b", "9"); p.append("e", "x/y é"); out.push(p.toString(), [...p.keys()], [...p.values()], [...p], [...p.entries()].length, Object.fromEntries(p))
const seen = []; p.forEach((v, k, self) => seen.push(k + "=" + v + (self === p))); out.push(seen)
out.push(new URLSearchParams({ x: 1, y: [1, 2] }).toString(), new URLSearchParams([["a", "1"], ["b", { toString() { return "t" } }]]).toString(), new URLSearchParams(new Map([["m", "n"]])).toString(), new URLSearchParams(p).toString(), new URLSearchParams(null).toString(), new URLSearchParams(5).toString(), new URLSearchParams("").size)
for (const f of [() => new URLSearchParams([["a"]]), () => new URLSearchParams(() => 1), () => p.append("a"), () => p.get(), () => URLSearchParams()]) { try { out.push(f()) } catch (e) { out.push([e.name, e.message]) } }
const h = new Headers({ "Content-Type": "text/plain", "X-Count": 1, "X-Null": null })
h.append("Accept", "text/html"); h.append("accept", "application/json"); h.set("x-count", "2"); h.delete("x-null"); h.append("Set-Cookie", "a=1"); h.append("set-cookie", "b=2")
out.push(h.get("content-type"), h.get("x-missing"), h.get("ACCEPT"), h.has("Accept"), h.has("x-null"), h.get("set-cookie"), h.getSetCookie(), [...h], [...h.keys()], [...h.values()], JSON.stringify(h), String(h), Object.fromEntries(h), new Headers(h).get("accept"), new Headers([["a", " b \t"]]).get("a"))
const hs = []; h.forEach((v, k) => hs.push(k)); out.push(hs)
for (const f of [() => new Headers([["a b", "c"]]), () => new Headers({ a: "x\ny" }), () => h.get("a b"), () => h.append("", "x"), () => new Headers(1), () => new Headers("a=1"), () => new Headers(null), () => new Headers(() => 1), () => new Headers([["a", "b", "c"]]), () => Headers(), () => h.append("a")]) { try { out.push(f()) } catch (e) { out.push([e.name, e.message]) } }
console.log(u, p, h, new Headers())
const src = { n: 1, a: [1, , 3], m: new Map([[1, { d: new Date(0) }]]), s: new Set(["x"]), r: /x/gi, b: new Uint8Array([1, 2]), e: new TypeError("bad", { cause: { c: 1 } }), buf: Buffer.from("hi") }
src.a.extra = "e"; src.again = src.m
const c = structuredClone(src)
out.push(c !== src, c.again === c.m, c.a.length, c.a.extra, c.m.get(1).d.getTime(), c.m.get(1).d instanceof Date, [...c.s], String(c.r), c.r.lastIndex, [...c.b], c.e instanceof TypeError, c.e.message, c.e.cause, Object.keys(c.e), Buffer.isBuffer(c.buf), c.buf instanceof Uint8Array, Object.isFrozen(structuredClone(Object.freeze({ x: 1 }))))
for (const v of [() => 1, Promise.resolve(1), new URL("https://a"), h, p, new WeakMap(), [1].values(), tools, Symbol.iterator]) { try { structuredClone(v) } catch (e) { out.push([e.name, e.message]) } }
try { structuredClone() } catch (e) { out.push([e.name, e.message]) }
out.push(structuredClone(5), structuredClone("s"), structuredClone(null), structuredClone(undefined))
const id = crypto.randomUUID()
out.push(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), crypto.getRandomValues(new Uint8Array(4)).length)
try { crypto.getRandomValues([1]) } catch (e) { out.push([e.name, e.message]) }
return out
