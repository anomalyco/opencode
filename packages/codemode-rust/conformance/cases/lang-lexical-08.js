let item = "outside"
let firstRead
let secondRead
switch (null) {
  case null:
    let item = "inside"
    firstRead = () => item
  case null:
    secondRead = () => item
}
return [firstRead(), secondRead(), item]
