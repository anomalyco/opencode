#!/usr/bin/env wolframscript
(* ::Package:: *)

(* ::SmallText:: *)
(*This is version 3.1 of a general purpose Mathematica package*)
(*for computing Operator Product Expansions of composite operators in*)
(*meromorphic conformal field theory. Given the OPEs for a set of*)
(*"basic" fields, OPEs of arbitrarily complicated composites can be*)
(*computed automatically. Normal ordered products are always reduced*)
(*to a standard form. It is written by*)
(*     Kris Thielemans*)
(*     Theoretical Physics Group*)
(*     Imperial College*)
(*     London SW7 2BZ, UK*)
(*     (Email-address : please use kris@tfdec1.fys.kuleuven.ac.be)*)
(**)
(*A description of the package Version 2.0  is found in*)
(*     Int. J. Mod. Phys. C Vol. 2, No. 3 (1991) 787-798.*)
(*which actually documents version 2.0. Please refer to this paper*)
(*in your publications.*)
(*Version 3.0 is documented in*)
(*   "A Mathematica Package for Computing Operator Product *)
(*   Expansions (update)"*)
(*   Proc. Conf. on Artificial Intelligence in High Energy and Nuclear Physics,*)
(*   La Londe-les-Maures (France), 11-18 Jan. '92.*)
(*Version 3.1 you find in*)
(*   "An Algorithmic Approach to Operator Product Expansions, *)
(*    W-algebras and W--strings"*)
(*   PhD thesis KULeuven (1994), hep-th/ 9506159.*)
(*   This also contains some more details about how this all works.*)
(**)
(**)
(*!!!  WARNING : the current version is INCOMPATIBLE with version 2.0. *)
(*!!!  check the "history" section for details.*)
(**)
(*You're free to redistribute this package, on the only condition you*)
(*keep this header and don't distribute modified code.*)
(**)
(*Of course, I do not guarantee you get correct results (even if you use*)
(*the package correctly !), although it is tested rather extensively.*)
(*This version runs in Mathematica 1.2 to 2.2. I don't expect difficulties*)
(*in version 1.1 (but I was not able to check it).*)
(**)
(*Please contact me if you want to use the package, such that I know*)
(*who uses it, and you can get any updates or related packages.  Any*)
(*comments, bugs and especially improvements are welcome.*)


(* ::Section::Closed:: *)
(*History*)


(* ::Subsection::Closed:: *)
(*Changes from 2.0 to 3.0*)


(* ::SmallText:: *)
(* (see the ::usage definitions for further*)
(*                           explanation on the new symbols)*)
(*    (Many thanks to Klaus Hornfeck, now at King's College London,*)
(*     for the many suggestions and help in testing this version.)*)
(**)
(* INCOMPATIBILITIES with 2.0*)
(* - All arguments of the operators are discarded, so StripArg should be*)
(*    obsolete. (see next point)*)
(* - A function MakeOPE is provided to construct an OPE. It is the only*)
(*    safe way to define an OPE (for future compatibility).*)
(*    MakeOPE can be used in two ways : using a series expansion (as in*)
(*    version 2.0), or listing the operators in the poles.*)
(* - For efficiency and consistency, a constant operator "One" is used.*)
(*    to denote the unit operator (i.e. the one with only a zero mode)*)
(*    Example :*)
(*             Bosonic[T]*)
(*             OPE[T,T] = MakeOPE[{c/2 One, 0, 2 T, T'}]*)
(**)
(* New functionality :*)
(*  - Addition of OPEPole[i_][A_,B_] which returns a single pole from the*)
(*    OPE[A,B].*)
(*    Equivalent to, but much faster if you need only one pole than*)
(*    OPEPole[i][OPE[A,B]].*)
(*  - OPESimplify now takes a optional second argument : a function to*)
(*     apply to the coefficients of the poles. It does this also for (sums of)*)
(*     operators. (Note that in early beta- versions of 3.0 this functionality*)
(*     was provided through a seperate function PoleSimplify. Please do not*)
(*     use this function any longer).*)
(*     Finally, OPESimplify is effectively Listable.*)
(*  - A function to set global switches for the package is provided :*)
(*    SetOPEOptions.*)
(*      - the switch OPESaving to prevent saving of intermediate*)
(*         results (to avoid swapping).*)
(*         Setting the switch to False prevents saving of results in*)
(*         subsequent calculations. The switch defaults to True.*)
(*      - the switch NOOrdering to set the order of derivatives of*)
(*         fields inside normal ordered products. Default ordering is higher*)
(*        derivatives appear to the left.*)
(*      - the switch OPEMethod enables one to swtich between Poisson*)
(*        bracket computations, and normal OPEs (this method is the*)
(*        default.*)
(*  - Addition of OPESave[_String] to save intermediate results.*)
(*  - A (numerical) variable OPEdefsVersion is included.*)
(*  - GetCoefficients returns a list of all operators in expr.*)
(*  - MaxPole gives the order of the highest pole.*)
(*  - NO can be applied to more operators, e.g. NO[A,B,C] is equivalent to NO[A,NO[B,C]].*)
(*  - addition of ClearOPESavedValues[].*)
(**)
(*Renaming of some functions*)
(*  - SMap is renamed OPEMap*)
(*  - Term[ope, i]  is renamed OPEPole[-i][ope]*)
(*  - The 3.0 beta function PoleSimplify is superseded by OPESimplify.*)
(**)
(*Changes to implementation*)
(*  - Addition of a rule which makes OPE[NO[A,B], C] faster. Currently,*)
(*    it is only applied when B is NOT a composite, because in other*)
(*    cases, the original rules work (sometimes) faster.*)
(*  - Changes to NODerivativeHelp, uses Leibniz now (no saving of*)
(*    results anymore).*)
(*  - Addition of a rule which makes rewriting of NO[NO[A,B], C] faster.*)
(*  - Used SetAttributes[Delta, Orderless] to implement symmetry of the*)
(*    Delta-symbol, instead of a transformation rule (slightly faster).*)


(* ::Subsection::Closed:: *)
(*Changes in version 3.1*)


(* ::SmallText:: *)
(*beta 1:*)
(*-MaxPole is now a global function.*)
(*-Addition of OPEParity .*)
(*-Addition of the option ParityMethod.*)
(*-Change in definition of CallAndSave, works now via the option OPESaving.*)
(*-Changed rules for OPEPole[i_] to match only when i is Integer.*)
(*beta 2:*)
(*-Moved Orderless attribute for Delta after other definitions for Delta. Otherwise,*)
(* the rules are tested twice.*)
(*- Small change to NOOrderHelp, slightly faster now.*)
(*beta 3:*)
(*   - GetCoefficients is now Listable. That means when acting on a list of*)
(*     operators, it will returns a list of lists. To get the same result as before,*)
(*     use Flatten.*)
(*   - Addition GetOperators.*)
(*   - OPESimplify now accepts the option Function.*)
(*   - OPEJacobi now accepts the option Function.*)
(*   - Added support for Dummies` via the option EnableDummies.*)
(*beta 4:*)
(*   - Write warning message when loading Dummies` concerning OPESaving and call*)
(*     ResetDummies.*)
(*   - Moved Delta to separate package*)


(* ::Input::Initialization:: *)
BeginPackage["OPEdefs`", "Delta`"];


(* ::Section::Closed:: *)
(*Exported symbols*)


(* ::Input::Initialization:: *)
OPEdefsVersion = 3.1;
betaVersion = 4;
Print["OPEdefs Version ", OPEdefsVersion,
      " (beta ",betaVersion,") by Kris Thielemans"]
Print["Type ?OPEdefsHelp for a primer on OPEdefs."]

OPEdefsHelp::usage = StringJoin[
"First, declare your operators using Bosonic, Fermionic\n
    e.g.: Bosonic[T, J[_]]\n",
"Then, define the non-zero OPEs using MakeOPE. If you declared operator
A before B, you have to define OPE[A,B]. There are two ways of using
MakeOPE (type ?MakeOPE to know more about them).\n
    e.g.: OPE[T,T] = MakeOPE[{c/2 One, 0, 2 T, T'}]\n
          OPE[T,J[i_]] = MakeOPE[{J[i], J[i]'}]\n
          OPE[J[i_],J[j_]] =\n
              MakeOPE[Delta[i,j] J[j][w] / (z-w)^2 + Ord[z,w,0]]\n",
"Compute what you want using OPE, NO (normal ordered products),
OPEPole, OPESimplify\n",
"Note : if you want to do Poisson bracket computations, issue\n
          SetOPEOptions[OPEMethod, ClassicalOPEs]\n
before any other definitions.\n
\nType ?OPEdefs`* for all global symbols.
\nReloading the package (with Get or \"<<\"), clears all your definitions
and stored intermediate results concerning OPEs."]

OPEData::usage =
        "The head of the structure returned by OPE. For future
compatibility, do not use its structure directly. See MakeOPE instead."

MakeOPE::usage =
        "Must be used to make an OPEData structure. Two possibles ways of
using MakeOPE for defining the OPE of A[z] with B[w] are :\n
- giving it a series up to order 0 in (z-w). This can be done by adding
Ord[z,w,0] to the series (see Ord).\n
    e.g.: MakeOPE[c/2 One[w]/(z-w)^4 + 2T[w]/(z-w)^2 + T'[w]/(z-w) +
    Ord[z,w,0]]\n
- giving it the list of the operators occuring in the poles of this series.
Begin with the highest order pole, and list ALL poles up to the first order
pole (i.e. also the zero ones)\n
    e.g.: MakeOPE[{c/2 One, 0, 2T, T'}]\n
Note that when using MakeOPE in the first way, all poles are checked if an
operator is present. If not, the pole is multiplied with the constant
operator One."

Ord::usage =
        "Must be used when using the \"series\"-way of defining an OPE.
Adding a term Ord[z,w,0] means that the expression is a series in z around w."

OPE::usage =
        "OPE[A,B] gives the operator product expansion of A[z] B[w]
in the form of an OPEData structure which lists the poles (with the
argument w dropped) which occur in the series in z-w up to order 0 in z-w.
(see also MakeOPE)"

OPEPole::usage =
        "OPEPole[i][A,B] gives the operator occuring at the 'i'-th
order pole in the OPE of A[z] with B[w]. OPEPole[0][A,B] gives NO[A,B].
Negative 'i' can be used to get expressions for the regular part
of the OPE.\n
e.g.: (assuming T is defined as a Virasoro operator)\n
   OPEPole[1][T,T]\n
   -->  T'\n\n
OPEPole can also be used as OPEPole[i][some_ope]. In this case,
'i' must be strictly positive (otherwise, OPEPole returns 0).\n
e.g.: tt = OPE[T,T]; OPEPole[2][tt]\n
   --> 2 T"

NO::usage =
        "NO[A,B] denotes the normal ordered product of
A and B (point splitting convention). OPEPole[0][A,B] is defined as
NO[A,B]. Simplifications are done to reduce NO's to a standard form :
normal ordering is from the right to the left, earlier declared operators
are more to the left, and higher derivatives are (by default) more to
the left than lower ones.\n
See also NOOrdering."

(*
Delta::usage =
        "Delta[i,j] is the delta symbol."
*)

Term::usage =
        "Term[ope,n] is obsolete, use OPEPole[-n][ope]."

Bosonic::usage =
        "Bosonic[A] declares A as a bosonic operator.
You can use Bosonic[A,B,...] (see also Fermionic,OPEOperator,OPEParity)"

Fermionic::usage =
        "Fermionic[A] declares A as a fermionic operator.
You can use Fermionic[A,B,...] (see also Bosonic,OPEOperator,OPEParity)"

OPEOperator::usage =
        "OPEOperator[A,p] declares A as an operator of parity p. Here, p can
be a symbolic expression. You can use OPEOperator[{A,pA},{B,pB},...]. Using
only Bosonic and Fermionic gives slightly faster calculations
(see also Bosonic,Fermionic,OPEParity,ParityMethod).\n
e.g.: OPEOperator[J[i_], parity[i]]"

OPEParity::usage =
        "OPEParity[A] returns the parity of the operator A. The parity of a 
bosonic (fermionic) operator is an even (odd) integer number."

One::usage =
        "The constant operator : derivatives of it are considered
zero, an OPE with anything else is regular, and the NO with any other
operator is that operator."

SMap::usage =
        "SMap is obsolete, it is renamed OPEMap for consistency."

OPEMap::usage =
        "OPEMap[f, ope] maps a function 'f' to all poles of 'ope'.
OPEMap[f, ope, level] maps 'f' at a specific level (see Map).\n
e.g.: OPEMap[Expand, ope]\n
See also OPEMapAt."

OPEMapAt::usage =
        "OPEMapAt[f, ope, position] maps a function 'f' to a certain
point of 'ope' (see MapAt).\n
e.g.: OPEMapAt[Expand, ope, {1}]\n
  maps Expand on the highest order pole of 'ope'\n
See also OPEMap."

OPESimplify::usage =
        "Applied to a sum of operators, collects terms
with the same operator.\n 
Applied to an OPE collects terms with the same operator in every pole.
It effectively maps OPESimplify on all the poles of the OPE.\n
OPESimplify distributes over lists.\n
OPESimplify accepts the option Function which determines which 
function it will apply on the coefficients. By default
this is set to Expand. Use SetOptions to change the default.\n
e.g.: OPESimplify[T'' + 1/c T'' + 2 NO[T,T] + c NO[T,T] , 
           Function -> Together]\n
   --> (1+c)/c T'' + (2+c) NO[T,T]\n
The effect of the option Function
is also achieved by using OPESimplify[expr, function]."

PoleSimplify::usage =
        "PoleSimplify is obsolete, use OPESimplify instead."

GetCoefficients::usage =
        "GetCoefficients[expr] returns a list of the coefficients of all
operators in expr. The order in which they are given is currently
undefined.\n
(see also GetOperators)."

GetOperators::usage = 
"GetOperators[expr] returns a list of operators in expr.\n
(see also GetCoefficients)."

MaxPole::usage = "MaxPole[ope] gives the order of the highest pole."

OPEToSeries::usage =
        "OPEToSeries[ope, {arg1,arg2}] can be used to convert an OPE
to the usual form of a series expansion up to order 0. Defaults for
'arg1' and 'arg2' can be set with SetOPEOptions[SeriesArguments, {z1, z2}]
(initial values : z and w).\n
e.g.: OPEToSeries[MakeOPE[{J, J'}]]\n
      --> J[w] (-w+z)^-2 + J'[w] (-w+z)^-1 + O[-w+z]^0\n
See also SeriesArguments."

OPESave::usage =
        "OPEdefs by default remembers some intermediate results
(in particular OPEs of composites, and reordering of some composites).
OPESave can be used to save these results in a file. In a next session,
you can read that file (after loading OPEdefs AND your declarations of
the operators and OPEs you use).\n
Note : do not use intermediate results saved by an older version
of OPEdefs.\n
e.g.: OPESave[\"results.m\"]\n
      Quit[]\n
      ... restart mathematica\n
      Needs[\"OPEdefs`\"]\n
      ... read your normal definitions\n
      <<results.m\n
See also OPESaving."

SetOPEOptions::usage =
        "Function to set some options of the OPE package.
Currently available options : OPESaving, NOOrdering,
SeriesArguments, OPEMethod, ParityMethod, EnableDummies."

OPESaving::usage =
        "OPEdefs by default remembers some intermediate results
(in particular OPEs of composites, and reordering of some composites).
This of course speeds up future computations, but can require lots of
memory, which results in most of your time is spent in swapping parts of
memory to disk. A switch is provided to prevent OPEdefs to remember
these results.\n
The second argument of SetOPEOptions has to be an expression that will
evaluate to a boolean value (True of False).\n
e.g.: SetOPEOptions[OPESaving, True]\n
Setting the switch to False prevents saving of results in subsequent
calculations. The switch defaults to True.\n
A more sophisticated use is the following :\n
          SetOPEOptions[OPESaving, MaxMemoryUsed[] < 6 10^6]\n
This will save intermediate results as long as you don't have used
more than 6 Mb. (On most systems using MaxMemoryUsed[] is more appropriate
than MemoryInUse[] to avoid swapping.)"

NOOrdering::usage =
        "An option to set the order of derivatives of
fields inside normal ordered products. Specify an integer number (n) as
the second argument of SetOPEOptions. Three cases apply :\n
    n <0 : higher derivatives of a field are moved to the left (default)\n
    n==0 : no reordering (not advised, certainly when OPESaving is set
to True)\n
    n >0 : lower derivatives of a field are moved to the left.\n
Please note that resetting the switch after calculations are done (while
OPESaving is set to True) causes some intermediate results to be ignored.\n
e.g. : SetOPEOptions[NOOrdering, -1]\n
       NO[J, J']  -> NO[J', J] + ..."

SeriesArguments::usage =
       "An option to set the arguments to be used in OPEToSeries and
when printing an OPEData expression with TeXForm. By default, the
arguments are set to z and w (beware if you assigned values to z or w !).\n
e.g.: SetOPEOptions[SeriesArguments, {z1,  z2}]\n
See also OPEToSeries."

OPEMethod::usage = "An option to set the way OPEs are computed.
Currently implemented methods : QuantumOPEs, ClassicalOPEs
(see e.g. ?QuantumOPEs). The first method is the default.\n
e.g.: SetOPEOptions[OPEMethod, ClassicalOPEs]."

ClassicalOPEs::usage = "A value for the OPEMethod option that
specifies that OPEs will be computed as Poisson brackets (no
multiple contractions, graded-commutative and associative normal
ordering).\n
Important : if OPESaving is set to true (the default), this option
can currently only be safely set before any OPEs are used.\n
See also OPEMethod, QuantumOPEs, OPESaving."

QuantumOPEs::usage =  "A value for the OPEMethod option that
specifies that OPEs will be computed as normal OPEs (multiple
contractions, normal ordering).\n
Important : if OPESaving is set to true (the default), this option
can currently only be safely set before any OPEs are used.\n
See also OPEMethod, ClassicalOPEs, OPESaving."

ParityMethod::usage = "An option that determines the way OPEdefs computes
signs.
When the second argument to SetOPEOptions is 0, all operators have to be
declared to be Bosonic or Fermionic (this is the default). When the argument
is 1, symbolic parities can be used.\n
Note that in the last case, powers of $-1$ are used to compute signs, which is
slightly slower than the boolean function which is used by the first
method.\n
This option is not normally needed as using OPEOperator with a 
symbolic second argument sets this option automatically.\n
e.g.: SetOPEOptions[ParityMethod,1]"

EnableDummies::usage = "An option which enables use of the Dummies` package. Use\n
\tSetOPEOptions[EnableDummies, True]"

ClearOPESavedValues::usage = "ClearOPESavedValues[] clears all the
intermediate results that were stored. It doesn't clear the definitions
for the OPEs."

OPEJacobi::usage = "OPEJacobi[A,B,C] check the Jacobi identities
for A,B,C. It returns a double list of expressions which should
all be zero (or a null field)."

StripArg::usage =
        "StripArg is an obsolete function that you
shouldn't need anymore. However, it is still provided
for special applications.\n
StripArg[A] removes the arguments of operators.\n
e.g.: (Assuming A and B are declared as operators)\n
      StripArg[(1-q^2)(A[w] + 2B[w]) -> (1-2q^2)(A + 2B)\n
Caveat : StripArg of a number does not give an operator.\n
e.g.: StripArg[1] -> 1  applied to an argument gives 1[argument]"

If [!NumberQ[$VersionNumber] || $VersionNumber < 2.0,
StringReplace::usage =
        "Own implementation of a Mathematica Version 2.0 function.";
Fold::usage =
        "Own implementation of a Mathematica Version 2.0 function."
]
Null


(* ::Section:: *)
(*Implementation*)


(* ::Input::Initialization:: *)
Begin["`Private`"];


(* ::Subsection::Closed:: *)
(*Auxiliary functions (StringReplace, Fold)*)


(* ::Input::Initialization:: *)
(*
Clear[Delta]
Delta[a_,a_] = 1
Delta[i_,j_] := 0 /; i!=j
SetAttributes[Delta, Orderless]
*)

If[!NumberQ[$VersionNumber] || $VersionNumber < 2.0,
    (* 15-10-92 (3.0 beta 5)
       previous implementation changed only first occurences, unlike
       StringReplace in Mathematica 2.0 -> Use FixedPoint
    *)
    StringReplace[str_String, (str1_String)->(str2_String)] :=
        StringReplace[str,{str1->str2}];
    StringReplace[str_String, rules_List] := Block[
        { newrules =
             rules /.
                  (  (str1_String)->(str2_String) )
                  :>
                  ( {p1___,Sequence @@ Characters[str1],p2___}
                     ->{p1,{str2},p2}
                  ) ,
          chars = Characters[str]
        },
        (* Replace changes only toplevel expressions *)
        chars = FixedPoint[Replace[#,newrules]&, chars];
        StringJoin[Sequence @@ Flatten[chars]]
        ];

     Fold[func_, expr_, l_List] := Block[
         { res = expr
         },
         Scan[ (res = func[res, #])&, l ];
         res
     ]
]


(* ::Subsection::Closed:: *)
(*Functions to manipulate OPEdatas*)


(* ::Subsubsection::Closed:: *)
(*OPEData*)


(* ::Input::Initialization::RGBColor[0., 0., 0.]::Plain:: *)
Clear[OPEData]
OPEData /: n_ * OPEData[A_List] := OPEData[n* A]

extend[A_List,n_Integer] :=
        Join[Table[0,{n-Length[A]}], A]
 (* 01-11-92 (3.0 beta 6)
  Previous implementation :
   OPEData /: Plus[A__OPEData] :=
        Block[{maxP = Max[MaxPole /@ {A}]},
            OPEData[ Plus @@ (extend[#[[1]],maxP]& /@ {A}) ]
        ]
  When given Plus[OPEData[a1], OPEData[a2]], this rule applies to give
  Plus[OPEData[a1+a2]]. Then the rule matches again (and does nothing).
  Also, when entering an (invalid) sum of an OPEData with something else,
  this rule causes infinite recursion.
  Change : make sure the rule matches only when there are at least 2
           OPEDatas. Also use a pure-function instead of "extend", this
           turns out to be more efficient.
  Algorithm : use First to get the list of the poles for each OPE.
           Then "extend" the lists with zeroes such that they have equal length.
           Add these lists, and bracket with OPEData.
*)
A1_OPEData + A2__OPEData ^:=
        Block[{maxP = Max[MaxPole /@ {A1,A2}]},
            OPEData[ Plus @@
                (Join[ Table[0,{maxP-Length[#]}], # ]& /@
                    (First /@ {A1,A2})
                )
            ]
        ]
 (* 13-05-93 (3.0 beta 8) added .., although it doesn't change
    anything upto Mathematica 2.1 (and further ?)
 *)
OPEData[{(0).., A___}] := OPEData[{A}]


(* ::Subsubsection::RGBColor[0., 0., 0.]::Closed:: *)
(*MakeOPE*)


(* ::Input::Initialization::RGBColor[0., 0., 0.]::Plain:: *)
Clear[MakeOPE]
Ord[z_,w_,i_Integer] := SeriesData[z,w,{},i,i,1]
SeriesDataToOPEData =
        Literal[SeriesData[z_,w_,A_List,highest_Integer,0,1]] :>
        OPEData[Join[A /. (OP_[w] -> OP),
                                 Table[0, {-highest-Length[A]}]]];
checkOne[ope_OPEData] :=
     OPEMap[If[OperatorQ[#], #, # One]& , ope]

MakeOPE[l_List] := OPEData[l]

MakeOPE[l_SeriesData] := checkOne[(l /. SeriesDataToOPEData)]

MakeOPE[ope_OPEData] := ope

MakeOPE[l_] := (Message[MakeOPE::other, l]; MakeOPE[{}])
MakeOPE::other = "Error : `1` is not a SeriesData or a List object. Assuming
it is equivalent to MakeOPE[{}].";


(* ::Subsubsection::Closed:: *)
(*simplification*)


(* ::Input::Initialization::RGBColor[0., 0., 0.]::Plain:: *)
Clear[OperatorPattern, PoleSimplify, OPESimplify]

OperatorPattern := Alternatives @@ OperatorList

PoleSimplify[term_] :=
   Block[{expterm = Expand[term], var},
        var = ExtractOperators[expterm];
        Apply[Plus, (# Coefficient[expterm, #])& /@ var]
   ]
(* change 3.1 beta 3 : added option *)
PoleSimplify[term_, Function -> func_] :=
   PoleSimplify[term, func] 

PoleSimplify[term_, func_] :=
   Block[{expterm = Expand[term], var},
        var = ExtractOperators[expterm];
        Apply[Plus, (# func[Coefficient[expterm, #]])& /@ var]
   ]

Clear[ExtractOperators]
 (* ExtractOperators[expr_] returns a list of operators in expr
    !! It assumes that expr is Expanded
 *)
ExtractOperators[a_Plus] := Union[ ExtractOperators[#][[1]]& /@ (List @@ a)]
If[ !NumberQ[$VersionNumber] || $VersionNumber < 2.0,
    (* old version of Mathematica *)
    ExtractOperators[a_Times] := Select[List@@a, OperatorQ]
    ,
    (* new version : use Select[ , ,1] to extract the first operator
       you find (there is only one !)
    *)
    ExtractOperators[a_Times] := Select[List@@a, OperatorQ, 1]
]
ExtractOperators[0] = {};
ExtractOperators[a_] := {a}

(* change 3.1 beta 3: added options *)
Options[OPESimplify] = {Function -> Expand};

OPESimplify[A_OPEData, func___] :=
        OPEMap[PoleSimplify[#,func]& , A]
 (* 13-05-93 (3.0 beta 8) added two following definitions *)
OPESimplify[A_List, func___] :=
        OPESimplify[#,func]& /@ A
OPESimplify[A_, func___] :=
        PoleSimplify[A, func]

If[ !NumberQ[$VersionNumber] || $VersionNumber < 2.0,
    (* bug in old versions : OPEData[{a}] - OPEData[{a}] -> 0 *)
    OPESimplify[0, ___] = 0;
    OPEMap[_, 0,___] = 0;
    OPEMapAt[_, 0,_] = 0;
]



(* ::Subsubsection::Closed:: *)
(*Mapping*)


(* ::Input::Initialization::RGBColor[0., 0., 0.]::Plain:: *)
Clear[OPEMap, OPEMapAt]

OPEMap[f_, ope_OPEData, levelspec___] :=
    MapAt[Map[f, #, levelspec] & , ope, {1}]
 (*
  OPEMap[f_, ope_OPEData] :=
        MapAt[Map[If[Head[#]=!=Plus, f[#], (f /@ #1)] &,#]& , ope, {1}]
 *)
OPEMapAt[f_, ope_OPEData, position_List] :=
    MapAt[MapAt[f, #, position] & , ope, {1}]


(* ::Subsubsection::Closed:: *)
(*GetCoefficients, GetOperators*)


(* ::Input::Initialization::RGBColor[0., 0., 0.]::Plain:: *)
ClearAll[GetCoefficients]
SetAttributes[GetCoefficients,Listable]
GetCoefficients[something_] := Block[{ii,term},
        ii=1;
        OPESimplify[something,If[#===0,0,term[ii++] = #]&];
        Array[term,{ii-1}]
]

ClearAll[GetOperators]
SetAttributes[GetOperators, Listable]

GetOperators[A_OPEData] := Join @@ Map[GetOperators, First[A]]

GetOperators[a_Plus] := Union[Join@@ (GetOperators /@ (List @@ a))]
If[ !NumberQ[$VersionNumber] || $VersionNumber < 2.0,
    (* old version of Mathematica *)
    GetOperators[a_Times] := 
           GetOperators@@Select[List@@a, OperatorQ]
    ,
    (* new version : use Select[ , ,1] to Get the first operator
       you find (there is only one !)
    *)
    GetOperators[a_Times] := 
           GetOperators@@Select[List@@a, OperatorQ, 1]
]
GetOperators[0] = {};
GetOperators[a_] := {a}


(* ::Subsubsection::Closed:: *)
(*try using LinOperate (does not work yet, too slow)*)


(* ::Input::RGBColor[0., 0., 0.]::Plain:: *)
(*PoleSimplify[A_] :=*)
(*        PoleSimplify[A, Sequence@@ Options[OPESimplify]]*)
(*PoleSimplify[term_, Function -> func_] :=*)
(*( (*tmp = *)*)
(*    LinCollect[term, GetOperators[term], func,*)
(*      Pattern -> _NonCommutativeMultiply](*;*)
(*  If[ Expand[tmp-term/. Global`cc->8] =!= 0,*)
(*      Print[tmp//InputForm]];*)
(*  tmp*)*)
(*)*)
(*PoleSimplify[A_,func_] :=*)
(*        PoleSimplify[A, Function->func]*)
(**)
(*GetCoefficients[A_OPEData] :=*)
(*        Flatten[GetCoefficients[First[A]]]*)
(*GetCoefficients[pole_] :=*)
(*   LinOperate[pole, ExtractOperators[pole], #2&, List,*)
(*      Pattern -> _NonCommutativeMultiply]*)


(* ::Subsection::Closed:: *)
(*Rules for Derivative*)


(* ::Input::Initialization:: *)
 (************************* Derivative *****************************)
Clear[Derivative]
Derivative[i__][A_Plus] := Derivative[i] /@ A
Derivative[i__][A_ s_]  := s Derivative[i][A] /; OperatorQ[A]
Derivative[_][0] = 0
 (* A comment on efficiency of the rule for a product given above.
    In Mathematica order, s follows A. Because Times is Orderless,
    this means that during pattern matching the A_ pattern will be
    matched to the factors in the product. So, for each factor
    OperatorQ is called once, until an operator is found.
        (a b OP)'     ?b OP (a')    OperatorQ[a]
                      ?a OP (b')    OperatorQ[b]
                      ?a b (OP')    OperatorQ[OP]
                  --> a b OP'
    With the rule
    Derivative[i__][B_ a_]  := a Derivative[i][B] /; OperatorQ[B]
    (a is ordered before B) you get
        (a b OP)'     ?a (b OP)'    OperatorQ[b OP]  (needs testing b and OP)
                  --> a (b OP)'
                      ? a b OP'     OperatorQ[OP]
                  --> a b OP'
    When more factors are present, this is obviously much less efficient
   ( n evaluations of the rules, (n-1)! or so OperatorQ )
 *)



(* ::Subsection::Closed:: *)
(*Operator Handling*)


(* ::Input::Initialization:: *)
Clear[Bosonic,Fermionic,OPEOperator,OPEParity,
      OPEposition,OPEOrder,OperatorQ, BosonQ,SwapSign]

 (****************** declaration of operators **********************)
BosonicHelp[A_] :=   (If[OperatorQ[A], Message[Bosonic::operator, A]];
                      OPEParity[A]=0; BosonQ[A]=True; OperatorQ[A]=True;
                      OPEposition[A] = OPEpositionCounter++;
                      AppendTo[OperatorList, A])
FermionicHelp[A_] := (If[OperatorQ[A], Message[Fermionic::operator, A]];
                      OPEParity[A]=1; BosonQ[A]=False; OperatorQ[A]=True;
                      OPEposition[A] = OPEpositionCounter++;
                      AppendTo[OperatorList, A])
OPEOperatorHelp[A_,n_Integer] := If[Mod[n,2]==0,BosonicHelp[A],FermionicHelp[A]]
OPEOperatorHelp[A_,p_] := (If[OperatorQ[A], Message[OPEOperator::operator, A]];
                      OPEParity[A]=p; OperatorQ[A]=True;
                      OPEposition[A] = OPEpositionCounter++;
                      AppendTo[OperatorList, A];
                      SetOPEOptions[ParityMethod,1])
Bosonic::operator = 
Fermionic::operator = 
OPEOperator::operator = "Warning : `1` is already declared operator.
Defining other OPEs as before for `1` may give wrong results."

OperatorList = {}
OPEpositionCounter = 0

Bosonic[A___] := Scan[BosonicHelp,{A}]
Fermionic[A___] := Scan[FermionicHelp,{A}]
OPEOperator[A:({_,_}..)] := Scan[OPEOperator, {A}]
OPEOperator[A_,p_] := (OPEOperatorHelp[A,p];Null)

 (******************** ordering of operators ***********************)
 (* OPEOrder[A,B] returns > 0 when A and B are ordered,
  *                       = 0 when A == B,
  *                       < 0 otherwise.
  * Ordering is fixed by the order in which the operators are
  * declared. If A and B match the same operator-pattern, use
  * standard Mathematica order.
  *)
OPEOrder[a_, b_] :=
    Block[{res = OPEposition[b] - OPEposition[a]},
        If[res == 0, Order[a, b], res]
    ]
 (*
 OPEOrder[A_,B_NO] := (Print["NOR ",A," ",B,Stack[_RuleCondition]];1)
 OPEOrder[A_NO,B_] := (Print["NOL ",A," ",B,Stack[_RuleCondition]];-1)
 *)
OPEOrder[A_,B_NO] =1
OPEOrder[A_NO,B_] =-1

OPEOrder[a_,a_]=0

 (************************* OperatorQ ******************************)
 (* OperatorQ[A] tests if A is an operator *)

OperatorQ[A_+B_] := OperatorQ[A]
 (*
OperatorQ[A_Plus] := (
        Or@@ (OperatorQ /@ (List@@A))
) *)
OperatorQ[A_Times] :=
        Or@@ (OperatorQ /@ (List@@A))

OperatorQ[Derivative[_][A_]] := OperatorQ[A]

 (* all other things are no operators *)
OperatorQ[_] = False
OperatorQ[0] = True

 (*********************** boson, fermion ***************************)
BosonQ[Derivative[_][A_]] := BosonQ[A]
OPEParity[Derivative[_][A_]] := OPEParity[A]
OPEParity[A_+B_]:= OPEParity[A]
OPEParity[a_ A_]:= OPEParity[A]/;!OperatorQ[a]


(* ::Subsection::Closed:: *)
(*OPE handling*)


(* ::Subsubsection::Closed:: *)
(*Clear values*)


(* ::Input::Initialization:: *)
Clear[OPE,
      OPEDerivativeHelpR, OPEDerivativeHelpL,
      OPECompositeHelpR, OPECompositeHelpL,
      OPECommuteHelp]
OPE::trace = "`1`";
OPEPole::trace = "`1`";
OPEDerivativeHelpL::trace = "`1`";
OPEDerivativeHelpR::trace = "`1`";
OPECompositeHelpL::trace = "`1`";
OPECompositeHelpR::trace = "`1`";
OPECommuteHelp::trace = "`1`";


(* ::Subsubsection::Closed:: *)
(*MaxPole*)


(* ::Input::Initialization:: *)
 (* MaxPole[ope] gives the order of the highest pole *)

MaxPole::other = "`1` should be a OPEData object, something wrong
here, assuming there are no poles in its OPE."

MaxPole[OPEData[A_List]] := Length[A]
MaxPole[A_] := (Message[MaxPole::other, A]; 0)



(* ::Subsubsection::Closed:: *)
(*OPE rules*)


(* ::Input::Initialization:: *)
 (********************** OPE properties ****************************)
 (* 11-06-93 (3.0 beta 10) added following rule *)
Literal[OPE[___,0,___]] = OPEData[{}];

 (*Linear*)
If[NumberQ[$VersionNumber],
    (*
    Literal[OPE[a___,b_Plus,c___]]:=
        Plus @@
            Distribute[
                Lineartmp[a,b,c],
                Plus,Lineartmp,
                Lineartmp2,OPE
        ]
    *)
    (* change 5-10-92 *)
    Literal[OPE[a___,b_Plus,c___]]:=
            Distribute[
                Lineartmp[a,b,c],
                Plus,Lineartmp,
                Plus,OPE
        ],
    (* bug in version 1.1 Distribute *)
    Literal[OPE[a___,b_+c_,d___]] :=
        OPE[a,b,d] + OPE[a,c,d]
]

Literal[OPE[A___,s_ B_,C___]] :=
         s OPE[A,B,C] /; OperatorQ[B]

Literal[OPE[Derivative[i_][A_],B_]]:=
        OPEDerivativeHelpL[A,B,i]

Literal[OPE[A_,Derivative[i_][B_]]]:=
        OPEDerivativeHelpR[A,B,i]

Literal[OPE[A_,NO[B_,C_]]] :=
        CallAndSave[OPECompositeHelpR,A,B,C]

Literal[OPE[NO[A_,B_],C_]] :=
        CallAndSave[OPECompositeHelpL,A,B,C] /; Not[SameQ[Head[B], NO]]

Literal[OPE[B_,A_]] :=
        OPECommuteHelp[B,A] /; SameQ[Head[B],NO] || OPEOrder[A,B]>0

 (* All non-defined OPEs are assumed to be zero *)
Literal[OPE[_,_]]= OPEData[{}];


(* ::Subsubsection::Closed:: *)
(*common auxiliary functions*)


(* ::Text::Closed:: *)
(*Derivatives*)


(* ::Input::Initialization:: *)
 (* OPE[Derivative[i_][A_],B_]] *)
 (* 08-11-92 (3.0 beta 6)
OPEDerivativeHelpL[A_,B_,i_] :=
        OPEData[
            Block[{j, AB = OPE[A,B], fac = (-1)^i * (i-1)!},
                Join[Reverse[
                        Table[(fac *= (j+i-1)) / (j-1)! opepole[j][AB],
                            {j,MaxPole[AB]}]
                    ],
                    Table[0, {i}]
                ]
            ]
        ]
*)
OPEDerivativeHelpL[A_,B_,i_] :=
        OPEData[
            Block[{j, AB = OPE[A,B]},
                Join[(-1)^i *
                        Table[Pochhammer[j,i]  opepole[j][AB],
                            {j,MaxPole[AB],1,-1}
                        ],
                     Table[0, {i}]
                ]
            ]
        ]

 (* OPE[A_,Derivative[i_][B_]] *)
 (* 08-11-92 (3.0 beta 6)
OPEDerivativeHelpR[A_,B_,i_] :=
    Block[{der, j, k,l, AB = OPE[A,B], maxAB},
        maxAB = MaxPole[AB];
        der[0] = Reverse[extend[AB[[1]], maxAB+i]];
        Do[der[j] = Map[Derivative[1], der[j-1]], {j,i}];
        OPEData[Reverse[
            Table[
                Sum[der[i-k][[j-k]] Binomial[i,k] Product[l,{l,j-k,j-1}],
                    {k,0,Min[i,j-1]}],
                {j,maxAB+i}]
        ]]
    ]
*)
OPEDerivativeHelpR[A_,B_,i_] :=
    Block[{der, j, k, AB = OPE[A,B], maxAB},
        maxAB = MaxPole[AB];
        der[0] = Reverse[ AB[[1]] ];
        Do[der[j] = Map[Derivative[1], der[j-1]], {j,i}];
        OPEData[
            Table[
                Sum[der[i-k][[j-k]] Binomial[i,k] Pochhammer[j-k,k],
                    {k, Max[0, j-maxAB], Min[i, j-1]}],
                {j,maxAB+i,1,-1}]
        ]
    ]


(* ::Text::Closed:: *)
(*Commutation*)


(* ::Input::Initialization:: *)
 (* OPE[B,A] in terms of OPE[A,B]
  * Formula:
  * [BA](q) = Sum[(-1)^l / (l-q)! D[[AB](l),{.,l-q}],
  *               {l,q,MaxPole[AB]}]
  *)
OPECommuteHelp[B_,A_] :=
    Block[{q,l,term,AB = OPE[A,B], max },
        max = MaxPole[AB];
        OPEData[
            SwapSign[A,B] *
            Table[
                (term[q] = (-1)^q opepole[q][AB]) +
                Sum[term[l] = (term[l]') / (l-q),
                      {l,q+1,max}
                ],
                {q,max,1,-1}
            ]
        ]
    ]


(* ::Subsubsection::Closed:: *)
(*auxiliary functions quantum case*)


(* ::Text::Closed:: *)
(*Composite at the right*)


(* ::Input::Initialization:: *)

 (* OPE[A,NO[B,C]] *)
ClearOPECompositeHelpRQ[] := (OPECompositeHelpRQ[A_,B_,C_] =.)

RedefineOPECompositeHelpRQ[] := (
    OPECompositeHelpRQ[A_,B_,C_] :=
        Block[{q,l,sign = SwapSign[A,B], ABC, AB, AC,
                 maxAB, maxABC, maxq},
            AB = OPE[A,B];
            AC = If[ SameQ[B,C], AB, OPE[A,C]];
            maxAB = MaxPole[AB];
            ABC = Table[
                      OPE[opepole[q][AB], C],
                      {q,maxAB}
                  ];
            (* change 6-4-92
               maxABC = Max[MaxPole /@ ABC];
               maxq = Max[maxABC + maxAB, MaxPole[AC]];
            *)
            maxABC = MaxPole /@ ABC;
            maxq = Max[maxABC + Range[maxAB], MaxPole[AC]];
            maxABC = Max[maxABC,0];
            OPEData[
                Table[
                    PoleSimplify[
                        sign * NO[B,OPEPole[q][AC]] +
                        NO[OPEPole[q][AB],C] +
                        Sum[Binomial[q-1,l] *
                            OPEPole[l][ ABC[[q-l]]] ,
                            {l,Max[1,q-maxAB], Min[q-1, maxABC]}
                        ]
                    ],
                    {q,maxq,1,-1}
                ]
            ]
       ]
)
(*RedefineOPECompositeHelpRQ[]*)


(* ::Text::Closed:: *)
(*Composite at the left*)


(* ::Input::Initialization:: *)

 (* OPE[NO[A,B],C] *)
ClearOPECompositeHelpLQ[] := (OPECompositeHelpLQ[A_,B_,C_] =.)

RedefineOPECompositeHelpLQ[] := (
    OPECompositeHelpLQ[A_,B_,C_] :=
          Block[{AC, BC, q,l,sign = SwapSign[A,B], BAC,
                 maxAC, maxBC, maxBAC, maxq, derB},
            AC = OPE[A,C];
            BC = If[ SameQ[A,B], AC, OPE[B,C]];
            maxAC = MaxPole[AC]; maxBC = MaxPole[BC];
            BAC = Table[
                      OPE[B, opepole[q][AC]],
                      {q,maxAC}
                  ];
            (* derB[l] = Derivative[l][B] *)
            derB[0] = B;
            derB[l_] := derB[l] = PoleSimplify[derB[l-1]', Together];
            OPESimplify[
            ( OPEData[
                    Table[
                        Sum[ NO[Derivative[l][A],
                                opepole[l+q][BC]] / l!,
                            {l,0, maxBC-q}
                        ],
                        {q,maxBC,1,-1}
                    ]
                ]
            )  +
            (   OPEData[sign *
                    Table[
                        Sum[ NO[derB[l], opepole[l+q][AC]] / l!,
                            {l,0, maxAC-q}
                        ],
                        {q,maxAC,1,-1}
                    ]
                ]
            )  +
            (
                (* change 6-4-92
                   maxBAC = Max[MaxPole /@ BAC];
                   maxq = Max[maxBAC + maxAC, 0];
                *)
                maxBAC = MaxPole /@ BAC;
                (* Special case : maxAC==0,
                 * then Max[maxBAC]==-Infinity. However,
                 * Sum[i,{i,1,-Infinity}] does not evaluate to 0 as expected.
                 * So we need the Max[...,0].
                 *)
                maxq = Max[maxBAC + Range[maxAC], 0];
                maxBAC = Max[maxBAC, 0];
                OPEData[sign*
                    Table[
                        Sum[ OPEPole[l][ BAC[[q-l]]] ,
                            {l,Max[1,q-maxAC], Min[q-1, maxBAC]}
                        ],
                        {q,maxq,1,-1}
                    ]
                ]
            ), Together]
       ]
)
(*RedefineOPECompositeHelpLQ[]*)


(* ::Subsubsection::Closed:: *)
(*auxiliary functions Poisson bracket case*)


(* ::Text::Closed:: *)
(*Composite at the right*)


(* ::Input::Initialization:: *)

 (* OPE[A,NO[B,C]] *)
ClearOPECompositeHelpRPB[] := (OPECompositeHelpRPB[A_,B_,C_] =.)

RedefineOPECompositeHelpRPB[] := (
    OPECompositeHelpRPB[A_,B_,C_] :=
        Block[{q,l,sign = SwapSign[A,B], AB, AC, maxAB},
            AB = OPE[A,B];
            AC = If[ SameQ[B,C], AB, OPE[A,C]];
            OPEData[
                Table[
                    PoleSimplify[
                        sign * NO[B,OPEPole[q][AC]] +
                        NO[OPEPole[q][AB],C]
                    ],
                    {q,Max[MaxPole[AB], MaxPole[AC]],1,-1}
                ]
            ]
       ]
)
(*RedefineOPECompositeHelpRPB[]*)


(* ::Text::Closed:: *)
(*Composite at the left*)


(* ::Input::Initialization:: *)

 (* OPE[NO[A,B],C] *)
ClearOPECompositeHelpLPB[] := (OPECompositeHelpLPB[A_,B_,C_] =.)

RedefineOPECompositeHelpLPB[] := (
    OPECompositeHelpLPB[A_,B_,C_] :=
          Block[{AC, BC, q,l,sign = SwapSign[A,B], BAC,
                 maxAC, maxBC, maxq, derB},
            AC = OPE[A,C];
            BC = If[ SameQ[A,B], AC, OPE[B,C]];
            maxAC = MaxPole[AC]; maxBC = MaxPole[BC];
            (* derB[l] = Derivative[l][B] *)
            derB[0] = B;
            derB[l_] := derB[l] = PoleSimplify[derB[l-1]', Together];
            OPESimplify[
            ( OPEData[
                    Table[
                        Sum[ NO[Derivative[l][A],
                                opepole[l+q][BC]] / l!,
                            {l,0, maxBC-q}
                        ],
                        {q,maxBC,1,-1}
                    ]
                ]
            )  +
            (   OPEData[sign *
                    Table[
                        Sum[ NO[derB[l], opepole[l+q][AC]] / l!,
                            {l,0, maxAC-q}
                        ],
                        {q,maxAC,1,-1}
                    ]
                ]
            ), Together]
       ]
)
(*RedefineOPECompositeHelpLPB[]*)


(* ::Subsection::Closed:: *)
(*OPEPole*)


(* ::Subsubsection::Closed:: *)
(*Clear values*)


(* ::Input::Initialization:: *)
 (*************************** OPEPole ******************************)
Clear[OPEPole,OPEPoleHelpR,OPEPoleHelpL]
OPEPoleHelpL::trace = "`1`";
OPEPoleHelpR::trace = "`1`";


(* ::Subsubsection::Closed:: *)
(*OPEPole rules*)


(* ::Input::Initialization:: *)
 (* 11-06-93 (3.0 beta 10) added following rule *)
Literal[OPEPole[_][___,0,___]] = 0;

 (* change 25-9-92 *)
 (*
OPEPole[n_Integer][A_OPEData] :=
        If [1 <= n <= Length[A[[1]]],
             A[[1, Length[A[[1]]]+1-n]],
             0
        ]
*)
OPEPole[n_Integer][OPEData[A_List]] :=
        If [1 <= n <= Length[A],
             A[[-n]],
             0
        ]

 (* opepole introduced 6-6-93 (3.0 beta 11) *)
opepole[n_Integer][OPEData[A_List]] :=
        If [1 <= n <= Length[A],
             A[[-n]],
             Message[opepole::range,n,OPEData[A]];0
        ]
opepole::range = "WARNING : pole `1` out of range in `2`";

If[ !NumberQ[$VersionNumber] || $VersionNumber < 2.0,
    (* bug in old versions : OPEData[{a}] - OPEData[{a}] -> 0 *)
    OPEPole[_][0] = 0;
    opepole[_][0] = 0
]
(* classical ??? *)
Literal[OPEPole[0][A_,B_]] := NO[A,B]
Literal[OPEPole[i_][A_,B_]] := 1/(-i)! NO[Derivative[-i][A],B] /; i<0

 (* Linear *)
If[!NumberQ[$VersionNumber],
    (* other implementation : Distribute doesn't want OPEPole[i] as
       fifth argument.
    *)
    Literal[OPEPole[i_][a___,b_Plus,c___]]:=
        Distribute[
            Lineartmp[a,b,c]
        ] /. Lineartmp -> OPEPole[i],
    Literal[OPEPole[i_][a___,b_+c_,d___]] :=
        OPEPole[i][a,b,d] + OPEPole[i][a,c,d]
]
Literal[OPEPole[i_][A___,B_ s_,C___]] :=
        s OPEPole[i][A,B,C] /; OperatorQ[B]
 (* 08-11-92 (3.0 beta 6)
Literal[OPEPole[i_][Derivative[j_][A_],B_]] :=
        If[ i>j,
                Block[{l}, Product[-l,{l,i-j,i-1}]] *
                OPEPole[i-j][A,B],
                0
        ]
*)
Literal[OPEPole[i_Integer][Derivative[j_Integer][A_],B_]] :=
        If[ i>j,
                Pochhammer[1-i,j] * OPEPole[i-j][A,B],
                0
        ]
 (* 12-06-93 (3.0 beta 10)
Literal[OPEPole[1][A_,Derivative[j_][B_]]] :=
        (OPEPole[1][A,Derivative[j-1][B]]') /; j>0
Literal[OPEPole[i_][A_,Derivative[j_][B_]]] :=
        (i-1)OPEPole[i-1][A,Derivative[j-1][B]] +
        (OPEPole[i][A,Derivative[j-1][B]]') /; j>0
 *)
Literal[OPEPole[j_Integer][A_, Derivative[i_Integer][B_]]] :=
        Block[{k},
                Sum[Pochhammer[j-k,k] Binomial[i,k]*
                                Derivative[i-k][OPEPole[j-k][A,B]],
                        {k, 0, Min[i,j-1]}
                ]
        ] /; i>0

Literal[OPEPole[i_Integer][A_,NO[B_,C_]]] :=
        OPEPoleHelpR[A,B,C,i]

Literal[OPEPole[i_Integer][NO[A_,B_],C_]] :=
        OPEPoleHelpL[A,B,C,i]

 (* 7-07-93 (3.0 beta 11) added following rule.*)
Literal[OPEPole[i_Integer][B_,A_]] :=
        OPEPoleCommuteHelp[i][B,A] /; OPEOrder[A,B]>0

Literal[OPEPole[i_Integer][A_,C_]] :=
        OPEPole[i][OPE[A,C]]



(* ::Subsubsection::Closed:: *)
(*common auxiliary functions*)


(* ::Input::Initialization:: *)
OPEPoleCommuteHelp[q_][B_,A_] :=
    Block[{l,AB = OPE[A,B], sign = SwapSign[A,B]},
         Sum[sign (-1)^l/(l-q)! Derivative[l-q][opepole[l][AB]],
             {l,q,MaxPole[AB]}
         ]
    ]


(* ::Subsubsection::Closed:: *)
(*auxiliary functions quantum case*)


(* ::Input::Initialization:: *)
 (* 11-06-93 (3.0 beta 10) added following rule.
    This one turns out to be more efficicient as the ordinary
    rule which follows in the case that B "<" A, i.e.
    OPE[B,A] is known.
    Note that in principle one could expect that this rule
    should be applied also when B == Derivative[_][A].
    (This is not checked because OPEOrder for Derivative is not
    defined).
    However, the small difference in timing in some examples
    turns out to be in favor of ignoring this case.
  *)
OPEPoleHelpRQ[A_,B_,C_,q_]:=
    Block[{BA, l,sign = SwapSign[A,B], maxBA},
        BA = OPE[B,A];
        maxBA = MaxPole[BA];
        PoleSimplify[
            sign * NO[B, OPEPole[q][A,C]] + sign*
            Sum[(-1)^l *
                OPEPole[q-l][ opepole[l][BA], C ],
                {l,maxBA}
            ]
        ]
    ]/; SameQ[Head[A],NO] || OPEOrder[A,B]<0

OPEPoleHelpRQ[A_,B_,C_,q_]:=
    Block[{AB, l,sign = SwapSign[A,B], maxAB},
        AB = OPE[A,B];
        maxAB = MaxPole[AB];
        PoleSimplify[
            sign * NO[B, OPEPole[q][A,C]] +
            NO[OPEPole[q][AB],C] +
            Sum[Binomial[q-1,l] *
                OPEPole[l][ opepole[q-l][AB], C ],
                {l,Max[1,q-maxAB], q-1}
            ]
        ]
    ]

OPEPoleHelpLQ[A_,B_,C_,q_] :=
      Block[{AC, BC, l,sign = SwapSign[A,B],
             maxAC, maxBC},
        AC = OPE[A,C];
        BC = If[ SameQ[A,B], AC, OPE[B,C]];
        maxAC = MaxPole[AC]; maxBC = MaxPole[BC];
        PoleSimplify[
            (   Sum[
                    NO[Derivative[l][A],
                       opepole[l+q][BC]] /l!,
                    {l,0, maxBC-q}
                ]
            )  +
            (   sign * Sum[
                    NO[Derivative[l][B],
                       opepole[l+q][AC]] /l!,
                    {l,0, maxAC-q}
                ]
            )  +
            (    sign*
                   Sum[ OPEPole[l][ B, opepole[q-l][AC] ],
                       {l,Max[1,q-maxAC], q-1}
                   ]
            )
        ]
    ]


(* ::Subsubsection::Closed:: *)
(*auxiliary functions Poisson bracket case*)


(* ::Input::Initialization:: *)
(* classical ???
OPEPoleHelpRPB[A_,B_,C_,q_]:=
    Block[{BA, l,sign = SwapSign[A,B], maxBA},
        BA = OPE[B,A];
        maxBA = MaxPole[BA];
        PoleSimplify[
            sign * NO[B, OPEPole[q][A,C]] + sign*
            Sum[(-1)^l *
                OPEPole[q-l][ opepole[l][BA], C ],
                {l,maxBA}
            ]
        ]
    ]/; SameQ[Head[A],NO] || OPEOrder[A,B]<0
*)
OPEPoleHelpRPB[A_,B_,C_,q_]:=
    PoleSimplify[
            SwapSign[A,B] * NO[B, OPEPole[q][A,C]] +
            NO[OPEPole[q][A,B],C] 
    ]

OPEPoleHelpLPB[A_,B_,C_,q_] :=
      Block[{AC, BC, l,sign = SwapSign[A,B],
             maxAC, maxBC},
        AC = OPE[A,C];
        BC = If[ SameQ[A,B], AC, OPE[B,C]];
        maxAC = MaxPole[AC]; maxBC = MaxPole[BC];
        PoleSimplify[
            (   Sum[
                    NO[Derivative[l][A],
                       opepole[l+q][BC]] /l!,
                    {l,0, maxBC-q}
                ]
            )  +
            (   sign * Sum[
                    NO[Derivative[l][B],
                       opepole[l+q][AC]] /l!,
                    {l,0, maxAC-q}
                ]
            ) 
        ]
    ]


(* ::Subsection::Closed:: *)
(*NO handling*)


(* ::Subsubsection::Closed:: *)
(*Clear values*)


(* ::Input::Initialization:: *)
 (*********************** normal ordering **************************)

Clear[NO,NOCommuteHelp,NOCompositeHelpR,NOCompositeHelpL,
      NODerivativeHelp, NOOrder,NOOrderHelp,NOOrderHelp2]
NOCompositeHelpL::trace = "`1`"
NOCompositeHelpR::trace = "`1`"
NOCommuteHelp::trace = "`1`"



(* ::Subsubsection::Closed:: *)
(*Relation with Operators*)


(* ::Input::Initialization:: *)
OperatorQ[_NO]=True
Literal[BosonQ[NO[A_,B_]]]:= !Xor[BosonQ[A],BosonQ[B]]
Literal[OPEParity[NO[A_,B_]]]:= OPEParity[A] + OPEParity[B]

 (* NOOrder is the same as OPEOrder, except that derivatives
  * (which can not occur as argument of OPEOrder) are ignored.
  * Only in the case of comparing derivatives of the same operator.
  * Then higher derivatives come after lower if NOOrderingValue > 0.
  *)
NOOrderHelp[Derivative[_][A_],B_] := NOOrderHelp[A,B]
(* change 21-07-94: 3.1 beta 1, 
   rhs of the next definition was NOOrderHelp[A,B], which necessarily 
   amounts to the current rhs
 *)
NOOrderHelp[A_,Derivative[_][B_]] := OPEOrder[A,B]
NOOrderHelp[A_,B_] := OPEOrder[A,B]

NOOrder[A_,B_] :=
    Block[{res = NOOrderHelp[A,B]},
        If[res == 0,
           NOOrderingValue * (NOOrderHelp2[B]-NOOrderHelp2[A]),
           res]
    ]
NOOrderHelp2[Derivative[i_][_]] := i
NOOrderHelp2[_] = 0;


(* ::Subsubsection::Closed:: *)
(*NO rules*)


(* ::Input::Initialization:: *)
Literal[NO[A_,B_,C__]] := NO[A,NO[B,C]]

Literal[NO[0,_]] = 0;
Literal[NO[_,0]] = 0;

 (* Linear *)
If[NumberQ[$VersionNumber],
    Literal[NO[a___,b_Plus,c___]]:=
        Distribute[
            Lineartmp[a,b,c],
            Plus,Lineartmp,
            Plus,NO
        ],
    Literal[NO[a___,b_+c_,d___]] :=
        NO[a,b,d] + NO[a,c,d]
]

Literal[NO[A___,B_ s_,C___]] := s NO[A,B,C] /; OperatorQ[B]


 (* 08-11-92 3.0 beta 7
  * Use If statements instead of relying on NOOrder[_,_NO]=1. This
  * is safer, more clear, and skips an additional evaluation of NOOrder.
  *)
Literal[NO[NO[A_,B_],NO[C_,D_]]] :=
        If[NOOrder[A,C]<=0,
           CallAndSave[NOCompositeHelpR,NO[A,B],C,D] (* -> {C,{{A,B},D}}*),
           CallAndSave[NOCompositeHelpL,A,B,NO[C,D]] (* -> {A,{B,{C,D}}}*)
        ]

Literal[NO[NO[A_,B_],C_]] :=
        If[NOOrder[A,C]>0,
           CallAndSave[NOCompositeHelpL,A,B,C]       (* -> {A,{B,C}}*),
           SwapSign[C,NO[A,B]] (NO[C,NO[A,B]] - NOCommuteHelp[C,NO[A,B]])
        ]

Literal[NO[B_,NO[A_,C_]]] :=
        CallAndSave[NOCompositeHelpR,B,A,C] /;
        NOOrder[A,B]>0

 (* Special case: A=B fermionic *)
Literal[NO[A_,NO[A_,C_]]] := 1/2 NO[NOCommuteHelp[A,A],C] /;
        !BosonQ[A]

 (* Fermionic case :
    NO[B,A] = -NO[A,B] + NOCommuteHelp[A,B]
    Replacing B with A, we get the following rule
 *)
Literal[NO[A_,A_]] :=
        NOCommuteHelp[A,A]/2 /; !BosonQ[A]

Literal[NO[B_,A_]] :=
        SwapSign[A,B] (NO[A,B] - NOCommuteHelp[A,B]) /;
        !SameQ[Head[A],NO] && NOOrder[A,B]>0
 (* Rewrite NO[A,B]' in terms of NO[A,B'] + ...*)
NO /: Literal[Derivative[i_Integer][NO[A_,B_]]] :=
        NODerivativeHelp[i,A,B] /; i>0



(* ::Subsubsection::Closed:: *)
(*common auxiliary functions*)


(* ::Input::Initialization:: *)
NODerivativeHelp[i_,A_,B_] := Block[{j},
    PoleSimplify[
        Sum[Binomial[i,j] *
            NO[Derivative[j][A],Derivative[i-j][B]],
          {j,0,i}
        ]
    ]
]


(* ::Subsubsection::Closed:: *)
(*auxiliary functions quantum case*)


(* ::Text::Closed:: *)
(*Commutation*)


(* ::Input::Initialization:: *)
 (* definition:
  * NOCommuteHelp[A,B] = NO[A,B]-SwapSign[A,B] NO[B,A]
  * see for actual computation comment on OPECommuteHelp
  *)
 (* change 6-6-93 (3.0 beta 11) : remove fac and substitute with m!*)
NOCommuteHelpQ[A_,B_] :=
    PoleSimplify[
        Block[{m,AB=OPE[A,B](*, fac=-1*)},
            Sum[(* (fac *= -1/m) * *)
                   -(-1)^m /m! Derivative[m][opepole[m][AB]],
                {m,MaxPole[AB]}
            ]
        ]
    ]


(* ::Text::Closed:: *)
(*Composites*)


(* ::Input::Initialization:: *)

 (* NO[B, NO[A,C]] = (-) NO[A,NO[B,C]] +
  *                  NO[NO[B,A] - (-)NO[A,B], C]
  *)
ClearNOCompositeHelpRQ[] := (NOCompositeHelpRQ[B_,A_,C_] =.)

RedefineNOCompositeHelpRQ[] := (
    NOCompositeHelpRQ[B_,A_,C_] :=
            PoleSimplify[
                SwapSign[A,B] NO[A, NO[B, C]] +
                NO[NOCommuteHelpQ[B, A], C]
            ]
)
(*RedefineNOCompositeHelpRQ[]*)

 (* NO[NO[A, B], C] *)
ClearNOCompositeHelpLQ[] := (NOCompositeHelpLQ[A_,B_,C_] =.)

RedefineNOCompositeHelpLQ[] := (
NOCompositeHelpLQ[A_,B_,C_] :=
    Block[{AC, BC, l,sign = SwapSign[A,B],
             maxAC, maxBC, maxl},
        AC = OPE[A,C];
        BC = If[ SameQ[A,B], AC, OPE[B,C]];
        maxAC = MaxPole[AC]; maxBC = MaxPole[BC];
        PoleSimplify[
            NO[A,NO[B,C]] +
            Sum[ NO[Derivative[l][A], opepole[l][BC]] /l!,
                {l,1, maxBC}
            ] +
            Sum[ sign * NO[Derivative[l][B], opepole[l][AC]] /l!,
                {l,1, maxAC}
            ]
        ]
    ]
)
(*RedefineNOCompositeHelpLQ[]*)


(* ::Subsubsection::Closed:: *)
(*auxiliary functions Poisson bracket case*)


(* ::Input::Initialization:: *)

NOCommuteHelpPB[A_,B_] = 0;

 (* NO[A, NO[B, C]] *)
ClearNOCompositeHelpRPB[] := (NOCompositeHelpRPB[B_,A_,C_] =.)

RedefineNOCompositeHelpRPB[] := (
    NOCompositeHelpRPB[B_,A_,C_] := SwapSign[A,B] NO[A,NO[B,C]]
)
(*RedefineNOCompositeHelpRPB[]*)

 (* NO[NO[A, B], C] *)
ClearNOCompositeHelpLPB[] := (NOCompositeHelpLPB[A_,B_,C_] =.)

RedefineNOCompositeHelpLPB[] := (
NOCompositeHelpLPB[A_,B_,C_] := NO[A,NO[B,C]]
)
(*RedefineNOCompositeHelpLPB[]*)


(* ::Subsection::Closed:: *)
(*OPEJacobi*)


(* ::Input::Initialization:: *)
Options[OPEJacobi] = {Function -> Expand};

OPEJacobi[A_,B_,C_,opts___Rule] :=
    Block[{AB, AC, BC,
          AnBC, BnAC, ABnC, m,n,p,
          sign = (-1)^( OPEParity[A] OPEParity[B] ),
          maxAB, maxAC, maxBC, maxAnBC, maxBnAC, maxABnC,
          maxn, maxm,
          simopts= Function -> 
              (Function /. {opts} /. Options[OPEJacobi])},
        AB = OPESimplify[OPE[A,B], simopts];
        BC = OPESimplify[OPE[B,C], simopts];
        maxAB = MaxPole[AB];
        maxBC = MaxPole[BC];
        AnBC[n_] := (AnBC[n]=OPESimplify[OPE[A, OPEPole[n][BC]], simopts])/;n<=maxBC;
        ABnC[n_] := (ABnC[n]=OPESimplify[OPE[OPEPole[n][AB], C], simopts])/;n<=maxAB;
        AnBC[_] = ABnC[_] = OPEData[{}];
        If[SameQ[A,B],
	        BnAC=AnBC; AC=BC; maxAC=maxBC;
     	, (*else*)
	        AC= OPESimplify[OPE[A,C], simopts];
	        maxAC = MaxPole[AC];
                BnAC[n_] := (BnAC[n]=OPESimplify[OPE[B, OPEPole[n][AC]], simopts])/;n<=maxAC;
                BnAC[__] = OPEData[{}];
        ];
        maxAnBC = Max[MaxPole /@ Table[AnBC[n],{n,maxBC}]];
        maxBnAC = Max[MaxPole /@ Table[BnAC[n],{n,maxAC}]];
        maxABnC = Max[MaxPole /@ Table[ABnC[n],{n,maxAB}]];
        maxn = Max[ maxAnBC, maxAC, maxAB ];
        maxm = Max[ maxBC, maxBnAC, maxABnC ];
	    Table[ PoleSimplify[
            OPEPole[n][AnBC[m]] -
             sign OPEPole[m][BnAC[n]] -
             Sum[ Binomial[n-1,p-1] OPEPole[m+n-p][ABnC[p]],
                {p,1,n}
             ], simopts]
            ,{m, maxm},{n,maxn}
        ]
]


(* ::Subsection::Closed:: *)
(*The operator One*)


(* ::Input::Initialization:: *)
 (*********************** DefineConstantOperator *******************)
DefineConstantOperator[op_Symbol] := (
    Derivative[n_][op] ^:= 0 /; n>0;
    Bosonic[op];
    Literal[OPE[_,op]] ^:= OPEData[{}];
    Literal[OPE[op,_]] ^:= OPEData[{}];
    Literal[NO[A_,op]] ^:= A;
    Literal[NO[op,A_]] ^:= A;
)
Clear[One]
DefineConstantOperator[One]


(* ::Subsection::Closed:: *)
(*Saving of intermediate results*)


(* ::Input::Initialization:: *)
ClearOPESavedValues[] := (
    Clear[
	OPECompositeHelpRQ,OPECompositeHelpLQ,
	NOCompositeHelpRQ,NOCompositeHelpLQ,
	OPECompositeHelpRPB,OPECompositeHelpLPB,
	NOCompositeHelpRPB,NOCompositeHelpLPB];
    RedefineOPECompositeHelpRQ[];
    RedefineOPECompositeHelpLQ[];
    RedefineNOCompositeHelpRQ[];
    RedefineNOCompositeHelpLQ[];
    RedefineOPECompositeHelpRPB[];
    RedefineOPECompositeHelpLPB[];
    RedefineNOCompositeHelpRPB[];
    RedefineNOCompositeHelpLPB[];
)
ClearOPESavedValues[]


(* ::Input::Initialization:: *)
 (*************************** Saving  *******************************)
OPESave[name_String] := (
    If[ !NumberQ[$VersionNumber] || $VersionNumber < 2.0, Off[Unset::norep]];
    ClearOPECompositeHelpR[];
    ClearOPECompositeHelpL[];
    ClearNOCompositeHelpR[];
    ClearNOCompositeHelpL[];
    If[ !NumberQ[$VersionNumber] || $VersionNumber < 2.0, On[Unset::norep]];
    Put[ Definition[
            NOOrderingValue,
            OPECompositeHelpR, OPECompositeHelpL,
            NOCompositeHelpR, NOCompositeHelpL
         ],
         name];
    RedefineOPECompositeHelpR[];
    RedefineOPECompositeHelpL[];
    RedefineNOCompositeHelpR[];
    RedefineNOCompositeHelpL[]
)



(* ::Subsection::Closed:: *)
(*Global options*)


(* ::Input::Initialization:: *)
SetAttributes[SetOPEOptions, HoldRest]


(* ::Input::Initialization:: *)
 (* 21-07-94 (3.1 beta 1) changed definition of CallAndSave according
    to which option is set for OPESaving. Previously, all cases where
    handled through the last of the 3 definitions which follow.
    The first two are shortcuts for faster respons.
  *)
SetOPEOptions[OPESaving, True] :=
    ( Clear[CallAndSave]; CallAndSave[f_, arg__] := (f[arg] = f[arg]) )
SetOPEOptions[OPESaving, False] :=
    ( Clear[CallAndSave]; CallAndSave[f_, arg__] := f[arg] )
SetOPEOptions[OPESaving, expr_] :=
    If[!SameQ[expr,True] && !SameQ[expr, False],
        Message[OPESaving::nobool, HoldForm[expr]],
        (* else *)
        Clear[CallAndSave];
        CallAndSave[f_, arg__] :=
           If[ expr, f[arg] = f[arg], f[arg]]
    ]
OPESaving::nobool =
    "Error : `` is not an expression that evaluates to a boolean value.
OPESaving not changed.";

(*default*)
SetOPEOptions[OPESaving, True]


(* ::Input::Initialization:: *)

SetOPEOptions[NOOrdering, n_Integer]  := (NOOrderingValue = n)
(*default*)
SetOPEOptions[NOOrdering, -1]

SetOPEOptions[SeriesArguments, {arg1_, arg2_}] := (
    DefaultArgument1 = arg1;
    DefaultArgument2 = arg2;
)
(*default*)
SetOPEOptions[SeriesArguments, {Global`z,Global`w}]


(* ::Input::Initialization:: *)
SetOPEOptions[ParityMethod,0] :=
    (Message[ParityMethod::warning];
     SwapSign[A_,B_] := If[BosonQ[A] || BosonQ[B],1,-1];
     SwapSign[A_] := If[BosonQ[A],1,-1])
SetOPEOptions[ParityMethod,1] :=
    (SwapSign[A_,B_] := (-1)^(OPEParity[A] OPEParity[B]);
     SwapSign[A_] := (-1)^OPEParity[A])
ParityMethod::warning = "Warning : wrong results will occur if you use operators
which are declared with OPEOperator with a symbolic parity."

(*default SetOPEOptions[ParityMethod,0] is not called because of the message.*)
SwapSign[A_,B_] := If[BosonQ[A] || BosonQ[B],1,-1]
SwapSign[A_] := If[BosonQ[A],1,-1]


(* ::Input::Initialization:: *)
SetOPEOptions[OPEMethod, QuantumOPEs] :=
    (If[Length[OperatorList]>1, 
        Message[OPEMethod::clearvalues]; ClearOPESavedValues[]];
     setQuantum[])
SetOPEOptions[OPEMethod, ClassicalOPEs] :=
    (If[Length[OperatorList]>1, 
        Message[OPEMethod::clearvalues]; ClearOPESavedValues[]];
    setPB[])
OPEMethod::clearvalues = 
    "Clearing the values stored for intermediate results."

setQuantum[] := (
    ClearOPECompositeHelpR=ClearOPECompositeHelpRQ;
    ClearOPECompositeHelpL=ClearOPECompositeHelpLQ;
    ClearNOCompositeHelpR=ClearNOCompositeHelpRQ;
    ClearNOCompositeHelpL=ClearNOCompositeHelpLQ;
    RedefineOPECompositeHelpR=RedefineOPECompositeHelpRQ;
    RedefineOPECompositeHelpL=RedefineOPECompositeHelpLQ;
    RedefineNOCompositeHelpR=RedefineNOCompositeHelpRQ;
    RedefineNOCompositeHelpL=RedefineNOCompositeHelpLQ;
    NOCommuteHelp=NOCommuteHelpQ;
    OPEPoleHelpL=OPEPoleHelpLQ;
    OPEPoleHelpR=OPEPoleHelpRQ;
    OPECompositeHelpR=OPECompositeHelpRQ;
    OPECompositeHelpL=OPECompositeHelpLQ;
    NOCompositeHelpR=NOCompositeHelpRQ;
    NOCompositeHelpL=NOCompositeHelpLQ;
)

setPB[] := (
    ClearOPECompositeHelpR=ClearOPECompositeHelpRPB;
    ClearOPECompositeHelpL=ClearOPECompositeHelpLPB;
    ClearNOCompositeHelpR=ClearNOCompositeHelpRPB;
    ClearNOCompositeHelpL=ClearNOCompositeHelpLPB;
    RedefineOPECompositeHelpR=RedefineOPECompositeHelpRPB;
    RedefineOPECompositeHelpL=RedefineOPECompositeHelpLPB;
    RedefineNOCompositeHelpR=RedefineNOCompositeHelpRPB;
    RedefineNOCompositeHelpL=RedefineNOCompositeHelpLPB;
    NOCommuteHelp=NOCommuteHelpPB;
    OPEPoleHelpL=OPEPoleHelpLPB;
    OPEPoleHelpR=OPEPoleHelpRPB;
    OPECompositeHelpR=OPECompositeHelpRPB;
    OPECompositeHelpL=OPECompositeHelpLPB;
    NOCompositeHelpR=NOCompositeHelpRPB;
    NOCompositeHelpL=NOCompositeHelpLPB;
)

(*default*)
(*SetOPEOptions[OPEMethod, ClassicalOPEs]*)
SetOPEOptions[OPEMethod, QuantumOPEs]


(* ::Input::Initialization::RGBColor[0., 0., 0.]::Plain:: *)
(* change 3.1 beta 4: added DummiesLoaded *)
SetOPEOptions[EnableDummies,True] :=
(   Needs["Dummies`"];
    Dummies`Renumber[expr_OPEData, arg_] := 
        OPEMap[Dummies`Renumber[#,arg]&, expr];
    Dummies`NewDummies[expr_OPEData, arg_] := 
        OPEMap[Dummies`NewDummies[#,arg]&, expr];
    Dummies`DummySimplify[expr_OPEData, arg_] := 
        OPEMap[Dummies`DummySimplify[#,arg]&, expr];
    Dummies`SumDummy[expr_OPEData, arg__] := 
        OPEMap[Dummies`SumDummy[#,arg]&, expr];
    Dummies`SetDummiesOptions[Dummies`FunctionPattern, NO];
    SetOPEOptions[OPESaving,False];
    Message[SetOPEOptions::Dummies];
    Dummies`ResetDummies[]
)

SetOPEOptions::Dummies = "OPESaving switched off. Keep it off while doing
calculations with dummy indices.";


(* ::Input::Initialization:: *)
Protect[OPESaving, NOOrdering, SeriesArguments, ParityMethod, 
  OPEMethod, EnableDummies];

SetOPEOptions[op_, val_] := Message[SetOPEOptions::novalopt,op,val]
SetOPEOptions::novalopt =
    "Error : option `` with value `` not a valid combination.";


(* ::Subsection::Closed:: *)
(*Output routines*)


(* ::Input::Initialization:: *)
Clear[formatstring]

 (* formatstring[n_,start_] makes a formatstring like
         "start|| `` ||start-1|| `` ... `` ||start-n+1|| ``"
    There are n ``'s to plug in n items.
 *)
formatstring[0,_] = " "
formatstring[start_, n_] := formatstring[start, n] =
    Block[{i},
        StringJoin[
             ToString[start],
             "|| ``",
             Sequence  @@ Flatten[
                 Table[{" ||",ToString[start+1-i],"|| ``"},{i,2,n}]
             ]
        ]
    ]

Format[OPEData[{a___}]] :=
    StringForm[
        StringJoin["<< ", formatstring[Length[{a}], Length[{a}]], " >>"],
        a
    ]

 (* 09/09/92
    OPEData written to file will now be in appropriate MakeOPE form.
    Note : using HoldForm leads to infinite recursion,
           SequenceForm works nice, but OutputForm of the strings is needed
           to discard the quotes in the output.
 *)
Format[OPEData[A_List],InputForm] :=
        SequenceForm[ OutputForm["MakeOPE["], A, OutputForm["]"] ]

Format[OPEData[A_List], TeXForm] := OPEToSeries[OPEData[A]]

Literal[ OPEToSeries[OPEData[A_List]] ] :=
        OPEToSeries[OPEData[A], {DefaultArgument1,DefaultArgument2}]
Literal[ OPEToSeries[OPEData[A_List], {z1_, z2_}] ] :=
( SeriesData[
        z1,z2,
        #[z2]& /@ A,
        -Length[A], 0, 1
    ]
    //. {(f_ +  g_) [x_] :> f[x] + g[x],
         (f_ *  g_) [x_] :> f * g[x] /; OperatorQ[g],
         0[_] -> 0}
)


(* ::Subsection::Closed:: *)
(*Obsolete functions (SMap, Term, StripArg)*)


(* ::Input::Initialization:: *)
SMap = OPEMap
Term[A_OPEData,n_] := OPEPole[-n][A]

 (*************************** StripArg *****************************)
Clear[StripArg]
StripArg[a_Plus] := StripArg /@ a
StripArg[a_Times] := StripArg /@ a
StripArg[a_] := If[ OperatorQ[Head[a]], Head[a], a]

 (* old version, faster but incorrect for things like StripArg[J[z[1]]]

  StripArg[a_] := Map[StripArgHelp,a,{-2}]
  StripArgHelp[a_]:=Head[a] /;OperatorQ[Head[a]]
  StripArgHelp[a_]:=a
*)



(* ::Input::Initialization:: *)
End[];


(* ::Input::Initialization:: *)
EndPackage[]
