const outer = async () => {
  Promise.reject(new Error("inner"))
  throw new Error("outer")
}
outer()
return "done"
