const sites = []
const tag = function (s, ...v) { sites.push(s); return [s, v, this === undefined, Array.isArray(s), Object.keys(s), s.raw, Array.isArray(s.raw), s.length] }
const r1 = tag`a${1}b\n${2}\unicode`
const f = () => tag`x`
f(); f()
const o = { t(s) { return this === o } }
let w; try { sites[0].raw = 5; w = "ok" } catch (e) { w = e.message }
let w2; try { sites[0].raw[0] = "z"; w2 = sites[0].raw[0] } catch (e) { w2 = e.message }
sites[0][0] = "changed"
return [r1, sites[1] === sites[2], o.t`q`, w, w2, sites[0][0], JSON.stringify(sites[0])]
