const [first, , third = "t", ...others] = [1, 2, undefined, 4, 5]
let x = 1, y = 2
;[x, y] = [y, x]
return [first, third, others, x, y]
