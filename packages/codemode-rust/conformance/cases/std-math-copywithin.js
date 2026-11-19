const out = []
out.push(Math.sumPrecise([1e20, 0.1, -1e20]), Math.sumPrecise([0.1, 0.2, 0.3]), Math.sumPrecise([]), Object.is(Math.sumPrecise([-0, -0]), -0), Math.sumPrecise([1e308, 1e308, -1e308]), Math.sumPrecise([Infinity, 1]), Math.sumPrecise([Infinity, -Infinity]), Math.sumPrecise([NaN]), Math.sumPrecise(new Set([5e-324, 5e-324])), Math.sumPrecise([1, 2 ** 53, 1]), Math.sumPrecise([1.7976931348623157e308, 1e292]))
try { Math.sumPrecise([1, "2"]) } catch (e) { out.push(e.name, e.message) }
try { Math.sumPrecise(5) } catch (e) { out.push(e.name) }
out.push([1.337, 65504, 65520, 65519.99, 5.960464477539063e-8, 2.9802322387695312e-8, 2.98023223876953126e-8, -0, 0.1, 1e-10, -1.5, 1.0009765625, 1.00048828125, 1.00146484375].map(Math.f16round))
out.push([1, 2, 3, 4, 5].copyWithin(0, 3), [1, 2, 3, 4, 5].copyWithin(-2), [1, 2, 3, 4, 5].copyWithin(1, 0, 3), [1, 2, 3, 4, 5].copyWithin(0, -3, -1), [1, 2, 3].copyWithin(5, 0))
try { Object.freeze([1, 2]).copyWithin(0, 1) } catch (e) { out.push(e.name) }
let seed = 9; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
for (let i = 0; i < 50; i++) { const xs = []; for (let j = 0; j < 8; j++) xs.push((rnd() - 0.5) * 10 ** Math.floor(rnd() * 40 - 20)); out.push(Math.sumPrecise(xs)) }
return out.map(String)
