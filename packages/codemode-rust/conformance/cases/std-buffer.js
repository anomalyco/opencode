const out = []
const b = Buffer.from("héllo")
out.push([b.length, b.toString(), String(b), `${b}`, b.toString("hex"), b.toString("base64"), Buffer.from("aGk=", "base64").toString(), Buffer.from("6869", "hex").toString(), Buffer.byteLength("é")])
const c = Buffer.from([1, 2, 3])
out.push([c instanceof Uint8Array, Buffer.isBuffer(c), Buffer.isBuffer(new Uint8Array(1)), [...c], c[1], Object.prototype.toString.call(c)])
const d = Buffer.concat([Buffer.from("ab"), Buffer.from("cd")])
const view = d.subarray(1, 3)
view[0] = 120
out.push([d.toString(), view.toString(), d.equals(Buffer.from("axcd")), Buffer.compare(Buffer.from("a"), Buffer.from("b")), d.includes("cd"), d.indexOf("c"), Buffer.alloc(3, 1).toString("hex"), Buffer.alloc(4, "ab").toString()])
const e = Buffer.alloc(4)
e.writeUInt16BE(0x1234, 0)
e.writeInt8(-1, 2)
out.push([e.readUInt16BE(0), e.readUInt16LE(0), e.readInt8(2), e.toString("hex")])
let code
try { Buffer.from("x", "nope") } catch (err) { code = [err.name, err.code, err.message] }
out.push([JSON.stringify(Buffer.from("hi")), code])
const f = Buffer.alloc(16)
out.push(f.writeUInt32LE(0xdeadbeef, 0), f.writeInt32BE(-2, 4), f.writeDoubleLE(1.5, 8), f.readUInt32LE(0), f.readInt32BE(4), f.readDoubleLE(8), f.readUIntBE(0, 3), f.readIntLE(4, 2), f.writeUIntBE(0x123456, 0, 3), f.readUIntBE(0, 3), f.writeFloatBE(2.5, 0), f.readFloatBE(0))
for (const run of [() => f.readUInt8(16), () => f.readUInt8(-1), () => f.readUInt8(1.5), () => f.readUInt8("1"), () => f.writeUInt8(256, 0), () => f.writeInt16LE(40000), () => f.readUIntLE(0, 7), () => Buffer.alloc(-1), () => Buffer.from({}), () => d.equals("x")]) {
  try { out.push(run()) } catch (err) { out.push([err.name, err.code, err.message]) }
}
const g = Buffer.from("hello world")
out.push(g.toString("utf8", 6), g.toString("ascii", 0, 5), g.slice(-5).toString(), g.lastIndexOf("o"), g.indexOf("o", 5), g.indexOf(Buffer.from("wor")), g.indexOf(111), g.includes("xyz"), g.indexOf("o", -3), g.lastIndexOf("o", 5))
const h = Buffer.alloc(8)
out.push(h.write("abc"), h.write("zz", 5), h.write("é", 7), h.toString("hex"), h.write("xy", 1, 1), h.toString())
out.push(Buffer.from("€", "latin1").toString("hex"), Buffer.from("hi", "utf16le").toString("hex"), Buffer.from("6869", "hex").toString("utf16le"), Buffer.from([0xff, 0x80]).toString("latin1"), Buffer.from([0xc3, 0xa9, 0x80]).toString("ascii"), Buffer.from("_-8", "base64url").toString("hex"), Buffer.from([255, 254]).toString("base64url"), Buffer.from("zz12", "hex").length)
const t = Buffer.alloc(5)
out.push(Buffer.from("abc").copy(t, 1), t.toString("hex"), Buffer.from("abcd").fill("x", 1, 3).toString(), Buffer.from("abcd").fill(0).toString("hex"), Buffer.from([1,2,3,4]).swap16().toString("hex"), Buffer.from("b").compare(Buffer.from("a")), Buffer.from("abc").compare(Buffer.from("xbcx"), 1, 3, 1, 3))
out.push(Buffer.isEncoding("UTF-8"), Buffer.isEncoding("nope"), Buffer.poolSize, Buffer.byteLength("aGk=", "base64"), Buffer.byteLength(new Uint8Array(3)), Buffer.from(Buffer.from("xyz"), 1, 1).toString(), Buffer.from({ type: "Buffer", data: [65, 66] }).toString(), Buffer.from({ length: 2, 0: 67, 1: 68 }).toString(), Buffer("hey").toString(), new Buffer("hey").toString(), Buffer.allocUnsafe(2).length)
console.log(Buffer.from("hi"), Buffer.alloc(0), Buffer.alloc(52))
out.push(Buffer.from("ab").slice(0, 1) instanceof Buffer, Buffer.isBuffer(Buffer.from("ab").subarray(1)), Buffer.from("a").toJSON())
return out
