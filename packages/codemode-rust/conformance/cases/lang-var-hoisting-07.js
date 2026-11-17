function fn() {
  { var x = 1; var y }
  return [x, typeof y]
}
return fn()
