# test if conditions which are optimised by the compiler

if 0:
    print(5)
else:
    print(6)

if 1:
    print(7)

if 2:
    print(8)

if -1:
    print(9)
elif 1:
    print(10)

if 0:
    print(11)
else:
    print(12)

if 0:
    print(13)
elif 1:
    print(14)

if 0:
    print(15)
elif 0:
    print(16)
else:
    print(17)

if not False:
    print('a')

if not True:
    print('a')
else:
    print('b')

if False:
    print('a')
else:
    print('b')

if True:
    print('a')

if (1,):
    print('a')

if not (1,):
    print('a')
else:
    print('b')

# test evaluation of the if-condition with tuples as arguments
# non-constant tuples should be evaluated even though they will evaluate to true

def f(x):
    print("f", x)

if (f(1),):
    print(18)

if (f(2), f(3)):
    print(19)

# test if-conditions within a function

f2 = 0

def f(t1, t2, f1):
    if False:
        print(1)
    if True:
        print(1)
    if ():
        print(1)
    if (1,):
        print(1)
    if (1, 2):
        print(1)
    if t1 and t2:
        print(1)
    if (t1 and t2): # parsed differently to above
        print(1)
    if not (t1 and f1):
        print(1)
    if t1 or t2:
        print(1)
    if (t1 or t2): # parse differently to above
        print(1)
    if f1 or t1:
        print(1)
    if not (f1 or f2):
        print(1)
    if t1 and f1 or t1 and t2:
        print(1)
    if (f1 or t1) and (f2 or t2):
        print(1)

f(True, 1, False)
