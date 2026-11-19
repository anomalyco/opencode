const results = await Promise.all(Array.from({ length: 1000 }, (_, i) => tools.echo({ id: i })))
return results.length
