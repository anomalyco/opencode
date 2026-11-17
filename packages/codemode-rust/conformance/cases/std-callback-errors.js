const out = []; for (const f of [(a) => a.map(5), (a) => a.forEach(), (a) => a.find(null), (a) => a.reduce(1), (a) => a.sort(3), (a) => a.flatMap({}), (a) => a.filter("x"), (a) => a.every(), (a) => a.findLastIndex(1), (a) => new Map().forEach(2), (a) => new Set().forEach(), (a) => a.some(Math.max), (a) => a.map(console.log)]) { try { f([1]); out.push("ok") } catch (e) { out.push(e.message) } } 

for (const f of [() => [1].toSorted(3), () => new Uint8Array(2).sort(3), () => new Uint8Array(2).map(3), () => [1].sort(null), () => new URLSearchParams().forEach(1)]) { try { f(); out.push("ok") } catch (e) { out.push(e.message) } } 

const s1 = [5, 3, 4, 1, 2]; try { s1.sort(5) } catch (e) { out.push(e.message) } out.push(JSON.stringify(s1)); let n2 = 0; try { s1.sort((x, y) => { if (++n2 === 3) throw new Error("cmp"); return x - y }) } catch (e) { out.push(e.message) } out.push(JSON.stringify(s1)); const s2 = Array.from({ length: 20 }, (_, i) => 20 - i); n2 = 0; try { s2.sort((x, y) => { if (++n2 === 30) throw new Error("cmp"); return x - y }) } catch (e) { out.push(e.message) } out.push(JSON.stringify(s2)); return out

