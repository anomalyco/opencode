function outer() { var o = 1; function inner() { var o = 2; return o } return [inner(), o] } return outer()
