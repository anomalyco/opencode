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

// Array.from over an array-like with a mapper: every index is read, holes included.
function arrayFromLike(source, length, mapper, thisArg) {
  const result = new Array(length)
  let index = 0
  while (index < length) {
    result[index] = $Call(mapper, thisArg, source[index], index)
    index++
  }
  return result
}

// The callback methods Array and Uint8Array share. They fix the iteration length when they start and read elements
// live; they skip holes, but the find methods visit them as undefined. map and filter return the receiver's kind of
// collection.
function Array$prototype$map(callback, thisArg = undefined) {
  return mapItems($Receiver(this, "Array", "Array.prototype.map"), callback, thisArg, "Array.map")
}
function Uint8Array$prototype$map(callback, thisArg = undefined) {
  const bytes = $Receiver(this, "Uint8Array", "Uint8Array.prototype.map")
  return $Bytes(mapItems(bytes, callback, thisArg, "Uint8Array.map"), Uint8Array.prototype, 0)
}
function mapItems(array, callback, thisArg, label) {
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
  return filterItems($Receiver(this, "Array", "Array.prototype.filter"), callback, thisArg, "Array.filter")
}
function Uint8Array$prototype$filter(callback, thisArg = undefined) {
  const bytes = $Receiver(this, "Uint8Array", "Uint8Array.prototype.filter")
  return $Bytes(filterItems(bytes, callback, thisArg, "Uint8Array.filter"), Uint8Array.prototype, 0)
}
function filterItems(array, callback, thisArg, label) {
  $Callback(callback, label)
  const length = array.length
  const result = []
  let count = 0
  let index = 0
  let item
  while (index < length) {
    if (index in array) {
      item = array[index]
      if ($Call(callback, thisArg, item, index, array)) result[count++] = item
    }
    index++
  }
  return result
}

function Array$prototype$forEach(callback, thisArg = undefined) {
  forEachItem($Receiver(this, "Array", "Array.prototype.forEach"), callback, thisArg, "Array.forEach")
}
function Uint8Array$prototype$forEach(callback, thisArg = undefined) {
  forEachItem($Receiver(this, "Uint8Array", "Uint8Array.prototype.forEach"), callback, thisArg, "Uint8Array.forEach")
}
function forEachItem(array, callback, thisArg, label) {
  $Callback(callback, label)
  const length = array.length
  let index = 0
  while (index < length) {
    if (index in array) $Call(callback, thisArg, array[index], index, array)
    index++
  }
}

function Array$prototype$some(callback, thisArg = undefined) {
  return testItems($Receiver(this, "Array", "Array.prototype.some"), callback, thisArg, "Array.some", false)
}
function Uint8Array$prototype$some(callback, thisArg = undefined) {
  return testItems($Receiver(this, "Uint8Array", "Uint8Array.prototype.some"), callback, thisArg, "Uint8Array.some", false)
}
function Array$prototype$every(callback, thisArg = undefined) {
  return testItems($Receiver(this, "Array", "Array.prototype.every"), callback, thisArg, "Array.every", true)
}
function Uint8Array$prototype$every(callback, thisArg = undefined) {
  return testItems($Receiver(this, "Uint8Array", "Uint8Array.prototype.every"), callback, thisArg, "Uint8Array.every", true)
}
// some stops at the first truthy result, every at the first falsy one.
function testItems(array, callback, thisArg, label, every) {
  $Callback(callback, label)
  const length = array.length
  let index = 0
  while (index < length) {
    if (index in array && !$Call(callback, thisArg, array[index], index, array) === every) return !every
    index++
  }
  return every
}

function Array$prototype$find(callback, thisArg = undefined) {
  return findItem($Receiver(this, "Array", "Array.prototype.find"), callback, thisArg, "Array.find", false, false)
}
function Uint8Array$prototype$find(callback, thisArg = undefined) {
  return findItem($Receiver(this, "Uint8Array", "Uint8Array.prototype.find"), callback, thisArg, "Uint8Array.find", false, false)
}
function Array$prototype$findIndex(callback, thisArg = undefined) {
  return findItem($Receiver(this, "Array", "Array.prototype.findIndex"), callback, thisArg, "Array.findIndex", false, true)
}
function Uint8Array$prototype$findIndex(callback, thisArg = undefined) {
  return findItem($Receiver(this, "Uint8Array", "Uint8Array.prototype.findIndex"), callback, thisArg, "Uint8Array.findIndex", false, true)
}
function Array$prototype$findLast(callback, thisArg = undefined) {
  return findItem($Receiver(this, "Array", "Array.prototype.findLast"), callback, thisArg, "Array.findLast", true, false)
}
function Uint8Array$prototype$findLast(callback, thisArg = undefined) {
  return findItem($Receiver(this, "Uint8Array", "Uint8Array.prototype.findLast"), callback, thisArg, "Uint8Array.findLast", true, false)
}
function Array$prototype$findLastIndex(callback, thisArg = undefined) {
  return findItem($Receiver(this, "Array", "Array.prototype.findLastIndex"), callback, thisArg, "Array.findLastIndex", true, true)
}
function Uint8Array$prototype$findLastIndex(callback, thisArg = undefined) {
  return findItem($Receiver(this, "Uint8Array", "Uint8Array.prototype.findLastIndex"), callback, thisArg, "Uint8Array.findLastIndex", true, true)
}
function findItem(array, callback, thisArg, label, last, wantIndex) {
  $Callback(callback, label)
  const length = array.length
  const step = last ? -1 : 1
  let index = last ? length - 1 : 0
  let item
  while (index >= 0 && index < length) {
    item = array[index]
    if ($Call(callback, thisArg, item, index, array)) return wantIndex ? index : item
    index += step
  }
  return wantIndex ? -1 : undefined
}

// reduce and reduceRight take an initial value where the others take a thisArg.
function Array$prototype$reduce(callback, ...initial) {
  return reduceItems($Receiver(this, "Array", "Array.prototype.reduce"), callback, initial, "Array.reduce", false)
}
function Uint8Array$prototype$reduce(callback, ...initial) {
  return reduceItems($Receiver(this, "Uint8Array", "Uint8Array.prototype.reduce"), callback, initial, "Uint8Array.reduce", false)
}
function Array$prototype$reduceRight(callback, ...initial) {
  return reduceItems($Receiver(this, "Array", "Array.prototype.reduceRight"), callback, initial, "Array.reduceRight", true)
}
function Uint8Array$prototype$reduceRight(callback, ...initial) {
  return reduceItems($Receiver(this, "Uint8Array", "Uint8Array.prototype.reduceRight"), callback, initial, "Uint8Array.reduceRight", true)
}
function reduceItems(array, callback, initial, label, right) {
  $Callback(callback, label)
  const length = array.length
  const step = right ? -1 : 1
  let index = right ? length - 1 : 0
  let accumulator
  if (initial.length > 0) accumulator = initial[0]
  else {
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

// forEach semantics: a returned array's holes are skipped, as flattening does.
function Array$prototype$flatMap(callback, thisArg = undefined) {
  const array = $Receiver(this, "Array", "Array.prototype.flatMap")
  $Callback(callback, "Array.flatMap")
  const length = array.length
  const result = []
  let count = 0
  let index = 0
  let inner
  let at
  while (index < length) {
    if (index in array) {
      inner = $Call(callback, thisArg, array[index], index, array)
      if ($IsArray(inner)) {
        at = 0
        while (at < inner.length) {
          if (at in inner) result[count++] = inner[at]
          at++
        }
      } else result[count++] = inner
    }
    index++
  }
  return result
}

// A sort with a comparator (see sortArray): a stable top-down merge sort that compares in the same order as the
// recursive one, running the merges (low, middle, high) the native planned in post-order over one working copy.
// Holes and undefined values sort last without being compared.
function sortWith(target, into, holes, comparator, work, undefs, merges) {
  const merged = []
  let merge = 0
  let middle
  let high
  let left
  let right
  let count
  let order
  while (merge < merges.length) {
    left = merges[merge]
    middle = merges[merge + 1]
    high = merges[merge + 2]
    right = middle
    count = 0
    while (left < middle && right < high) {
      order = +$Call(comparator, undefined, work[left], work[right])
      // A NaN result counts as equal, which keeps the order stable.
      if (order <= 0 || order !== order) {
        merged[count] = work[left]
        left++
      } else {
        merged[count] = work[right]
        right++
      }
      count++
    }
    $MergeRest(work, merged, count, left, middle, right, high, merges[merge])
    merge += 3
  }
  return $Sorted(target, into, holes, work, undefs)
}

// The default sort over more values than one native sort may take at once: native steps of bounded size (see
// $SortStep), so the run can pause between them like any loop.
function sortDefault(target, into, holes, values, undefs) {
  const state = $SortState(values)
  while ($SortStep(state)) {}
  return $Sorted(target, into, holes, $SortResult(state, values), undefs)
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
// Iterator helpers are prelude generators, made with %IteratorHelper% as their prototype. Each is primed to its first
// yield, so a return() before the first next() still closes the source, from its finally.
function Iterator$from(value) {
  if ($IsObject(value) && $Inherits(value, Iterator.prototype)) return value
  return prime(wrapHelper(value, flattenable(value, true, "Iterator.from")))
}
function* wrapHelper(source, iterator) {
  let started = false
  try {
    yield
    started = true
    for (const item of iterator) yield item
  } finally {
    if (!started) closeIterator(source)
  }
}

function Iterator$prototype$map(mapper) {
  const iterator = $Direct(this, false)
  $Callback(mapper, "Iterator.prototype.map")
  return prime(mapHelper(this, iterator, mapper))
}
function* mapHelper(source, iterator, mapper) {
  let started = false
  try {
    yield
    started = true
    let counter = 0
    for (const item of iterator) yield mapper(item, counter++)
  } finally {
    if (!started) closeIterator(source)
  }
}

function Iterator$prototype$filter(predicate) {
  const iterator = $Direct(this, false)
  $Callback(predicate, "Iterator.prototype.filter")
  return prime(filterHelper(this, iterator, predicate))
}
function* filterHelper(source, iterator, predicate) {
  let started = false
  try {
    yield
    started = true
    let counter = 0
    for (const item of iterator) if (predicate(item, counter++)) yield item
  } finally {
    if (!started) closeIterator(source)
  }
}

function Iterator$prototype$take(limit) {
  const iterator = $Direct(this, false)
  return prime(takeHelper(this, iterator, count(limit, "take")))
}
function* takeHelper(source, iterator, remaining) {
  let started = false
  try {
    yield
    started = true
    if (remaining === 0) return closeIterator(source)
    for (const item of iterator) {
      remaining--
      yield item
      if (remaining === 0) break
    }
  } finally {
    if (!started) closeIterator(source)
  }
}

function Iterator$prototype$drop(limit) {
  const iterator = $Direct(this, false)
  return prime(dropHelper(this, iterator, count(limit, "drop")))
}
function* dropHelper(source, iterator, remaining) {
  let started = false
  try {
    yield
    started = true
    for (const item of iterator) {
      if (remaining > 0) remaining--
      else yield item
    }
  } finally {
    if (!started) closeIterator(source)
  }
}

function Iterator$prototype$flatMap(mapper) {
  const iterator = $Direct(this, false)
  $Callback(mapper, "Iterator.prototype.flatMap")
  return prime(flatMapHelper(this, iterator, mapper))
}
function* flatMapHelper(source, iterator, mapper) {
  let started = false
  try {
    yield
    started = true
    let counter = 0
    for (const item of iterator) {
      for (const inner of flattenable(mapper(item, counter++), false, "Iterator.prototype.flatMap")) yield inner
    }
  } finally {
    if (!started) closeIterator(source)
  }
}

function prime(helper) {
  helper.next()
  return helper
}

// A take or drop count: a number that is not NaN or negative.
function count(limit, name) {
  const number = +limit
  const integer = number === Infinity || number === -Infinity ? number : number - (number % 1)
  if (number !== number || integer < 0) $Throw("RangeError", "Iterator.prototype." + name + " expects a non-negative count, received " + number + ".")
  return integer
}

// GetIteratorFlattenable: an iterable by its [Symbol.iterator], otherwise the object itself as an iterator.
function flattenable(value, strings, name) {
  if (typeof value === "string" ? !strings : !$IsObject(value)) $Throw("TypeError", name + " expects an iterable or iterator, received " + $Describe(value) + ".")
  const method = value[Symbol.iterator]
  return $Direct(method === undefined || method === null ? value : $Call(method, value), false)
}

function closeIterator(iterator) {
  const method = iterator.return
  if (method !== undefined && method !== null && !$IsObject($Call(method, iterator))) $Throw("TypeError", "Iterator return() must return an object.")
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
