---
description: Perform Zhu's recursion
compatibility: OPEdefs.m, OPEdefs.wls, wolframscript
---

# Task
Compute the Zhu's recursion of an insertion of operator, formally written as $\operatorname{str}o(N)q^{L_0 - c/24}b^f$.

Reference: [VOA-recursion](../manual/VOA-recursion.md)

# Prerequisite
abstract generators and their OPEs, conformal weights and charges

# Example

```mathematica
Import["OPEdefs.m"]
ClearAll[T, J, Jplus, Jminus, Gplus, Gminus, Gbarplus, Gbarminus];
Declare[{}][{T, J, Jplus, Jminus}][{Gplus, Gminus, Gbarplus, 
   Gbarminus}];

OPE[T, T] = MakeOPE[{-3/2  One, 0, 2 T, Derivative[1][T]}];
OPE[T, J] = MakeOPE[{J, Derivative[1][J]}];
OPE[T, Jplus] = MakeOPE[{Jplus, Derivative[1][Jplus]}];
OPE[T, Jminus] = MakeOPE[{Jminus, Derivative[1][Jminus]}];
OPE[T, Gplus] = MakeOPE[{3/2 Gplus, Derivative[1][Gplus]}];
OPE[T, Gminus] = MakeOPE[{3/2 Gminus, Derivative[1][Gminus]}];
OPE[T, Gbarplus] = MakeOPE[{3/2 Gbarplus, Derivative[1][Gbarplus]}];
OPE[T, Gbarminus] = MakeOPE[{3/2 Gbarminus, Derivative[1][Gbarminus]}];
OPE[J, J] = MakeOPE[{-One, 0}];
OPE[J, Jplus] = MakeOPE[{2 Jplus}];
OPE[J, Jminus] = MakeOPE[{-2 Jminus}];
OPE[J, Gplus] = MakeOPE[{Gplus}];
OPE[J, Gminus] = MakeOPE[{-Gminus}];
OPE[J, Gbarplus] = MakeOPE[{Gbarplus}];
OPE[J, Gbarminus] = MakeOPE[{-Gbarminus}];
OPE[Jplus, Jminus] = MakeOPE[{2 One, -4 J}];
OPE[Jplus, Gminus] = MakeOPE[{-2 Gplus}];
OPE[Jplus, Gbarminus] = MakeOPE[{-2 Gbarplus}];
OPE[Jminus, Gplus] = MakeOPE[{2 Gminus}];
OPE[Jminus, Gbarplus] = MakeOPE[{2 Gbarminus}];
OPE[Gplus, Gbarplus] = MakeOPE[{Jplus, 1/2 Derivative[1][Jplus]}];
OPE[Gplus, Gbarminus] = MakeOPE[{-One, J, T + 1/2 Derivative[1][J]}];
OPE[Gminus, Gbarplus] = MakeOPE[{One, J, -T + 1/2 Derivative[1][J]}];
OPE[Gminus, Gbarminus] = 
  MakeOPE[{Jminus, 1/2 Derivative[1][Jminus]}];



Clear[h, Q]
{h[T], h[J], h[Jplus], h[Jminus], h[Gplus], h[Gminus], h[Gbarplus], 
   h[Gbarminus]} = {2, 1, 1, 1, 3/2, 3/2, 3/2, 3/2};

h[op_Plus] := h@op[[1]]
h[\[Lambda]_?NumericQ op_] := h[op]
h[Derivative[n_][op_]] := h[op] + n;
h[NO[op___]] := h /@ List[op] // Total
h[\[Lambda]_?NumericQ] := 0;

Q[op_Plus] := Q[op[[1]]]
Q[\[Lambda]_?NumericQ op_] := Q[op]
Q[Derivative[n_][op_]] := Q[op];
Q[NO[op___]] := Q /@ List[op] // Total
Q[\[Lambda]_?NumericQ] := 0;
Q[x_] := Q[x] = OPEPole[1][J, x]/x // Simplify

```


```mathematica
str[o[NO[T,NO[T,J]]]]//ZhuRecursion
(* -> DDbi[1][1, MMDO[2, cch]] + 2 DDbi[1][1, MMDO[1, cch]] EEi[2][q] + 
 2 DDbi[1][1, cch] EEi[2][q]^2 + 15/2 DDbi[1][1, cch] EEi[4][q] *)
```
