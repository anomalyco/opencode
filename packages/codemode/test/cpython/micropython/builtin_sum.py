# test builtin "sum"

tests = (
    (),
    [],
    [0],
    [1],
    [0, 1, 2],
    range(10),
)

for test in tests:
    print(sum(test))
    print(sum(test, -2))
