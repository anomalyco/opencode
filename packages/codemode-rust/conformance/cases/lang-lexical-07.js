let item = "outside"
let discriminantRead
let selectorRead
let statementRead
switch ((discriminantRead = () => item, null)) {
  case (selectorRead = () => item, null):
    statementRead = () => item
    let item = "inside"
}
return [discriminantRead(), selectorRead(), statementRead()]
