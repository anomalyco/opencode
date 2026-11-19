let count = 0
label: for (let index = 0; index < 10; index++) {
  count++
  continue label
}
return count
