(*^

::[	frontEndVersion = "Microsoft Windows Mathematica Notebook Front End Version 2.2";
	microsoftWindowsStandardFontEncoding;
	fontset = title, "Arial", 24, L0, center, nohscroll, bold;
	fontset = subtitle, "Arial", 18, L0, center, nohscroll, bold;
	fontset = subsubtitle, "Arial", 14, L0, center, nohscroll, bold;
	fontset = section, "Arial", 14, L0, bold, grayBox;
	fontset = subsection, "Arial", 12, L0, bold, blackBox;
	fontset = subsubsection, "Arial", 10, L0, bold, whiteBox;
	fontset = text, "Arial", 12, L0;
	fontset = smalltext, "Arial", 10, L0;
	fontset = input, "Courier New", 11, L0, nowordwrap;
	fontset = output, "Courier New", 11, L0, nowordwrap;
	fontset = message, "Courier New", 10, L0, nowordwrap, R65535;
	fontset = print, "Courier New", 10, L0, nowordwrap;
	fontset = info, "Courier New", 10, L0, nowordwrap;
	fontset = postscript, "Courier New", 8, L0, nowordwrap;
	fontset = name, "Arial", 10, L0, nohscroll, italic, B65535;
	fontset = header, "Times New Roman", 10, L0, right, nohscroll;
	fontset = footer, "Times New Roman", 10, L0, right, nohscroll;
	fontset = help, "Arial", 10, L0, nohscroll;
	fontset = clipboard, "Arial", 12, L0, nohscroll;
	fontset = completions, "Arial", 12, L0, nowordwrap, nohscroll;
	fontset = graphics, "Courier New", 10, L0, nowordwrap, nohscroll;
	fontset = special1, "Arial", 12, L0, nowordwrap, nohscroll;
	fontset = special2, "Arial", 12, L0, center, nowordwrap, nohscroll;
	fontset = special3, "Arial", 12, L0, right, nowordwrap, nohscroll;
	fontset = special4, "Arial", 12, L0, nowordwrap, nohscroll;
	fontset = special5, "Arial", 12, L0, nowordwrap, nohscroll;
	fontset = leftheader, "Arial", 12, L0, nowordwrap, nohscroll;
	fontset = leftfooter, "Arial", 12, L0, nowordwrap, nohscroll;
	fontset = reserved1, "Courier New", 10, L0, nowordwrap, nohscroll;]
:[font = text; inactive; preserveAspect; backColorRed = 65535; backColorGreen = 65535; backColorBlue = 65535; fontColorRed = 0; fontColorGreen = 0; fontColorBlue = 0; plain; fontName = "Times New Roman"; fontSize = 12; ]
(* :Name:Delta` *)

(* :Title: 
  	Delta and Epsilon symbols
*)

(* :Author: 
     Kris Thielemans
 *)

(* :Summary:
   This package gives definitions for the Delta and Epsilon symbols.
*)

(* :Context: Delta`*) 

(* :Package Version: 1.1 *)

(* :Mathematica Version: 1.2 *)
:[font = input; initialization; nowordwrap; ]
*)
BeginPackage["Delta`"]
(*
:[font = input; initialization; nowordwrap; ]
*)
Delta::usage = "Delta[i,j] is the delta symbol."

Epsilon::usage = "Epsilon[a,b,c] defines the antisymmetric symbol (with 
any number of arguments). See also EpsilonRule."

EpsilonRule::usage = "expr /. EpsilonRule[n_Integer] to remove things 
like Epsilon[1,2,3,a]. 'n' specifies the maximum number of non-integers
for which you want to apply this.";
(*
:[font = input; initialization; startGroup; Cclosed; nowordwrap; ]
*)
Begin["Delta`Private`"];
(*
:[font = input; initialization; nowordwrap; backColorRed = 65535; backColorGreen = 65535; backColorBlue = 65535; fontColorRed = 0; fontColorGreen = 0; fontColorBlue = 0; plain; fontName = "Courier New"; fontSize = 11; ]
*)
Clear[Delta]
Delta[a_,a_] = 1
Delta[i_,j_] := 0 /; i!=j
SetAttributes[Delta,{Orderless}];
(*
:[font = input; initialization; nowordwrap; backColorRed = 65535; backColorGreen = 65535; backColorBlue = 65535; fontColorRed = 0; fontColorGreen = 0; fontColorBlue = 0; plain; fontName = "Courier New"; fontSize = 11; ]
*)
Epsilon[___,a_,___,a_,___] = 0;
Epsilon[a__] := Signature[{a}] Apply[Epsilon,Sort[{a}]] /;
        !OrderedQ[{a}]
Epsilon[x__] := 1 /; {x} == Range[Length[{x}]]
(*
:[font = input; initialization; nowordwrap; backColorRed = 65535; backColorGreen = 65535; backColorBlue = 65535; fontColorRed = 0; fontColorGreen = 0; fontColorBlue = 0; plain; fontName = "Courier New"; fontSize = 11; ]
*)
Clear[EpsilonRule]
EpsilonRule[n_] = Literal[Epsilon[ints:(_Integer).., rest:(_)..]] :>
  Block[{remlist = 
	     Permutations[
             Complement[Range[Length[{ints}]+Length[{rest}]],{ints}]
	     ]
	 },
     Apply[Plus,
	    Function[rem,
	    	Epsilon[ints,Sequence@@rem] *
             	Inner[Delta, {rest}, rem, Times]
	    ] /@ remlist
	]
  ] /; small[{ints,rest}, Length[{ints,rest}]] &&
       Length[{rest}]<=n;
(* small tests if any of the arguments is larger than the total length.
   Note: do not test on {ints} alone, otherwise the large i will be
   shifted into 'rest'.
 *)

small[l_List, n_Integer] :=
   And@@Map[ #<= n&, Select[l,IntegerQ]]
(*
:[font = input; initialization; endGroup; nowordwrap; ]
*)
End[];
(*
:[font = input; initialization; nowordwrap; ]
*)
EndPackage[]
(*
^*)