function prior(first, second = first, third = second) { return [first, second, third] }
function later(first = second, second) { return first }
function self(item = item) { return item }
function failure(run) {
  try { return run() } catch (error) { return error.name }
}
return [prior(3), failure(later), failure(self)]
