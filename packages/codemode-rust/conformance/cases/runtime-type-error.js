const out = []
try { null.x } catch (e) { out.push(e instanceof TypeError, e.name) }
try { const f = undefined; f() } catch (e) { out.push(e instanceof TypeError) }
try { const c = 1; c = 2 } catch (e) { out.push(e instanceof TypeError) }
return out
