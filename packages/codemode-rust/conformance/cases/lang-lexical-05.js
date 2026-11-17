const values = []
for (let item of [1, 2, 3]) values.push(() => item)

const keys = {}
for (let key in { first: 1, second: 2, third: 3 }) keys[key] = () => key
return [values.map((read) => read()), keys.first(), keys.second(), keys.third()]
