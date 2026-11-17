// @limits {"max_tool_calls": 2}
search({})
await tools.echo({ id: 1 })
return search("echo")
