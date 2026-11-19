const values = []
try {
  for await (const item of [Promise.resolve(1), Promise.reject("stop"), Promise.resolve(3)]) {
    values.push(item)
  }
} catch (error) {
  return [values, error]
}
return "missed"
