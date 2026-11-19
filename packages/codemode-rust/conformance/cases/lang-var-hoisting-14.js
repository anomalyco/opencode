const byVar = []
for (var i = 0; i < 3; i++) byVar.push(() => i)
const byLet = []
for (let j = 0; j < 3; j++) byLet.push(() => j)
return [byVar.map((f) => f()), byLet.map((f) => f())]
