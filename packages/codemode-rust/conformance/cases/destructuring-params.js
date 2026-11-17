const f = ({ name, tags: [first] = [] }, [n = 1] = []) => name + ":" + first + ":" + n
return [f({ name: "a", tags: ["t"] }, [5]), f({ name: "b" })]
