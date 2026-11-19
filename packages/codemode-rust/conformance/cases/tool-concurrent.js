const results = await Promise.all([3, 1, 2].map((id) => tools.echo({ id })))
return results
