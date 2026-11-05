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
  for (const item of $Direct(iterator)) {
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
`
