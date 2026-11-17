const all = search({})
const page = search({ limit: 1, offset: 1 })
const done = search({ limit: 1, offset: 3 })
return [all, page, done, search("status"), search({ query: "", namespace: "git" }), search("tools.git.status").items.length]
