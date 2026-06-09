---
description: Check OPE closure when a set of candidate generators are given as some realization

compatibility: OPEdefs.m, OPEdefs.wls, wolframscript
---



Start with a list of "generators" written in some free field realization. E.g., `T = b c' - (1/2)NO[β, γ'] + (1/2)NO[β', γ]`

First we have some helper function that list all operators at given conformal weight.

```Mathematica
Clear[ListLettersAtWeight, ListOpsAtPartition, ListOpsAtWeight]
LettersAtWeight[0] = {};
(* 列举所有 weight = n 的 letters *)
(* e.g., 如果 T\[Element]generators 是一个抽象生成元 h[T] = 2 的话，
那么 LettersAtWeight[4] 就会包含 T^\[Prime], NO[T,T] *)

ListLettersAtWeight[n_, generators_ : generators] := 
 Table[If[IntegerQ[n - h[g]] && n >= h[g], 
    Derivative[n - h[g]][g], {}], {g, generators}] // Flatten
(* for partition {n1,n2, ...}, return operators of the form \
NO[Subscript[O, h=n1],Subscript[O, h=n2], ...] *)
(* OPEPosition[g\[Element]generators] should return Integer *)
ListOpsAtPartition[partition_List, generators_ : generators] := 
  Outer[$NO, 
        Sequence @@ 
         Table[LettersAtWeight[part], {part, partition}]] /. $NO[
         l__] :> $NO @@ SortBy[List[l], OPEPosition] /. $NO -> NO // 
     Flatten // DeleteDuplicates // DeleteCases[#, 0] &;

(* return a list of operators at conformal weight n built from GLOBAL \
generators *)
Clear[ListOpsAtWeight]
ListOpsAtWeight[n_ : (_Rational | _Integer), 
  generators_ : generators] := 
 Table[ListOpsAtPartition[partition], {partition, 
    1/2 IntegerPartitions[2 n]}] // Flatten
```


然后是扫描生成元之间的 OPE (使用 realization 进行计算；generators 本身只是抽象符号，没有定义具体的 OPE 是什么，必须通过 realization 来确定 OPE 的具体表达式)

```Mathematica
Clear[CheckStrongClosure]
(* 检查 realized 生成元之间的 OPE 封闭；如果封闭，应该输出全是 {{i,j,k}, 0} *)
(* 输出中的 OPEresult 包含了所有的 OPEData *)
CheckStrongClosure[generators_, realization_, printResult_ : False] :=
  Module[{i, j, n, aaa, candidates, result, diff, eq, closure, sols, 
   sol, OPEresult},
  closure = True;

  (* 逐一列举 算符对；由于 OPEdefs.m 的设计，先声明的算符应该放左边 *)
  (* 我们假设 全局变量 generators 里面的算符排序跟声明顺序相符 *)
  For[i = 1, i < Length[generators] + 1, i++,
   For[j = i + 1, j < Length[generators] + 1, j++,
    
    (* n 标记 n 阶极点 *)
    For[n = 1, n <= h[generators[[i]]] + h[generators[[j]]], n++,

     (* 能够用于给出极点的算符 (具有相同 conformal weight) *)
     candidates = 
      ListOpsAtWeight[h[generators[[i]]] + h[generators[[j]]] - n];

     (* 计算极点跟 candidates 线性组合的差值 *)
     diff = 
      OPEPole[n][
        OPE[generators[[i]] /. realization, 
         generators[[j]] /. realization]] - 
       Array[aaa, Length[candidates]] . candidates;

     (* 线性组合中代入 realization，并按照 NO 结构合并同类项 *)
     diff = 
      diff /. realization //. {NO[x_] :> x, NO[] -> One} // 
       Collect[#, {NO[___], One}] &;

     (* NO 前的系数 应当 == 0，求解线性方程组 *)
     eq = 
      If[TrueQ[
        Head[diff] == Plus], (List @@ diff) /. {One -> 1, 
         NO[___] :> 1}, diff /. {One -> 1, NO[___] :> 1}];
     
     sols = Solve[eq == 0];
     If[Length[sols] == 0, closure = False];
     sol = sols[[1]];

     (* 验证线性组合的解是否符合要求：diff 应当 == 0 *)
     diff = 
      OPEPole[n][
            OPE[generators[[i]] /. realization, 
             generators[[j]] /. realization]] - 
           Array[aaa, Length[candidates]] . candidates /. sol /. 
         realization /. {NO[x_] :> x, NO[] -> One} // Expand;
     

     (* 收集解信息方便以后使用 *)
     result[i, j, n] = {{i, j, n}, 
       Array[aaa, Length[candidates]] . candidates /. sol /. 
        aaa[_] :> 0}
     ];
    
    (* 记得要 Reverse，OPEData 左边是高阶极点，右边是低阶极点 *)
    OPEresult[i, j] = 
     OPEData[Table[
        result[i, j, n][[2]], {n, 
         h[generators[[i]]] + h[generators[[j]]]}] // Reverse];
    If[printResult, Print[OPEresult[i, j]]]
    
    ]
   ];
  
  
  {closure, OPEresult}
  ]
```

# 例子
准备工作

```Mathematica

(* U(1) \[ScriptCapitalN]=4 理论本质是 small bc + \[Beta]\[Gamma]  *)
(* 基本单元是 b, c^\[Prime], \[Beta], \[Gamma] *)

Clear[T, J, Jplus, Jminus, Gplus, Gminus, Gtplus, Gtminus, U];
(* CC 代替 c^\[Prime] *)
{h[b], h[CC], h[\[Beta]], h[\[Gamma]]} = {1, 1, 1/2, 1/2};
{h[T], h[J], h[Jplus], h[Jminus], h[Gplus], h[Gminus], h[Gtplus], 
   h[Gtminus], h[U]} = {2, 1, 1, 1, 3/2, 3/2, 3/2, 3/2, 2};
generators = {T, J, Jplus, Jminus, Gplus, Gminus, Gtplus, Gtminus, 
   U};
freefields = {b, CC, \[Beta], \[Gamma]};

Get["OPEdefs.m"];
(*NO[x_]:=x;*)
Bosonic[\[Beta], \[Gamma], T, J, Jplus, Jminus, U];
Fermionic[b, CC, Gplus, Gminus, Gtplus, Gtminus]
OPE[b, CC] = MakeOPE[{One, 0}];
OPE[\[Beta], \[Gamma]] = MakeOPE[{-One}];


realization = {
   J -> NO[\[Beta], \[Gamma]],
   Jplus -> NO[\[Beta], \[Beta]],
   Jminus -> NO[\[Gamma], \[Gamma]],
   
   Gplus -> NO[\[Beta], b],
   Gminus -> NO[b, \[Gamma]],
   Gtplus -> NO[\[Beta], CC],
   Gtminus -> NO[\[Gamma], CC],
   T -> NO[b, CC] - 1/2 NO[\[Beta], Derivative[1][\[Gamma]]] + 
     1/2 NO[Derivative[1][\[Beta]], \[Gamma]],
   
   U -> NO[CC, b]
   };
```

列举算符
```
(* generators = {T,J,Jplus,Jminus,Gplus,Gminus,Gtplus,Gtminus,U} *)

(* 列出指定 conformal weight 的 letter *)
ListLettersAtWeight[3]

(* 列出指定 conformal weight 的由这些生成元及其导数的 NO product 构成的算符 *)
ListOpsAtWeight[2]

```

检查封闭
```
(* 检查 上述 {T,J,Jplus,Jminus,Gplus,Gminus,Gtplus,Gtminus,U} 是否封闭 *)
CheckStrongClosure[generators, realization]
OPEresult = %[[2]];
Table[{generators[[i]], generators[[j]], 
  OPEresult[i, j] // OPEToSeries}, {i, Length[generators]}, {j, i + 1,
   Length[generators]}]
```
