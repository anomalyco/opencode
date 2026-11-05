// The prelude's source (see prelude.ts): Code Mode JavaScript, parsed once per process. Only top-level function
// declarations; `$` names are the privileged helpers (helpers.ts). Keep `${` and backticks out of it.
export const code = String.raw`
function Array$from(items, mapper = undefined, thisArg = undefined) {
  if (mapper !== undefined) $Callback(mapper, "Array.from")
  const result = []
  let index = 0
  if ($IsIterable(items)) {
    for (const item of items) {
      result[index] = mapper === undefined ? item : $Call(mapper, thisArg, item, index)
      index++
    }
    return result
  }
  const length = $ArrayLikeLength(items)
  while (index < length) {
    result[index] = mapper === undefined ? items[index] : $Call(mapper, thisArg, items[index], index)
    index++
  }
  return result
}

function Array$prototype$map(callback, thisArg = undefined) {
  return map($Receiver(this, "Array", "Array.prototype.map"), callback, thisArg, "Array.map")
}
function Uint8Array$prototype$map(callback, thisArg = undefined) {
  return $Bytes(map($Receiver(this, "Uint8Array", "Uint8Array.prototype.map"), callback, thisArg, "Uint8Array.map"))
}
function map(array, callback, thisArg, label) {
  $Callback(callback, label)
  const length = array.length
  const result = new Array(length)
  let index = 0
  while (index < length) {
    if (index in array) result[index] = $Call(callback, thisArg, array[index], index, array)
    index++
  }
  return result
}

function Array$prototype$filter(callback, thisArg = undefined) {
  return filter($Receiver(this, "Array", "Array.prototype.filter"), callback, thisArg, "Array.filter")
}
function Uint8Array$prototype$filter(callback, thisArg = undefined) {
  return $Bytes(filter($Receiver(this, "Uint8Array", "Uint8Array.prototype.filter"), callback, thisArg, "Uint8Array.filter"))
}
function filter(array, callback, thisArg, label) {
  $Callback(callback, label)
  const length = array.length
  const result = []
  let index = 0
  let kept = 0
  while (index < length) {
    if (index in array) {
      const item = array[index]
      if ($Call(callback, thisArg, item, index, array)) result[kept++] = item
    }
    index++
  }
  return result
}

function Array$prototype$flatMap(callback, thisArg = undefined) {
  const array = $Receiver(this, "Array", "Array.prototype.flatMap")
  $Callback(callback, "Array.flatMap")
  const length = array.length
  const result = []
  let index = 0
  while (index < length) {
    if (index in array) $Append(result, $Call(callback, thisArg, array[index], index, array))
    index++
  }
  return result
}

function Array$prototype$find(callback, thisArg = undefined) {
  return find($Receiver(this, "Array", "Array.prototype.find"), callback, thisArg, "Array.find", false, false)
}
function Array$prototype$findIndex(callback, thisArg = undefined) {
  return find($Receiver(this, "Array", "Array.prototype.findIndex"), callback, thisArg, "Array.findIndex", false, true)
}
function Array$prototype$findLast(callback, thisArg = undefined) {
  return find($Receiver(this, "Array", "Array.prototype.findLast"), callback, thisArg, "Array.findLast", true, false)
}
function Array$prototype$findLastIndex(callback, thisArg = undefined) {
  return find($Receiver(this, "Array", "Array.prototype.findLastIndex"), callback, thisArg, "Array.findLastIndex", true, true)
}
function Uint8Array$prototype$find(callback, thisArg = undefined) {
  return find($Receiver(this, "Uint8Array", "Uint8Array.prototype.find"), callback, thisArg, "Uint8Array.find", false, false)
}
function Uint8Array$prototype$findIndex(callback, thisArg = undefined) {
  return find($Receiver(this, "Uint8Array", "Uint8Array.prototype.findIndex"), callback, thisArg, "Uint8Array.findIndex", false, true)
}
function Uint8Array$prototype$findLast(callback, thisArg = undefined) {
  return find($Receiver(this, "Uint8Array", "Uint8Array.prototype.findLast"), callback, thisArg, "Uint8Array.findLast", true, false)
}
function Uint8Array$prototype$findLastIndex(callback, thisArg = undefined) {
  return find($Receiver(this, "Uint8Array", "Uint8Array.prototype.findLastIndex"), callback, thisArg, "Uint8Array.findLastIndex", true, true)
}
// The find methods visit holes, as undefined.
function find(array, callback, thisArg, label, last, wantIndex) {
  $Callback(callback, label)
  const length = array.length
  const step = last ? -1 : 1
  let index = last ? length - 1 : 0
  while (index >= 0 && index < length) {
    const item = array[index]
    if ($Call(callback, thisArg, item, index, array)) return wantIndex ? index : item
    index += step
  }
  return wantIndex ? -1 : undefined
}

function Array$prototype$some(callback, thisArg = undefined) {
  return test($Receiver(this, "Array", "Array.prototype.some"), callback, thisArg, "Array.some", true)
}
function Array$prototype$every(callback, thisArg = undefined) {
  return test($Receiver(this, "Array", "Array.prototype.every"), callback, thisArg, "Array.every", false)
}
function Array$prototype$forEach(callback, thisArg = undefined) {
  test($Receiver(this, "Array", "Array.prototype.forEach"), callback, thisArg, "Array.forEach", undefined)
}
function Uint8Array$prototype$some(callback, thisArg = undefined) {
  return test($Receiver(this, "Uint8Array", "Uint8Array.prototype.some"), callback, thisArg, "Uint8Array.some", true)
}
function Uint8Array$prototype$every(callback, thisArg = undefined) {
  return test($Receiver(this, "Uint8Array", "Uint8Array.prototype.every"), callback, thisArg, "Uint8Array.every", false)
}
function Uint8Array$prototype$forEach(callback, thisArg = undefined) {
  test($Receiver(this, "Uint8Array", "Uint8Array.prototype.forEach"), callback, thisArg, "Uint8Array.forEach", undefined)
}
// some (stop on true), every (stop on false), and forEach (never stop).
function test(array, callback, thisArg, label, stopOn) {
  $Callback(callback, label)
  const length = array.length
  let index = 0
  while (index < length) {
    if (index in array && !!$Call(callback, thisArg, array[index], index, array) === stopOn) return stopOn
    index++
  }
  return !stopOn
}

function Array$prototype$reduce(callback, ...initial) {
  return reduce($Receiver(this, "Array", "Array.prototype.reduce"), callback, initial, "Array.reduce", 1)
}
function Array$prototype$reduceRight(callback, ...initial) {
  return reduce($Receiver(this, "Array", "Array.prototype.reduceRight"), callback, initial, "Array.reduceRight", -1)
}
function Uint8Array$prototype$reduce(callback, ...initial) {
  return reduce($Receiver(this, "Uint8Array", "Uint8Array.prototype.reduce"), callback, initial, "Uint8Array.reduce", 1)
}
function Uint8Array$prototype$reduceRight(callback, ...initial) {
  return reduce($Receiver(this, "Uint8Array", "Uint8Array.prototype.reduceRight"), callback, initial, "Uint8Array.reduceRight", -1)
}
function reduce(array, callback, initial, label, step) {
  $Callback(callback, label)
  const length = array.length
  let index = step > 0 ? 0 : length - 1
  let accumulator = initial[0]
  if (initial.length === 0) {
    while (index >= 0 && index < length && !(index in array)) index += step
    if (index < 0 || index >= length) $Throw("TypeError", label + " of an empty array with no initial value.")
    accumulator = array[index]
    index += step
  }
  while (index >= 0 && index < length) {
    if (index in array) accumulator = $Call(callback, undefined, accumulator, array[index], index, array)
    index += step
  }
  return accumulator
}

function Array$prototype$toLocaleString() {
  const array = $Receiver(this, "Array", "Array.prototype.toLocaleString")
  let result = ""
  let index = 0
  while (index < array.length) {
    if (index > 0) result += ","
    const item = array[index]
    if (item !== null && item !== undefined) result += String(item.toLocaleString())
    index++
  }
  return result
}

// A sort with a comparator (sort, toSorted, Uint8Array sort): a stable bottom-up merge sort. Holes and undefined
// values sort last without being compared.
function sortWith(target, compare, into) {
  $Callback(compare, into)
  const taken = $SortItems(target)
  const values = taken[0]
  const length = values.length
  let from = values
  let to = new Array(length)
  let width = 1
  while (width < length) {
    let low = 0
    while (low < length) {
      const middle = low + width < length ? low + width : length
      const high = middle + width < length ? middle + width : length
      let left = low
      let right = middle
      let next = low
      while (left < middle && right < high) {
        if (compare(from[left], from[right]) > 0) to[next++] = from[right++]
        else to[next++] = from[left++]
      }
      while (left < middle) to[next++] = from[left++]
      while (right < high) to[next++] = from[right++]
      low = high
    }
    const swap = from
    from = to
    to = swap
    width *= 2
  }
  return $Sorted(target, into, from, taken[2], taken[1])
}
`
