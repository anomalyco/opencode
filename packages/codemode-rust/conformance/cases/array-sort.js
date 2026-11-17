const nums = [10, 1, 5, 100, 25]
const words = ["pear", "Apple", "fig", "banana"]
const people = [{ n: "a", age: 30 }, { n: "b", age: 20 }, { n: "c", age: 30 }, { n: "d", age: 20 }]
return [[...nums].sort(), [...nums].sort((a, b) => a - b), [...nums].sort((a, b) => b - a), [...words].sort(), people.sort((x, y) => x.age - y.age).map((p) => p.n)]
