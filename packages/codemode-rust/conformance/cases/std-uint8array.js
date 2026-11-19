const out = []
const b = new Uint8Array([1, 2, 300, -1, 1.7])
out.push([...b], b.length, b[2], b[9], Object.keys(b), JSON.stringify(b), String(b), Array.isArray(b), b instanceof Uint8Array, typeof b)
b[0] = 257; b[10] = 5; out.push([...b], b.length, 0 in b, 9 in b, b.hasOwnProperty("1"), b.hasOwnProperty("length"))
try { delete b[0] } catch (e) { out.push(e.name) }
out.push(new Uint8Array(3).join("-"), new Uint8Array().length, new Uint8Array("2").length, new Uint8Array(null).length, Uint8Array.of(1, 256, "3").join(), Uint8Array.from([1, 2], (x, i) => x * 10 + i).join(), Uint8Array.from("12").join(), Uint8Array.from(new Set([5, 6])).join())
for (const f of [() => new Uint8Array(-1), () => new Uint8Array(1.5), () => Uint8Array(2), () => new Uint8Array({ length: 2 }), () => Uint8Array.fromHex("abc"), () => Uint8Array.fromBase64("@@"), () => Uint8Array.fromBase64(1), () => new Uint8Array(2).set([1, 2, 3]), () => new Uint8Array(2).reduce((a, b) => a), () => new Uint8Array().reduce((a, b) => a), () => new Uint8Array(1).map(5)]) {
  try { out.push(f()) } catch (e) { out.push([e.name, e.message]) }
}
const s = new Uint8Array([10, 9, 1, 2, 3])
out.push(s.at(-1), s.slice(1, 3).join(), s.subarray(-2).join(), s.indexOf(9), s.indexOf("9"), s.lastIndexOf(1), s.lastIndexOf(1, undefined), s.includes(3), s.includes(3, -1), [...s.keys()], [...s.entries()].join("|"), s.toHex(), s.toBase64())
const v = s.subarray(1, 3); v[0] = 99; out.push(s.join(), v.length)
s.set([7, 8], 3); out.push(s.join()); s.set(new Uint8Array([4]), 0); out.push(s.join())
out.push(s.fill(1, 1, 2).join(), s.reverse().join(), new Uint8Array([10, 9, 1]).sort().join(), new Uint8Array([1, 2, 3]).sort((a, b) => b - a).join())
out.push(s.map((x) => x * 100).join(), s.filter((x) => x > 4).join(), s.find((x) => x > 4), s.findIndex((x) => x > 100), s.findLast((x) => x > 4), s.findLastIndex((x) => x > 4), s.some((x) => x > 4), s.every((x) => x > 0), s.reduce((a, b) => a + b), s.reduceRight((a, b) => a + "," + b, ""))
const seen = []; s.forEach((x, i, arr) => seen.push([x, i, arr === s])); out.push(seen)
out.push(Uint8Array.fromHex("ff00A1").join(), Uint8Array.fromBase64("aGVsbG8=").join(), Uint8Array.fromBase64(" aGVs bG8 ").join(), new TextDecoder().decode(Uint8Array.fromBase64("aGVsbG8")))
out.push(atob("aGk="), btoa("hi"), atob(" aG k "), btoa("\u00ff"))
for (const f of [() => atob("a"), () => btoa("€"), () => atob()]) { try { f() } catch (e) { out.push([e.name, e.message]) } }
const enc = new TextEncoder()
out.push(enc.encoding, [...enc.encode("hé€😀")], enc.encode().length, [...enc.encode(12)])
const dec = new TextDecoder()
out.push(dec.encoding, dec.fatal, dec.ignoreBOM, dec.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0xff, 0x69])), new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])).length, dec.decode())
const st = new TextDecoder()
out.push(st.decode(new Uint8Array([0xe2, 0x82]), { stream: true }), st.decode(new Uint8Array([0xac]), { stream: true }), st.decode())
for (const f of [() => new TextDecoder("latin1"), () => new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff])), () => dec.decode([1]), () => TextDecoder()]) { try { f() } catch (e) { out.push([e.name, e.message]) } }
out.push(new TextDecoder(" UTF8 ").encoding, Object.prototype.toString.call(new Uint8Array(1)), new Uint8Array([1, 2]).toLocaleString())
console.log(new Uint8Array([1, 2]), [new Uint8Array(0)])
return out
