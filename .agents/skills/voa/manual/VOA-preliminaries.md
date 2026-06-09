# VOA Preliminaries: 核心概念、定义与恒等式

**来源**: Thielemans, "An Algorithmic Approach to Operator Product Expansions, W-Algebras and W-Strings", PhD thesis KU Leuven, 1994.

本文件从 `voa-manual.md` 中提取核心数学定义和恒等式，供 OPE 计算参考。

---

## 1. 共形变换与场

### 1.1 共形变换

在复平面上，共形变换为解析映射：

$$
z \to z' = f(z), \quad \bar{z} \to \bar{z}' = \bar{f}(\bar{z})
$$

生成元为 $l_m = -z^{m+1}\partial$（$m \in \mathbb{Z}$），满足 Virasoro 代数（无中心延拓）：

$$
[l_m, l_n] = (m - n) l_{m+n}
$$

全局共形群由 $\{l_{-1}, l_0, l_1\}$ 生成，对应 Möbius 变换 $z \to \frac{az+b}{cz+d}$。

### 1.2 初级场 (Primary field)

**定义 2.1.1**: 在共形变换 $z \to f(z)$ 下，初级场变换为：

$$
\Phi(z,\bar{z}) \to \Phi'(f(z), \bar{f}(\bar{z})) = (\partial f(z))^{-h} (\bar{\partial}\bar{f}(\bar{z}))^{-\bar{h}} \Phi(z,\bar{z})
$$

其中 $h$, $\bar{h}$ 称为**共形维数** (conformal dimensions)。无穷小变换为：

$$
\delta_\varepsilon \Phi(z,\bar{z}) = \varepsilon(z)\partial\Phi(z,\bar{z}) + h\partial\varepsilon(z)\Phi(z,\bar{z})
$$

### 1.3 准初级场 (Quasiprimary) 与标度场 (Scaling field)

**定义 2.1.2**:
- **准初级场**: 仅在全局共形变换下如初级场般变换
- **标度场**: 仅在平移和标度变换下如此变换

---

## 2. 算子积展开 (OPE)

### 2.1 OPE 的定义

两个算子的 OPE 定义为 (eq. 2.3.3)：

$$
T_1(z) T_2(z_0) = \sum_{n \leq h(T_1, T_2)} \frac{[T_1 T_2]_n(z_0)}{(z - z_0)^n}
$$

其中 $[T_1 T_2]_n$ 是第 $n$ 阶极点处的算子，共形维数为 $\dim(T_1) + \dim(T_2) - n$。

### 2.2 正规序积 (Normal ordered product)

正规序积定义为 OPE 的零阶项 (eq. 2.3.7)：

$$
:T_1 T_2: \;\to\; [T_1 T_2]_0
$$

更一般地，正则部分满足 (eq. 2.3.14)：

$$
[AB]_{-n} = \frac{1}{n!} :(\partial^n A) B:, \quad n \in \mathbb{N}
$$

### 2.3 OPE 记号

Virasoro OPE 的极点列表记号 (eq. 2.3.26)：

$$
T \times T = \ll \frac{c}{2} \mid 0 \mid 2T \mid \partial T \gg
$$

---

## 3. OPE 一致性条件（核心恒等式）

### 3.1 导数规则

**左导数** (eq. 2.3.13):

$$
[\partial A\, B]_{n+1} = -n\, [AB]_n
$$

**右导数** (eq. 2.3.15):

$$
[A\, \partial B]_{n+1} = n\, [AB]_n + \partial [AB]_{n+1}
$$

### 3.2 交换关系 (Crossing symmetry)

给定 $[AB]_l$，可计算 $[BA]_q$ (eq. 2.3.16)：

$$
[BA]_q = (-1)^{|A||B|} \sum_{l \geq q} \frac{(-1)^l}{(l-q)!} \partial^{(l-q)} [AB]_l
$$

**自 OPE 约束** (eq. 2.3.17): 当 $|A| + q$ 为奇数时，

$$
[AA]_q = -\sum_{l > 0} \frac{(-1)^l}{2\,l!} \partial^l [AA]_{q+l}
$$

特别地，**费米子** $A$ 的正规序积由奇异部分决定：

$$
[AA]_0 = \frac{1}{2}\partial [AA]_1 - \frac{1}{24}\partial^3 [AA]_3 + \cdots
$$

### 3.3 结合性 (Jacobi identity)

**主结合恒等式** (eq. 2.3.21)，对任意 $p, q \in \mathbb{Z}$：

$$
[A\,[BC]_p]_q = (-1)^{|A||B|} [B\,[AC]_q]_p + \sum_{l > 0} \binom{q-1}{l-1} [[AB]_l\, C]_{p+q-l}
$$

**第二结合恒等式** (eq. 2.3.22)：

$$
[A\,[BC]_p]_q = (-1)^{|A||B|} \left( [B\,[AC]_q]_p - \sum_{l>0} \binom{p-1}{l-1} [[BA]_l\, C]_{p+q-l} \right)
$$

**第三结合恒等式** (eq. 2.3.24)：

$$
[[AB]_p\, C]_q = \sum_{l \geq q} (-1)^{q-l} \binom{p-1}{l-q} [A\,[BC]_l]_{p+q-l} - (-1)^{|A||B|} \sum_{l>0} (-1)^{p-l} \binom{p-1}{l-1} [B\,[AC]_l]_{p+q-l}
$$

---

## 4. 算子积代数 (OPA) 的公理化定义

**定义 2.3.1**: 算子积代数是一个 $\mathbb{Z}_2$ 分次向量空间 $\mathcal{V}$，带有单位元 $\mathbf{1}$、偶线性映射 $\partial$ 和双线性运算 $[..]_l: \mathcal{V} \otimes \mathcal{V} \to \mathcal{V}$（$l \in \mathbb{Z}$），满足：

**单位元**:

$$
[\mathbf{1}\, A]_l = \delta_l\, A
$$

**交换性**: (eq. 2.3.16)

$$
[BA]_n = (-1)^{|A||B|} \sum_{l \geq n} \frac{(-1)^l}{(l-n)!} \partial^{(l-n)} [AB]_l \quad \forall\, n \in \mathbb{Z}
$$

**结合性**: (eq. 2.3.21)

$$
[A\,[BC]_p]_q = (-1)^{|A||B|} [B\,[AC]_q]_p + \sum_{l>0} \binom{q-1}{l-1} [[AB]_l\, C]_{p+q-l} \quad \forall\, p,q \in \mathbb{Z}
$$

**零场** (null fields): 零场构成 OPA 的理想 $\mathcal{N}$，OPA 的公理只需模 $\mathcal{N}$ 成立。

---

## 5. 关键术语定义

### 5.1 Virasoro 算子

**定义 2.3.5**: Virasoro 算子 $T$ 的 OPE (eq. 2.3.2):

$$
[TT]_4 = \frac{c}{2}\mathbf{1}, \quad [TT]_2 = 2T, \quad [TT]_1 = \partial T
$$

### 5.2 标度算子、准初级算子、初级算子

**定义 2.3.6**:

- **标度算子** $A$（维数 $h$）: $[TA]_2 = hA$，$[TA]_1 = \partial A$
- **准初级算子**: 标度算子且 $[TA]_3 = 0$
- **初级算子**: 标度算子且 $[TA]_n = 0$，$\forall\, n \geq 3$

### 5.3 复合算子

**定义 2.3.3**: $A$ 是复合算子，若 $A = [BC]_0$（$B, C \neq \mathbf{1}$），但 $B = C$ 且为费米子时除外。

### 5.4 维数

**定义 2.3.7**: OPA 上的维数映射满足：

$$
\dim(\mathbf{1}) = 0, \quad \dim(\partial A) = \dim(A) + 1, \quad \dim([AB]_l) = \dim(A) + \dim(B) - l
$$

### 5.5 $\mathcal{W}$-代数

**定义 2.3.8**: 共形 OPA 中，若生成元可选为准初级算子，则称为 $\mathcal{W}$-代数。

---

## 6. 模代数 (Mode algebra)

### 6.1 模的定义

算子 $A$（维数 $a$）的第 $m$ 个模 (eq. 2.4.1)：

$$
\widehat{A}_m B \equiv [AB]_{m+a}
$$

导数的模 (eq. 2.4.2)：

$$
\widehat{(\partial A)}_m = -(m+a)\widehat{A}_m
$$

### 6.2 模对易关系

**定理 2.4.1** (eq. 2.4.4): 分次对易子为：

$$
[\widehat{A}_m, \widehat{B}_n] = \sum_{l > 0} \binom{m+a-1}{l-1} (\widehat{[AB]_l})_{m+n}
$$

### 6.3 Virasoro 代数

Virasoro 模 $L_m$ 满足 (eq. 2.4.5)：

$$
[L_m, L_n] = (m-n)L_{m+n} + \frac{c}{2}\binom{m+1}{3}\delta_{m+n}
$$

$T$ 与初级场 $\Phi$（维数 $h$）的对易子 (eq. 2.4.7)：

$$
[L_m, \widehat{\Phi}_n] = ((h-1)m - n)\widehat{\Phi}_{m+n}
$$

### 6.4 正规序积的模 (eq. 2.4.11)

$$
(\widehat{[AB]_0})_m = \sum_l :\widehat{A}_l \widehat{B}_{m-l}:
$$

其中正规序为 (eq. 2.4.12)：

$$
:\widehat{A}_l \widehat{B}_m: = \begin{cases} \widehat{A}_l \widehat{B}_m & l \leq -a \\ (-1)^{|A||B|} \widehat{B}_m \widehat{A}_l & l > -a \end{cases}
$$

---

## 7. Poisson bracket 与经典 OPE 的对应

Poisson bracket 定义 (eq. 2.3.27)：

$$
\{A(z), B(z_0)\}_{\text{PB}} = \sum_{n > 0} \frac{(-1)^{n-1}}{(n-1)!} \{AB\}_n(z_0) \partial^{n-1}\delta(z - z_0)
$$

**对应规则** (eq. 2.3.33): $\{AB\}_n \leftrightarrow [AB]_n$

**与量子 OPE 的区别**: 经典情形中，去掉多重收缩，正规序变为 graded-commutative 且 associative。

---

## 8. 基本自由场 OPE

### 8.1 自由玻色子

$\partial X$（维数 1）的 OPE (eq. 2.6.7，取 $\lambda = 1$)：

$$
\partial X(z)\, \partial X(w) = \frac{1}{(z-w)^2} + O(z-w)^0
$$

能动量张量 (eq. 2.6.9): $T = \frac{1}{2}[\partial X\, \partial X]_0$，中心荷 $c = 1$。

带背景荷 (eq. 2.6.17): $T = \frac{1}{2}[\partial X\, \partial X]_0 - q\,\partial^2 X$，中心荷 $c = 1 - 12q^2$。

模代数: $[\alpha_m, \alpha_n] = m\,\delta_{m+n}$。

### 8.2 自由费米子

$\psi$（维数 $1/2$）的 OPE (eq. 2.6.26，取 $\lambda = 1$)：

$$
\psi(z)\, \psi(w) = \frac{1}{z-w} + O(z-w)^0
$$

能动量张量 (eq. 2.6.28): $T = \frac{1}{2}[\partial\psi\, \psi]_0$，中心荷 $c = 1/2$。

### 8.3 $b,c$ 鬼场系统

$b$（维数 $h$）、$c$（维数 $1-h$），费米子：

$$
c(z)\, b(w) = \frac{1}{z-w} + O(z-w)^0
$$

能动量张量 (eq. 2.6.33): $T_{bc} = [b\, \partial c]_0 - (1-h)\partial[b\, c]_0$，中心荷 $c = 2(6h^2 - 6h + 1)$。

### 8.4 $\beta,\gamma$ 系统

类似 $b,c$ 系统但为玻色子，中心荷 $c = -2(6h^2 - 6h + 1)$。

### 8.5 Kac-Moody 代数 (仿射 Lie 代数)

电流 $J^a$（维数 1）的 OPE (eq. 2.6.44)：

$$
J^a(z)\, J^b(w) = \frac{-\frac{\kappa}{2}g^{ab}}{(z-w)^2} + \frac{f^{ab}{}_c J^c(w)}{z-w} + O(z-w)^0
$$

Sugawara 能动量张量 (eq. 2.6.47)：

$$
T_S = \frac{1}{x(\kappa + \tilde{h})} \operatorname{str}[J_z\, J_z]_0
$$

中心荷 (eq. 2.6.48): $c = \frac{k(d_B - d_F)}{k + \tilde{h}}$，其中 $\tilde{h}$ 为对偶 Coxeter 数。

---

## 9. 全局共形群对 OPE 的约束

### 9.1 准初级场 OPE 的一般形式

**假设 4.3.1**: OPA 的所有元素是准初级场 $\Phi_k$ 及其导数的线性组合。

两个准初级场的 OPE (eq. 4.3.11)：

$$
\Phi_i(z)\,\Phi_j(w) = \sum_k \sum_{n \geq 0} \mathcal{C}_{ij}^k\, \alpha(h_i, h_j, h_k, n)\, \partial^n\Phi_k(w)\, (z-w)^{n - h_{ijk}}
$$

其中 $h_{ijk} = h_i + h_j - h_k$，**导数系数** (eq. 4.3.12)：

$$
\alpha(h_i, h_j, h_k, n) = \frac{(h_i - h_j + h_k)_n}{n!\,(2h_k)_n}
$$

### 9.2 $L_1$ 作用公式

$L_1$ 对 OPE 极点的作用 (eq. 4.3.6)：

$$
L_1^m\, [\Phi_i\Phi_j]_n = (2h_i - m - n)_m\, [\Phi_i\Phi_j]_{m+n}
$$

$L_1$ 对导数的作用 (eq. 4.3.7)：

$$
L_1^m\, L_{-1}^p\, \Phi_k = (p-m+1)_m\, (2h_k + p - m)_m\, L_{-1}^{p-m}\,\Phi_k
$$

### 9.3 从 OPE 提取准初级场

准初级场提取公式 (eq. 4.3.15)：

$$
QP^m(\Phi_i, \Phi_j) = \sum_{n \geq 0} a_n^m(h_i, h_j)\, \partial^n [\Phi_i\Phi_j]_{n+m}
$$

其中系数 (eq. 4.3.21)：

$$
a_n^m(h_i, h_j) = (-1)^n \frac{(2h_i - n - m)_n}{n!\,(2h_i + 2h_j - 2m - n - 1)_n}
$$

**准初级正规序积** 的例子 (eq. 4.3.14)：

$$
\mathcal{NO}(T\Phi_i) = [T\Phi_i]_0 - \frac{3}{2(2h_i + 1)}\partial^2\Phi_i
$$

---

## 10. $\mathcal{W}_3$ 代数（非线性 $\mathcal{W}$-代数原型）

$T$（维数 2）和 $W$（维数 3）生成，OPE (eq. 4.1.1)：

$$
W(z)W(w) = \frac{c/3}{(z-w)^6} + \frac{2T(w)}{(z-w)^4} + \frac{\partial T(w)}{(z-w)^3} + \frac{2\beta\Lambda(w) + \frac{3}{10}\partial^2 T(w)}{(z-w)^2} + \cdots
$$

其中准初级复合场 (eq. 4.1.2)：

$$
\Lambda = [TT]_0 - \frac{3}{10}\partial^2 T
$$

结构常数 (eq. 4.1.3)：

$$
\beta = \frac{16}{22 + 5c}
$$

---

## 11. 最高权表示与极小模型

### 11.1 最高权态

**定义 4.2.1**: 对模代数生成元 $W^i_n$，最高权态 $|\phi\rangle$（权 $w^i$）满足：

$$
W^i_0 |\phi\rangle = w^i |\phi\rangle, \quad W^i_n |\phi\rangle = 0 \quad (n > 0)
$$

### 11.2 Verma 模

Verma 模是所有后代 $W_{-\{n\}}|\phi\rangle$ 张成的空间。后代的**级别**为其 $L_0$ 权减去 $|\phi\rangle$ 的 $L_0$ 权。

### 11.3 奇异向量与屏蔽算子

**屏蔽算子** $S$ 满足 (eq. 4.2.2)：$[SW^i]_1 = 0$。

**交织算子** (eq. 4.2.3)：$Q_S X(w) = [SX]_1(w)$，与所有模 $W^i_m$ 对易。

---

## 12. 组合恒等式

### Pochhammer 符号

(eq. 2.A.1):

$$
(a)_n = \frac{\Gamma(a+n)}{\Gamma(a)} = \prod_{j=0}^{n-1}(a+j), \quad a \in \mathbb{R},\, n \in \mathbb{N}
$$

### 二项式系数

(eq. 2.A.2):

$$
\binom{a}{n} = \frac{(a)_n}{n!}
$$

### 关键求和恒等式

(eq. 2.A.4):

$$
\sum_{l \in \mathbb{N}} (-1)^l \binom{r}{l}\binom{r+s-l}{p-l} = \binom{s}{p}
$$

(eq. 2.A.5):

$$
\sum_{p \in \mathbb{N}} \binom{n}{p}\binom{m}{s-p} = \binom{m+n}{s}
$$
