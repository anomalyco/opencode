const errors = []
for (const input of [{ limit: 0 }, { limit: 0.5 }, { offset: -1 }, { namespace: 7 }, 42, null]) {
  try { search(input) } catch (e) { errors.push(e.message) }
}
return errors
