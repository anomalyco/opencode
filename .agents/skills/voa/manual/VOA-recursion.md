# Zhu's recursion formula

## Square modes
环面 $T^2$ 上 null operator（以及它的后裔）的单点函数为零。为了定义环面上的关联函数，使用“方括号”模式

$$
a[z] = e^{izh_a}a(e^{iz} - 1) = \sum_{n \in \mathbb{Z}- h_a}a_{[n]}z^{-n-h_a} \ ,
$$

其中

$$
a_{[n]} = \sum_{j \ge n}c(j, n; h_a)a_j, \qquad
(1 + z)^{h - 1} \log(1 + z)^n = \sum_{j \ge n} c(j,n;h_a) z^j \ .
$$

但是对于 stress tensor $T = \sum_{n\in \mathbb{Z}} L_n z^{-n - 2}$，在环面上的能动张量需要重定义 $L_n \to L_n - \frac{c}{24}\delta_{n, -2}$ 才是合法的能动张量，

$$
L_{[n]} = \sum_{j \ge n} c(j, n; 2) L_j - \frac{c}{24}\delta_{n, -2}  \ ,
$$
多出了额外的 $c$ 项 


## Recursion formula
这种单点函数有时可以先用 Zhu 的递推公式进行预处理。对于一个带有 $U(1)$ 仿射流 $J$ 的手征代数，以及手征代数中的任意两个算符 $a(z), b(z)$，对应的 state 是 $|a \rangle = a(z \to 0)|0\rangle$，$|b\rangle = b(z \to 0)|0\rangle$，则

$$
J_0|a\rangle = Q|a\rangle,
$$

则有

$$
\operatorname{str}_M\, o(a_{[-h_a]}b)\, x^{J_0} q^{L_0 - c/24}
=
\delta_{Q,0}\,\operatorname{str}_M\, o(a)o(b)\, x^{J_0} q^{L_0 - c/24}
+
\sum_{n=1}^{+\infty}
E_n\!\left[\begin{matrix} e^{2\pi i h_a} \\ x^{Q} \end{matrix}\right]
\operatorname{str}_M\, o(a_{[-h_a+n]}b)\, x^{J_0} q^{L_0 - c/24}.
$$

其中 $\delta_{Q, 0}$ 是 Kronecker $\delta$，$o(a)$ 是 $a$ 的 zero-mode，$o(a) = a_0$ 是 $a$ 的 zero-mode。

并且，当 $n \gt 0$ 时，

$$
\operatorname{str}_M\, o(a_{[-h_a-n]}|b\rangle)\, q^{L_0 - c/24} x^{J_0}
=
(-1)^n
\sum_{k=1}^{+\infty}
\binom{k-1}{n}
E_k\!\left[\begin{matrix} e^{2\pi i h_a} \\ x^{Q} \end{matrix}\right]
\operatorname{str}_M\, o(a_{[-h_a-n+k]}|b\rangle)\, q^{L_0 - c/24} x^{J_0} \ ,
$$
