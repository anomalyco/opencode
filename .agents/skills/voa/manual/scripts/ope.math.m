(* 
Please set your own PATH-NAME where you place this package.
*)
(*+---------------------------------------------------------------------+
  |	usage;  << PATH-NAME/ope.math 					|
  |	Operator Product Expansion for Free Fields			|
  |	written by Akira Fujitsu, April 1993.				|
  |	modified 19th July 1993 (Fsort & const)				|
  |	modidied 3rd October 2003 (help is included in this file.)	|
  |	Ver2.0a 3rd October 2003 (be,ga's ope is modified.)		|
  +---------------------------------------------------------------------+*)
Unprotect[help, Texp, ope, der, res, Fsort, CO2, Current, bosonize, ps, be, 
ga, bi, ci, pj, ro, xi, vp, Jg, Jc, Jp, Tbc, Tbg, Tpj, Nl, dz, mono, OP, 
stsum, ff, vf, Vev, nega, VNl, Rope, mnega, SINGU, const, regope, REV, fEND, 
Boson, OutPut, OMC, DER, OPExp, TEXP];
(
(* help  for ope.math ver 1.0 *)
ClearAll[man,help];
Print["Type help[0] for the index of this help menu"];
help[i_]:=Print[man[i]];
man[0]="\n Index\n\n
---------------------------------------------------------------------------\n
free fields[1], vertex operator[2], local parameters[3], normal order[4]   \n
operator[5], oerator product expansion[6], Taylor expansion[7],            \n
sorting[8], derivatives[9], residue[10], bosonization[11],\n
reconstruction polynomials with coefficients[12]\n 
---------------------------------------------------------------------------\n";
man[1]="
\n  Free fields\n\n
Free fields are ps[] for Majorana fermions\n
                be[] and ga[] for complex boson pairs\n
                bi[] and ci[] for complex fermion pairs\n
                pj[] for real boson.\n
Use them as be[d,j,z] for d-th derivative, j-th be[] and at the point z.\n";
man[2]="
\n  Vertex operator\n\n
A vertex operator having charges {q1,q2,...} is represented by\n
vp[d,{q1,q2,...},z].	   \n";
man[3]="
\n  Parameters\n\n
A fermionic local parameter is  ro[]. A bosonic local one is xi[].\n";
man[4]="
\n  Normal order\n\n
Normal ordering of operators is written as  Nl[opr1,opr2,...].\n";
man[5]="
\n  Operators\n\n
Operators are represented as the polynomial\n
 a Nl[...] + b Nl[...] + ...\n";
man[6]="
\n  Operator product expansion (OPE)\n\n
The OPE of opr1[z] and opr2[w] is computed by ope[opr1[z],opr2[w]].\n
And ope[p,opr1[z],opr2[w]] represents ope[opr1[z],opr2[w]]*(z-w)^p. \n";
man[7]="
\n  Taylor expansion\n\n
Texp[p,z,w,opr[z]] gives the Taylor expansion of opr[z]*(z-w)^p at w. \n";
man[8]="
\n  Sorting\n\n
Fsort[opr[z],z] gives normally sorted expressions. \n";
man[9]="
\n  Derivative\n\n
der[i,opr[z],z] gives i-th derivative of opr. \n";
man[10]="
\n  Residue\n\n
res[i,opr1[z],opr2[w]] gives  coefficients  of the pole ( or the zero )\n
 (z-w)^i in the OPE\n
ope[opr1[z],opr2[w]].\n";
man[11]="
\n   Bosonize\n\n
Bosonize[opr[z],z] maps the operator opr[z] to the bosonized form according\n
to the bosonization rule BRule[ff[z]] which you should define.\n";
man[12]="
\n   Reconstruction polynomials with coefficients\n\n
Current[opr[z],z,coeff] gives the polynomial with coefficients named\n
 coeff[] and the operator monomials which are appearing in the polynomial\n
 opr[z].\n";
)
((*--- Main functions -----*)
		ClearAll[Texp,ope,der,res,Fsort,CO2,Current];
		ClearAll[bosonize,BRule];
 (*--- Variables for users-*)
		ClearAll[ps,be,ga,bi,ci,pj,ro,xi,vp,Jg,Jc,Jp,Tbc,Tbg,Tpj,Nl];
 (*--- Inner vriables -----*)
		ClearAll[dz,mono,Monomial,OP,stsum,ff,vf,Vev,nega,mnega,
			VNl,Zc,Wc,SINGU,const,
			OMC,Rope,OPExp,TEXP,regope,REV,fEND,Boson,OutPut,DER];
)
((*--- ope; operator product expansion ---*)
            ope[a_,b_]:=ope[0,a,b];
         ope[p_,a_,b_]:=OutPut[OPExp[p,a,b]]/.{SINGU[q_,z1_,w1_]:>(z1-w1)^q};  
		OPExp[p_,a_,b_]:=Expand[Rope[p,Nl[Expand[a]],Nl[Expand[b]]]];
		OPExp[p_,a_,0]:=0;OPExp[p_,0,b_]:=0;
	(*--- Rope; ---*)
	Rope[p_,a_,c_]:=Sum[Rope[p,a[[i]],c],{i,1,Length[a]}]/;Head[a]==Plus;
	Rope[p_,c_,a_]:=Sum[Rope[p,c,a[[i]]],{i,1,Length[a]}]/;Head[a]==Plus;
	(**)
	Rope[p_,Times[a__,Nl[b__]],Times[c__,Nl[d__]]]:=
					Times[a,c] Rope[p,Nl[b],Nl[d]];
	Rope[p_,Times[a__,Nl[b__]],Nl[d__]]:=Times[a] Rope[p,Nl[b],Nl[d]];
	Rope[p_,Nl[b__],Times[c__,Nl[d__]]]:=Times[c] Rope[p,Nl[b],Nl[d]];
	(*--- Nl; Normal order product ---*)
		Nl[a___,Nl[b__],c___]	:=Nl[a,b,c];
		Nl[a___,Nl[],c___]	:=Nl[a,c];
		Nl[a___,b_ Nl[],c___]	:=Expand[b] Nl[a,c];
		Nl[a___,0,c___]		:=0;
	Nl[a___,b_,d___]:=Sum[Nl[a,b[[i]],d],{i,1,Length[b]}]/;Head[b]==Plus;
		OMC[c_]:=TrueQ[(Head[c]==Nl|| Head[c]==ps|| Head[c]==bi|| 
		  Head[c]==ci|| Head[c]==be|| Head[c]==ga|| Head[c]==pj|| 
		  Head[c]==vp|| Head[c]==ro|| Head[c]==xi)];
		Nl[a___,Times[b__,c_],d___]:=Times[b] Nl[a,c,d]/;OMC[c];
	Nl[a___,Times[b__,c_],d___]:=Nl[a,Expand[Times[b,c]],d]/;Not[OMC[c]];
(* added on 16th, Nov. 1993 *)
		Nl[Nl[c___]]:=Nl[c];Nl[Nl[c_]]:=Nl[Expand[c]];
	(**)
		Nl[a___,bi[x__],b___,bi[x__],c___]:=0;
		Nl[a___,ci[x__],b___,ci[x__],c___]:=0;
		Nl[a___,ro[x__],b___,ro[x__],c___]:=0;
	(**)
		Nl[a___,vp[0,b_,z_],vp[0,d_,z_],c___]:=
				CO2[b,d] Nl[a,vp[0,Simplify[b+d],z],c];
	(*--- from Rope to regope ---*)
	Rope[p_,Plus[a_],Plus[b_]]:=Module[{e1,e2},
				e1=Simplify[a/.{Nl[q___]:>1}];
				e2=Simplify[b/.{Nl[q___]:>1}];
				If[e1==1&&e2==1&&
				TrueQ[Expand[a]==a]&&TrueQ[Expand[b]==b],
				If[Not[TrueQ[a[[1,3]]==b[[1,3]]]],
				regope[p,a[[1,3]],b[[1,3]],a,b],0],
				Rope[p,Expand[a],Expand[b]]]];
	(*--- regope; ---*)
	regope[p_,z_,w_,a_,b_]:=Module[{},Zc=z;Wc=w;
			Expand[Expand[Monomial[dz^p OP[a,b,VNl[Nl[]]],z,w]]]];
	(*--- Texp; Taylor expansion of the operator ---*)
	TEXP[p_,z_,w_,b_]:=Expand[Monomial[dz^p OP[Nl[Expand[b]],
							VNl[Nl[]]],z,w]];
	TEXP[p_,z_,w_, 0]:=0;
        Texp[p_,z_,w_,b_]:=OutPut[TEXP[p,z,w,b]]/.{SINGU[q_,z1_,w1_]:>(z1-w1)^q};
	(*--- Fsort; ---*)
        const[b_]:= Simplify[b/.{ps[x__]:>0,vp[x__]:>0,bi[x__]:>0,ci[x__]:>0,
		      be[x__]:>0,ga[x__]:>0,pj[x__]:>0,xi[x__]:>0,ro[x__]:>0}];  
	Fsort[b_,z_]:= const[b] + OutPut[Module[{w2},Coefficient[Expand[
				TEXP[-1,z,w2,b]],SINGU[-1,z,w2]]/.{w2->z}]];
	(*--- der; derivative of the operator ---*)
	DER[b_,z_]:=Module[{w2},Coefficient[Expand[
				TEXP[-2,z,w2,b]],SINGU[-1,z,w2]]/.{w2->z}];
	DER[0,b_,z_]:=b;DER[1,b_,z_]:=DER[b,z];
	DER[i_,b_,z_]:=DER[DER[i-1,b,z],z]/;i>1;
        der[i_,b_,z_]:=OutPut[DER[i,b,z]]/;i>-1;  
        der[b_,z_]:=OutPut[DER[1,b,z]];  
	(*--- res; coefficient of the i-th pole ---*)
	res[i_,a_,b_]:=OutPut[
		Coefficient[Expand[OPExp[-i-1,a,b]],SINGU[-1,Zc,Wc]]]/;
	Not[TrueQ[a==0||b==0]];
	res[i_,0,b_]:=0;	res[i_,a_,0]:=0;
(**)
(*- M; Wick expansion -*)
	(*--- at the presence of the vertex operators ---*)
Monomial[g_ OP[Nl[b1___,vf[c1__],e1___],Nl[b2___,vf[c2__],e2___],
							VNl[Nl[]]],z_,w_]:=
	Exp[Simplify[Pi I (stsum[Nl[e1,b2,e2]]*vf[c1][[1]] +
			   stsum[Nl[e2]]*vf[c2][[1]])]]*
	Monomial[g OP[Nl[b1,e1],Nl[b2,e2],VNl[Vev[vf[c1],vf[c2],z,w]]],z,w];
Monomial[   OP[Nl[b1___,vf[c1__],e1___],Nl[b2___,vf[c2__],e2___],
							VNl[Nl[]]],z_,w_]:=
	Exp[Simplify[Pi I (stsum[Nl[e1,b2,e2]]*vf[c1][[1]] +
			   stsum[Nl[e2]]*vf[c2][[1]])]]*
	Monomial[  OP[Nl[b1,e1],Nl[b2,e2],VNl[Vev[vf[c1],vf[c2],z,w]]],z,w];
	(**)
Monomial[g_ OP[Nl[b1___,e1___],Nl[b2___,vf[c2__],e2___],VNl[Nl[]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e2]]*vf[c2][[1]]]]*
			Monomial[g OP[Nl[b1,e1],Nl[b2,e2],VNl[Nl[vf[c2]]]],z,w];
Monomial[   OP[Nl[b1___,e1___],Nl[b2___,vf[c2__],e2___],VNl[Nl[]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e2]]*vf[c2][[1]]]]*
			Monomial[  OP[Nl[b1,e1],Nl[b2,e2],VNl[Nl[vf[c2]]]],z,w];
	(**)
Monomial[g_ OP[Nl[b1___,vf[c1__],e1___],Nl[b2___,e2___],VNl[Nl[]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e1,b2,e2]]*vf[c1][[1]]]]*
			Monomial[g OP[Nl[b1,e1],Nl[b2,e2],VNl[Nl[vf[c1]]]],z,w];
Monomial[   OP[Nl[b1___,vf[c1__],e1___],Nl[b2___,e2___],VNl[Nl[]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e1,b2,e2]]*vf[c1][[1]]]]*
			Monomial[  OP[Nl[b1,e1],Nl[b2,e2],VNl[Nl[vf[c1]]]],z,w];
	(**)
Monomial[g_ OP[Nl[b1___,e1___],Nl[b2___,vf[c2__],e2___],
						VNl[Nl[vf[c3__]]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e2]]*vf[c2][[1]]]]*
	Monomial[g OP[Nl[b1,e1],Nl[b2,e2],VNl[Vev[vf[c2],vf[c3],z,w]]],z,w];
Monomial[   OP[Nl[b1___,e1___],Nl[b2___,vf[c2__],e2___],
						VNl[Nl[vf[c3__]]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e2]]*vf[c2][[1]]]]*
	Monomial[  OP[Nl[b1,e1],Nl[b2,e2],VNl[Vev[vf[c2],vf[c3],z,w]]],z,w];
	(**)
Monomial[g_ OP[Nl[b1___,vf[c1__],e1___],Nl[b2___,e2___],
						VNl[Nl[vf[c3__]]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e1,b2,e2]]*vf[c1][[1]]]]*
	Monomial[g OP[Nl[b1,e1],Nl[b2,e2],VNl[Vev[vf[c1],vf[c3],z,w]]],z,w];
Monomial[   OP[Nl[b1___,vf[c1__],e1___],Nl[b2___,e2___],
						VNl[Nl[vf[c3__]]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e1,b2,e2]]*vf[c1][[1]]]]*
	Monomial[  OP[Nl[b1,e1],Nl[b2,e2],VNl[Vev[vf[c1],vf[c3],z,w]]],z,w];
	(**)
Monomial[g_ OP[Nl[b1___,vf[c1__],e1___],VNl[Nl[vf[c3__]]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e1]]*vf[c1][[1]]]]*
		Monomial[g OP[Nl[b1,e1],VNl[Vev[vf[c1],vf[c3],z,w]]],z,w];
Monomial[   OP[Nl[b1___,vf[c1__],e1___],VNl[Nl[vf[c3__]]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e1]]*vf[c1][[1]]]]*
		Monomial[  OP[Nl[b1,e1],VNl[Vev[vf[c1],vf[c3],z,w]]],z,w];
	(**)
	Monomial[g_ OP[Nl[b1___,vf[c1__],e1___],VNl[Nl[]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e1]]*vf[c1][[1]]]]*
				Monomial[g OP[Nl[b1,e1],VNl[Nl[vf[c1]]]],z,w];
	Monomial[   OP[Nl[b1___,vf[c1__],e1___],VNl[Nl[]]],z_,w_]:=
	Exp[Simplify[Pi I stsum[Nl[e1]]*vf[c1][[1]]]]*
				Monomial[  OP[Nl[b1,e1],VNl[Nl[vf[c1]]]],z,w];
	(*--- Wick expansion ---*)
	Monomial[g_ OP[a___,Nl[b___,ff[c__]],VNl[Nl[d___]]],z_,w_]:=
	Monomial[g OP[a,Nl[b,ff[c]],VNl[Nl[d]]],z,w]=
	Monomial[g OP[a,Nl[b],VNl[Nl[ff[c],d]]],z,w] +
		Module[{i0},Sum[Exp[Pi I Simplify[stsum[
		Drop[Nl[d],-Length[Nl[d]]+i0-1]] ff[c][[1]]]] Monomial[
			g OP[a,Nl[b],VNl[Nl[Drop[Nl[d],-Length[Nl[d]]+i0-1],
		Expand[Vev[ff[c],Nl[d][[i0]],z,w]],Drop[Nl[d],i0]]]],z,w],
				{i0,1,Length[Nl[d]]}]];
	(**)
	Monomial[OP[a___,Nl[b___,ff[c__]],VNl[Nl[d___]]],z_,w_]:=
	Monomial[OP[a,Nl[b,ff[c]],VNl[Nl[d]]],z,w]=
	Monomial[OP[a,Nl[b],VNl[Nl[ff[c],d]]],z,w] +
		Module[{i0},Sum[Exp[Pi I Simplify[stsum[
		Drop[Nl[d],-Length[Nl[d]]+i0-1]] ff[c][[1]]]
		] Monomial[OP[a,Nl[b],VNl[Nl[Drop[Nl[d],-Length[Nl[d]]+i0-1],
		Expand[Vev[ff[c],Nl[d][[i0]],z,w]],Drop[Nl[d],i0]]]],z,w],
				{i0,1,Length[Nl[d]]}]];
	(**)
	(*--- stsum; statistics ---*)
	stsum[d_]:=Simplify[Module[{n},Sum[d[[n,1]],{n,1,Length[d]}]]];
(**)
(*--- M,OP; Expansion manipulation ---*)
	(*--- from OP to OP ---*)
				OP[a___,   0,b___]:=0;
				OP[a___,Nl[],b___]:=OP[a,b];
	(*--- from M to M ---*)
				Monomial[0,z_,w_]	:=0;
Monomial[g_ OP[a___,b_ Nl[c___],d___],z_,w_]:=
Monomial[Expand[g b OP[a,Nl[c],d]],z,w];
Monomial[   OP[a___,b_ Nl[c___],d___],z_,w_]:=
Monomial[Expand[  b OP[a,Nl[c],d]],z,w];
	Monomial[g_ OP[a___,VNl[d___,Plus[b__,c_],e___]],z_,w_]:=
				Monomial[Expand[g OP[a,VNl[d,Plus[b],e]]],z,w] +
				Monomial[Expand[g OP[a,VNl[d,c,e]]],z,w];
	Monomial[   OP[a___,VNl[d___,Plus[b__,c_],e___]],z_,w_]:=
				Monomial[Expand[  OP[a,VNl[d,Plus[b],e]]],z,w] +
				Monomial[Expand[  OP[a,VNl[d,c,e]]],z,w];
	Monomial[g_ OP[a___,VNl[d___,b_ Nl[c___],e___]],z_,w_]:=
				Monomial[Expand[g b OP[a,VNl[d,Nl[c],e]]],z,w];
	Monomial[   OP[a___,VNl[d___,b_ Nl[c___],e___]],z_,w_]:=
				Monomial[Expand[  b OP[a,VNl[d,Nl[c],e]]],z,w];
	(**)
Monomial[g_ OP[a___,VNl[d___,Nl[],e__]],z_,w_]:=
Monomial[Expand[g OP[a,VNl[d,e]]],z,w];
Monomial[   OP[a___,VNl[d___,Nl[],e__]],z_,w_]:=
Monomial[Expand[  OP[a,VNl[d,e]]],z,w];
Monomial[g_ OP[a___,VNl[d__,Nl[],e___]],z_,w_]:=
Monomial[Expand[g OP[a,VNl[d,e]]],z,w];
Monomial[   OP[a___,VNl[d__,Nl[],e___]],z_,w_]:=
Monomial[Expand[  OP[a,VNl[d,e]]],z,w];
	(**)
	Monomial[g_ OP[a___,b_,d___],z_,w_]:=
	Sum[Monomial[g OP[a,b[[i]],d],z,w],{i,1,Length[b]}]/;Head[b]==Plus;
	Monomial[   OP[a___,b_,d___],z_,w_]:=
	Sum[Monomial[  OP[a,b[[i]],d],z,w],{i,1,Length[b]}]/;Head[b]==Plus;
	(*--- M; from M to mono ---*)
	Monomial[Times[Plus[b_],OP[VNl[Nl[a___]]]],z_,w_]:=
	Log[z-w]*(z-w)*Monomial[Simplify[b/Log[dz]/dz] OP[VNl[Nl[a]]],z,w]/;
						Simplify[b/.{dz->1}]==0;
	Monomial[Times[Plus[b_],OP[VNl[Nl[a___]]]],z_,w_]:=Module[{e},
	e=Simplify[(D[b,dz]/b)/.{dz->1}];
	If[TrueQ[e>=0],0,Factor[b/dz^e/.{c_^x_:>c^(Factor[x])}]*
	mono[Factor[Expand[e]],Nl[a],z,w]]]/;Not[TrueQ[Simplify[b/.{dz->1}]==0]];
	Monomial[OP[VNl[Nl[a__]]],z_,w_]	:=0;
	Monomial[OP[a___,VNl[0]],z_,w_]	:=0; 
	Monomial[b_ OP[a___,VNl[0]],z_,w_]	:=0; 
(**)
(*--- Vev; fundamental ope ---*)
	(*--- Vev; ff and ff ---*)
	Vev[ff[i_,n_,d_,z_],ff[j_,m_,e_,w_],z1_,w1_]:=0/;Not[TrueQ[n==m]];
	Vev[ff[i_,n_,d_,z_],ff[j_,m_,e_,w_],z1_,w1_]:=0/;(i+j!=0&&i!=3);
	Vev[ff[i_,n_,d_,z_],ff[j_,m_,e_,w_],z1_,w1_]:=0/;(j!=3&&i==3);
	Vev[ff[i_,n_,d_,z_],ff[j_,m_,e_,w_],z1_,w1_]:=0/;z==w;
	Vev[ff[ 3,n_,d_,z_],ff[ 3,m_,e_,w_],z1_,w1_]:=If[TrueQ[z==w1],
		-Vev[ff[3,m,e,w],ff[3,n,d,z],z1,w1],
	(-1)^e D[Log[dz],{dz,d+e+1}] Nl[]]/;(TrueQ[n==m]&&Not[TrueQ[z==w]]);
	Vev[ff[i_,n_,d_,z_],ff[j_,m_,e_,w_],z1_,w1_]:=If[TrueQ[z==w1],
		(-1)^(i j) Vev[ff[j,m,e,w],ff[i,n,d,z],z1,w1],
		If[i==2||i==0,-1,1] (-1)^e D[Log[dz],{dz,If[j==0,1,0]+d+e+1}]*
		Nl[]]/;(TrueQ[n==m]&&i+j==0&&Not[TrueQ[z==w]]);
	(*--- Vev; ff and vf ---*)
	Vev[ff[i_,n_,d_,z_],vf[ a_,q_,e_,w_],z1_,w1_]:=0/;(i!=0||z==w);
	Vev[ff[i_,n_,d_,z_],vf[ a_,q_,e_,w_],z1_,w1_]:=If[TrueQ[z==w1],
				Vev[vf[a,q,e,w],ff[i,n,d,z],z1,w1],
 		Expand[Module[{k},Sum[Binomial[e,k] (-1)^k*
		q[[n]] D[Log[dz],{dz,k+d+1}] Nl[vf[ a,q,e-k,w]],{k,0,e}]]]]/;
		(i==0&&Not[TrueQ[z==w]]);
	Vev[vf[ a_,q_,d_,z_],ff[j_,m_,e_,w_],z1_,w1_]:=0/;(j!=0||TrueQ[z==w]);
	Vev[vf[ a_,q_,d_,z_],ff[j_,m_,e_,w_],z1_,w1_]:=If[TrueQ[z==w1],
				Vev[ff[j,m,e,w],vf[a,q,d,z],z1,w1],
		Expand[Module[{k},Sum[Binomial[d,k] (-1)^(e+1)*
		q[[m]] D[Log[dz],{dz,e+k+1}]	Nl[vf[ a,q,d-k,z]],{k,0,d}]]]]/;
		(j==0&&Not[TrueQ[z==w]]);
	(*--- Vev; vf and vf ---*)
	Vev[vf[ a_,q_,d_,z_],vf[ b_,p_,e_,w_],z1_,w1_]:=
		Nl[vf[ a,q,d,z],vf[ b,p,e,w]]/;
		(TrueQ[z==w]||TrueQ[Simplify[p.q]==0]);
	Vev[vf[ a_,q_,d_,z_],vf[ b_,p_,e_,w_],z1_,w1_]:=If[TrueQ[z==w1],
			(-1)^(q.p) Vev[vf[b,p,e,w],vf[a,q,d,z],z1,w1],
		Expand[Module[{k3,k4},Sum[Sum[Binomial[d,k3] Binomial[e,k4]*
		(-1)^k4 D[dz^(q.p),{dz,k3+k4}]*
	 	Nl[vf[ a,q,d-k3,z],vf[ b,p,e-k4,w]],{k3,0,d}],{k4,0,e}]]]]/;
		(Not[TrueQ[z==w]]&&Not[TrueQ[Simplify[p.q]==0]]);
(**)
(*--- ps,bi,ci,be,ga,pj; elementary fields (psi),(b,c),(beta,gamma),(phi) ---*)
(*--- ff; Inner representation ---*)
(*--- ff[index (3,1,-1,2,-2,0) for (ps,bi,ci,be,ga,jp),
					 number,derivative,position] ---*)
	OP[c___,Nl[a___,ps[j_,i_,z_],b___],d___]:=OP[c,Nl[a,ff[ 3,i,j,z],b],d];
	OP[c___,Nl[a___,bi[j_,i_,z_],b___],d___]:=OP[c,Nl[a,ff[ 1,i,j,z],b],d];
	OP[c___,Nl[a___,ci[j_,i_,z_],b___],d___]:=OP[c,Nl[a,ff[-1,i,j,z],b],d];
	OP[c___,Nl[a___,be[j_,i_,z_],b___],d___]:=OP[c,Nl[a,ff[ 2,i,j,z],b],d];
	OP[c___,Nl[a___,ga[j_,i_,z_],b___],d___]:=OP[c,Nl[a,ff[-2,i,j,z],b],d];
	OP[c___,Nl[a___,pj[j_,i_,z_],b___],d___]:=OP[c,Nl[a,ff[ 0,i,j,z],b],d];
	(*--- vp,vf; vertex operators ---*)
	OP[c___,Nl[a___,vp[j_,q_,z_],b___],d___]:=
				       OP[c,Nl[a,vf[Simplify[q.q],q,j,z],b],d];
	(*--- ro,xi; fermionic(5) and bosonic(4) parameters ---*)
	OP[c___,Nl[a___,ro[j_,i_,z_],b___],d___]:=OP[c,Nl[a,ff[ 5,i,j,z],b],d];
	OP[c___,Nl[a___,xi[j_,i_,z_],b___],d___]:=OP[c,Nl[a,ff[ 4,i,j,z],b],d];
	(*--- Jp,Jg,Jc,Tpj,Tbg,Tbc; U(1) and Virasoro generators ---*)
	Jp[i_,z_]:=	Nl[pj[0,i,z]];
	Jg[i_,z_]:=     Nl[be[0,i,z],ga[0,i,z]];
	Jc[i_,z_]:=	Nl[bi[0,i,z],ci[0,i,z]];
	Tps[   i_,z_]:=(1/2) Nl[ps[1,i,z],ps[0,i,z]];
	Tpj[h_,i_,z_]:=(1/2) Nl[pj[0,i,z],pj[0,i,z]]-h/2 pj[1,i,z];
	Tbc[h_,i_,z_]:=(1-h) Nl[bi[1,i,z],ci[0,i,z]]-h Nl[bi[0,i,z],ci[1,i,z]];
        Tbg[h_,i_,z_]:=(1-h) Nl[be[1,i,z],ga[0,i,z]]-h Nl[be[0,i,z],ga[1,i,z]];
(**)
(*--- mono; Taylor expansion ---*)
	(*--- ff ---*)
	mono[p_,Nl[a___,ff[i_,n_,d_,z_],b___],z1_,w1_]:=
		Module[{j},Sum[(1/j!) mono[p+j,Nl[a,ff[i,n,d+j,w1],b],z1,w1],
			{j,0,Ceiling[-p-1]}]]/;(TrueQ[p<0]&&Not[TrueQ[z==w1]]);
	(*--- vf ---*)
	mono[p_,Nl[a___,vf[c_,n_,d_,z_],b___],z1_,w1_]:=
		Module[{j},Sum[(1/j!) mono[p+j,Nl[a,vf[c,n,d+j,w1],b],z1,w1],
			{j,0,Ceiling[-p-1]}]]/;(TrueQ[p<0]&&Not[TrueQ[z==w1]]);
	(**)
	(*--- expansion of vertex opertor ---*)
	mono[p_,Nl[a___,vf[c_,q_,d_,w_],b___],z1_,w1_]:=
		Module[{i,s},Sum[Sum[(d-1)!/s!/(d-1-s)! q[[i]]*
			 mono[p,Nl[a,ff[0,i,s,w],vf[c,q,d-1-s,w],b],z1,w1],
			{i,1,Length[q]}],{s,0,d-1}]]/;d>0;
(**)
(*--- mono; sort ---*)
	(*--- ff and ff ---*)
 	mono[p_,Nl[a___,ff[i_,n_,d_,w_],ff[j_,m_,e_,w_],b___],z1_,w1_]:=0/;
						(i*j==1&&i==j&&n==m&&d==e);
 	mono[p_,Nl[a___,ff[i_,n_,d_,w_],ff[j_,m_,e_,w_],b___],z1_,w1_]:=0/;
						(i==3&&i==j&&n==m&&d==e);
	mono[p_,Nl[a___,ff[i_,n_,d_,w_],ff[j_,m_,e_,z_],b___],z1_,w1_]:=
		(-1)^(i j) mono[p,Nl[a,ff[j,m,e,z],ff[i,n,d,w],b],z1,w1]/;
		((Abs[j]==Abs[i]&&(m<n||(m==n&&j>i)||(m==n&&j==i&&e>d)))||
		 Abs[j]>Abs[i]);
	(*--- ff and vf ---*)
	mono[p_,Nl[a___,vf[c_,n_,d_,w_],ff[j_,m_,e_,z_],b___],z1_,w1_]:=
		Exp[Pi I c j] mono[p,Nl[a,ff[j,m,e,z],vf[c,n,d,w],b],z1,w1];
	(*--- vf and vf ---*)
	mono[p_,Nl[a___,vf[st1_,n_, 0,w_],vf[st2_,m_, 0,w_],b___],z1_,w1_]:=
		mono[p,Nl[a,b],z1,w1]/;n==-m;
	mono[p_,Nl[a___,vf[st1_,n_, 0,w_],vf[st2_,m_, 0,w_],b___],z1_,w1_]:=
		CO2[n,m] mono[p,Nl[a,vf[Simplify[(n+m).(n+m)],
		Simplify[n+m],0,w],b],z1,w1];
	CO2[n_,m_]:=Exp[Pi I Simplify[-(n.n) (m.m)-n.m]] CO2[m,n]/;
	(nega[n-m]>0&&Mod[n.n,1]==0&&Mod[m.m,1]==0&&Mod[n.m,1]==0);
	nega[m_]:=Module[{mnega},sw=0;mnega=Join[{0},Simplify[m]];
		Sum[If[sw==0&&mnega[[i]]==0,
		If[TrueQ[Re[mnega[[i+1]]]+Im[mnega[[i+1]]]==0],0,sw=1;
		If[TrueQ[Re[mnega[[i+1]]]+Im[mnega[[i+1]]]<0],1,0]],0],
		{i,1,Length[m]}]];
(**)
(*-- mono; filter --*)
	(*--- power counting ---*)
	mono[p_,Nl[c___],z1_,w1_]:=0/;TrueQ[Simplify[p]>=0];
	mono[p_,Nl[],z1_,w1_]:=SINGU[Simplify[p],z1,w1]/;TrueQ[Simplify[p]<0];
	mono[p_,Nl[c__],z1_,w1_]:=SINGU[Simplify[p],z1,w1] fEND[REV[Nl[c]]]/;
		TrueQ[Table[Nl[c][[i,4]],{i,1,Length[Nl[c]]}]==
		Table[w1,{i,1,Length[Nl[c]]}]]&&TrueQ[Simplify[p]<0];
	mono[p_,Nl[c__],z1_,w1_]:=SINGU[Simplify[p],z1,w1] fEND[REV[Nl[c]]]/;
		Not[TrueQ[p<0]]&&Not[TrueQ[p>=0]];
	(*--- REV; from (ff,vf) to  (bi,ci,be,ga,pj,ro,xi,vp) ---*)
	REV[Nl[a___,ff[ 1,i_,j_,z_],b___]]:=REV[Nl[a,bi[j,i,z],b]];
	REV[Nl[a___,ff[-1,i_,j_,z_],b___]]:=REV[Nl[a,ci[j,i,z],b]];
	REV[Nl[a___,ff[ 2,i_,j_,z_],b___]]:=REV[Nl[a,be[j,i,z],b]];
	REV[Nl[a___,ff[-2,i_,j_,z_],b___]]:=REV[Nl[a,ga[j,i,z],b]];
	REV[Nl[a___,ff[ 0,i_,j_,z_],b___]]:=REV[Nl[a,pj[j,i,z],b]];
	REV[Nl[a___,vf[c_,q_,j_,z_],b___]]:=REV[Nl[a,vp[j,Simplify[q],z],b]];
	REV[Nl[a___,ff[ 5,i_,j_,z_],b___]]:=REV[Nl[a,ro[j,i,z],b]];
	REV[Nl[a___,ff[ 4,i_,j_,z_],b___]]:=REV[Nl[a,xi[j,i,z],b]];
	REV[Nl[a___,ff[ 3,i_,j_,z_],b___]]:=REV[Nl[a,ps[j,i,z],b]];
	REV[0]:=0;
	(*--- fEND; remove REV[] ---*)
	fEND[REV[Nl[c__]]]:=Nl[c]/;Length[Nl[c]]>1;
	fEND[REV[Nl[c_]]]:=c/;Length[Nl[c]]==1;
	fEND[0]:=0;
(**)
(*--- Bosonization ---*)
Boson[a_,z_]:=Sum[Boson[Expand[a[[i]]],z],{i,1,Length[a]}]/;Head[a]==Plus;
Boson[Times[a__,Nl[b__]],z_]:=Times[a] Boson[Nl[b],z];
	(**)
	bosonize[x_,z_]:=Boson[Nl[x],z];
	Boson[Nl[x_,y__],z_]:=Expand[Module[{a},
		res[0,Nl[BRule[x/.{z->a}]],Boson[Nl[y],z]]]];
	Boson[Nl[x_],z_]:=Fsort[BRule[x],z];
(**)
(*--- Current generator ---*)
Current[t0_,a_,keisu_]:=Module[{t1,t,s,i,undet,ichiban,kal},
t1 = Nl[Fsort[undet t0,a]];s = 0;i = 0;t = t1;
While[Head[t] == Plus,i = i+1;ichiban = t[[1]]/(t[[1]]/.{Nl[x___]:>1});
s = s + keisu[i] ichiban;
t = Expand[t - Coefficient[t,ichiban] ichiban]];
kal = If[Not[TrueQ[t==0]],s+keisu[i+1] Last[t1]/(Last[t1]/.{Nl[x___]:>1}),s];
Fsort[kal,a]];
(*--- Output ---*)
OutPut[t0_]:=Module[{t1,t,s,ichiban},
t1 = Expand[t0 - const[t0]];s = 0;t = t1;
While[Head[t] == Plus,
ichiban = If[TrueQ[t[[1]]==(t[[1]]/.{Nl[x___]:>1})],
t[[1]]/(t[[1]]/.{ps[x__]:>1,vp[x__]:>1,bi[x__]:>1,ci[x__]:>1,be[x__]:>1,
ga[x__]:>1,pj[x__]:>1,xi[x__]:>1,ro[x__]:>1}),
t[[1]]/(t[[1]]/.{Nl[x___]:>1})];
nlt = Nl[t];nlichiban=Nl[ichiban];
s = s + Simplify[Coefficient[nlt,nlichiban]] ichiban;
t = Expand[Simplify[t1 - s]];];
const[t0] + s + Simplify[t]];
(*--- Protection ---*)
Protect[help,Texp,ope,der,res,Fsort,CO2,Current,bosonize,
ps,be,ga,bi,ci,pj,ro,xi,vp,Jg,Jc,Jp,Tbc,Tbg,Tpj,Nl,
dz,mono,OP,stsum,ff,vf,Vev,nega,VNl,Rope,mnega,SINGU,const,
regope,REV,fEND,Boson,OutPut,OMC,DER,OPExp,TEXP];
(*--- the end-line of the program ---*)
)



