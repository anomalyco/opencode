return await Promise.race(["winner", tools.host.pending({ id: 1 })])
