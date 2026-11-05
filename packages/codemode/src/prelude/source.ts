// The prelude's source (see prelude.ts): Code Mode JavaScript, parsed once per process. Only top-level function
// declarations; `$` names are the privileged helpers (helpers.ts). Keep `${` and backticks out of it.
export const code = String.raw`
function arrayFromIterable(items, mapper, thisArg) {
  const result = []
  let index = 0
  for (const item of items) {
    result[index] = mapper === undefined ? item : $Call(mapper, thisArg, item, index)
    index++
  }
  return result
}

function Array$prototype$toLocaleString() {
  const array = $Receiver(this, "Array", "Array.prototype.toLocaleString")
  let result = ""
  let index = 0
  let item
  while (index < array.length) {
    if (index > 0) result += ","
    item = array[index]
    if (item !== null && item !== undefined) result += String(item.toLocaleString())
    index++
  }
  return result
}
`
