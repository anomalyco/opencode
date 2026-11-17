const viaThen = await search("echo").then((r) => r.items[0].path)
const viaAwait = (await search("echo")).items[0].path
const alias = (await tools.search({ query: "echo" })).items[0].path
return [viaThen, viaAwait, alias, Object.keys(search("echo")), JSON.stringify(search({ limit: 1 })).length > 10]
