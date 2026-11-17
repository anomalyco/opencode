let first
let rest
for await ([first, ...rest] of [Promise.resolve([1, 2, 3])]) {}
return [first, rest]
