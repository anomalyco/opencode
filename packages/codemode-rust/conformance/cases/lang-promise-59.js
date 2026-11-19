try {
  await Promise.reject("nope")
  return "no"
} catch (e) {
  return e
}
