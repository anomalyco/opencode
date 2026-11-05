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
// new Map, Set, WeakMap, and WeakSet from an iterable.
function fillCollection(target, items, kind) {
  const pairs = kind === "Map" || kind === "WeakMap"
  for (const item of items) {
    if (!pairs) $Table("add", target, item)
    else if (!$IsObject(item)) $Throw("TypeError", "new " + kind + "(...) expects [key, value] pairs as entry objects.")
    else $Table("add", target, item[0], item[1])
  }
  return target
}

function Map$groupBy(items, callback) {
  return groupBy(items, callback, "Map")
}
function Object$groupBy(items, callback) {
  return groupBy(items, callback, "Object")
}
// Object.groupBy's groups have a null prototype, so group names never collide with inherited methods.
function groupBy(items, callback, kind) {
  if (items === null || items === undefined) $Throw("TypeError", kind + ".groupBy expects an iterable collection.")
  $Callback(callback, kind + ".groupBy")
  const groups = $Table("groups", kind)
  let index = 0
  let key
  for (const item of items) {
    key = callback(item, index++)
    if (kind === "Object") key = String($Table("groupKey", key))
    $Table("group", groups, key, item)
  }
  return groups
}

// getOrInsertComputed when the key is missing: the callback's result wins over anything it inserted itself.
function insertComputed(target, key, callback) {
  const value = callback(key)
  $Table("add", target, key, value)
  return value
}

function Map$prototype$forEach(callback, thisArg = undefined) {
  collectionForEach($Receiver(this, "Map", "Map.prototype.forEach"), callback, thisArg, "Map.forEach")
}
function Set$prototype$forEach(callback, thisArg = undefined) {
  collectionForEach($Receiver(this, "Set", "Set.prototype.forEach"), callback, thisArg, "Set.forEach")
}
// Visits entries live, as in JS.
function collectionForEach(target, callback, thisArg, label) {
  $Callback(callback, label)
  for (const entry of $Table("entries", target)) $Call(callback, thisArg, entry[1], entry[0], target)
}

function Set$prototype$union(other) {
  return setMethod($Receiver(this, "Set", "Set.prototype.union"), other, "union")
}
function Set$prototype$intersection(other) {
  return setMethod($Receiver(this, "Set", "Set.prototype.intersection"), other, "intersection")
}
function Set$prototype$difference(other) {
  return setMethod($Receiver(this, "Set", "Set.prototype.difference"), other, "difference")
}
function Set$prototype$symmetricDifference(other) {
  return setMethod($Receiver(this, "Set", "Set.prototype.symmetricDifference"), other, "symmetricDifference")
}
function Set$prototype$isSubsetOf(other) {
  return setMethod($Receiver(this, "Set", "Set.prototype.isSubsetOf"), other, "isSubsetOf")
}
function Set$prototype$isSupersetOf(other) {
  return setMethod($Receiver(this, "Set", "Set.prototype.isSupersetOf"), other, "isSupersetOf")
}
function Set$prototype$isDisjointFrom(other) {
  return setMethod($Receiver(this, "Set", "Set.prototype.isDisjointFrom"), other, "isDisjointFrom")
}
// A Set method over the other set's size, has, and keys (GetSetRecord): it either asks the other set whether it has
// each of this set's values, or takes all of the other set's values, whichever is smaller.
function setMethod(target, other, name) {
  if (!$IsObject(other)) $Throw("TypeError", "Set." + name + " expects a Set-like object.")
  const size = +other.size
  if (size !== size) $Throw("TypeError", "Set." + name + " received a Set-like object with an invalid size.")
  if (size < 0) $Throw("RangeError", "Set." + name + " received a Set-like object with a negative size.")
  const has = other.has
  const keys = other.keys
  if (!$IsCallable(has) || !$IsCallable(keys)) $Throw("TypeError", "Set." + name + " expects callable 'has' and 'keys' methods.")
  const own = $Table("size", target)
  if (name === "isSubsetOf" && own > size) return false
  if (name === "isSupersetOf" && own < size) return false
  const result = name === "intersection" ? new Set() : name === "union" || name === "difference" || name === "symmetricDifference" ? $Table("copy", target) : undefined
  const asks = name === "isSubsetOf" || ((name === "intersection" || name === "difference" || name === "isDisjointFrom") && own <= size)
  let found
  if (asks) {
    for (const item of $Table("values", name === "difference" ? result : target)) {
      found = !!$Call(has, other, item)
      if (name === "intersection") {
        if (found) $Table("add", result, item)
      } else if (name === "difference") {
        if (found) $Table("delete", result, item)
      } else if (found === (name === "isDisjointFrom")) return false
    }
    return result === undefined ? true : result
  }
  const iterator = $Call(keys, other)
  if (!$IsObject(iterator)) $Throw("TypeError", "Set." + name + " expects 'keys' to return an iterator object.")
  for (const item of $Direct(iterator, true)) {
    found = $Table("has", target, item)
    if (name === "union") $Table("add", result, item)
    else if (name === "intersection") {
      if (found) $Table("add", result, item)
    } else if (name === "difference") $Table("delete", result, item)
    else if (name === "symmetricDifference") $Table(found ? "delete" : "add", result, item)
    else if (found === (name === "isDisjointFrom")) return false
  }
  return result === undefined ? true : result
}
function Object$fromEntries(entries) {
  const result = {}
  for (const entry of entries) {
    if (!$IsObject(entry, true)) $Throw("TypeError", "Object.fromEntries expects [key, value] entry objects.")
    $Define(result, String(entry[0]), entry[1], true)
  }
  return result
}

function Math$sumPrecise(items) {
  const numbers = []
  for (const item of items) {
    if (typeof item !== "number") $Throw("TypeError", "Math.sumPrecise expects an iterable of numbers.")
    numbers[numbers.length] = item
  }
  return $SumPrecise(numbers)
}

// new AggregateError: the error is made (message and cause) before its errors are read.
function aggregateError(error, errors) {
  const list = []
  for (const item of errors) list[list.length] = item
  return $Define(error, "errors", list, false)
}

// A Uint8Array's bytes from an iterable: a new one with prototype into, or set into the Uint8Array into at
// offset. As in TypedArray.from, a mapper sees the original values, after the source is consumed in full.
function collectBytes(source, name, mapper, thisArg, into, offset) {
  if (!$IsIterable(source)) $Throw("TypeError", name + " expects a Uint8Array, an array, or an iterable of numbers, received " + $Describe(source) + ".")
  const values = []
  for (const item of source) values[values.length] = item
  let index = 0
  if (mapper !== undefined) {
    while (index < values.length) {
      values[index] = $Call(mapper, thisArg, values[index], index)
      index++
    }
  }
  return $Bytes(values, into, offset)
}

// Headers and URLSearchParams from iterable [name, value] pairs, read in full as strings before any is checked; from a
// record of names to values when init is not iterable.
function readPairs(init, label, kind, proto) {
  if (!$IsIterable(init)) return $Pairs(kind, proto, init, label)
  const pairs = []
  let strings
  for (const pair of init) {
    if (!$IsIterable(pair)) $Throw("TypeError", label + " expects iterable [name, value] pairs.")
    strings = []
    for (const item of pair) strings[strings.length] = String(item)
    pairs[pairs.length] = strings
  }
  return $Pairs(kind, proto, pairs, label)
}

// Headers and URLSearchParams forEach: the callback sees each pair as listed when it started.
function pairsForEach(target, pairs, callback, thisArg) {
  let index = 0
  while (index < pairs.length) {
    $Call(callback, thisArg, pairs[index][1], pairs[index][0], target)
    index++
  }
}
function Iterator$from(value) {
  if ($IsObject(value) && $Inherits(value, Iterator.prototype)) return value
  if (typeof value !== "string" && !$IsObject(value)) $Throw("TypeError", "Iterator.from expects an iterable or iterator, received " + $Describe(value) + ".")
  const method = value[Symbol.iterator]
  return $Wrap(method === undefined || method === null ? value : $Call(method, value))
}

function Iterator$prototype$toArray() {
  const result = []
  for (const item of $Direct(this, false)) result[result.length] = item
  return result
}

function Iterator$prototype$reduce(callback, ...initial) {
  const iterator = $Direct(this, false)
  $Callback(callback, "Iterator.prototype.reduce")
  let accumulator = initial[0]
  let started = initial.length > 0
  let index = 0
  for (const item of iterator) {
    if (started) accumulator = callback(accumulator, item, index)
    else accumulator = item
    started = true
    index++
  }
  if (!started) $Throw("TypeError", "Iterator.prototype.reduce of an empty iterator with no initial value.")
  return accumulator
}

function Iterator$prototype$forEach(callback) {
  iteratorTest(this, callback, "forEach")
}
function Iterator$prototype$some(callback) {
  return iteratorTest(this, callback, "some")
}
function Iterator$prototype$every(callback) {
  return iteratorTest(this, callback, "every")
}
function Iterator$prototype$find(callback) {
  return iteratorTest(this, callback, "find")
}
// Calls the callback with each value and its index until its result decides; leaving early closes the iterator.
function iteratorTest(self, callback, name) {
  const iterator = $Direct(self, false)
  $Callback(callback, "Iterator.prototype." + name)
  let index = 0
  let result
  for (const item of iterator) {
    result = callback(item, index++)
    if (name === "some" && result) return true
    if (name === "every" && !result) return false
    if (name === "find" && result) return item
  }
  return name === "every" ? true : name === "some" ? false : undefined
}

// JSON.parse's reviver: children are revived first, each replacing (or, when the reviver gives undefined, removing)
// its property; then the reviver sees the value itself.
function revive(holder, key, reviver) {
  const value = holder[key]
  if ($IsObject(value)) {
    const names = $Keys(value)
    let index = 0
    let revived
    while (index < names.length) {
      revived = revive(value, names[index], reviver)
      if (revived === undefined) delete value[names[index]]
      else value[names[index]] = revived
      index++
    }
  }
  return $Call(reviver, holder, key, value)
}

// String replace with a callback, once the matches are found: each is the text before it and the callback's
// arguments; the text after the last one follows.
function replaceWith(matches, rest, callback) {
  let result = ""
  let index = 0
  while (index < matches.length) {
    result += matches[index][0] + String(callback(...matches[index][1]))
    index++
  }
  return result + rest
}
`
