// @limits {"max_tool_calls": 2}
for (let i = 0; i < 3; i++) await tools.echo({ id: i })
return "unreachable"
