const out = []
function f(a) {}
Object.freeze(f)
try { out.push(delete f.length) } catch (e) { out.push(e.message) }
const s = function named(b) {}
Object.seal(s)
try { out.push(delete s.name) } catch (e) { out.push(e.message) }
function g() {}
delete g.name
console.log(g, [g], { g })
const b = g.bind(null)
try { out.push(delete b.name, b.name, b.hasOwnProperty("name")) } catch (e) { out.push(e.message) }
out.push("length" in g, delete g.length, "length" in g, Object.isFrozen(f))
const o2 = Object.freeze({ a: 1 }); try { delete o2.a } catch (e) { out.push(e.message) }; const a2 = Object.seal([1]); try { delete a2[0] } catch (e) { out.push(e.message) }; try { delete [].length } catch (e) { out.push(e.message) }; 
const u = new Uint8Array(2); try { delete u[0] } catch (e) { out.push(e.message) }; try { out.push(delete u[5]) } catch (e) { out.push(e.message) }; try { out.push(delete u.length) } catch (e) { out.push(e.message) }
return out
