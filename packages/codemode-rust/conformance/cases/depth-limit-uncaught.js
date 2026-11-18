// The call depth limit's RangeError, uncaught: it ends the run at the call that went over.
const f = (n) => f(n + 1)
f(1)
