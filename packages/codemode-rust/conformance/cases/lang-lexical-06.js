let before
let testRead
let bodyRead
let updateRead
let run = true
for (
  let item = "outside", ignored = before = () => item;
  run && (item = "inside", testRead = () => item);
  updateRead = () => item
) bodyRead = () => item, run = false
return [before(), testRead(), bodyRead(), updateRead()]
