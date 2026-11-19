const slow = async (x) => { await null; await null; return x }
return await Promise.all([slow(1), 2, Promise.resolve(3), slow(4)])
