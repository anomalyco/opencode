# VOA 中的 Zhu 代数、$C_2$ 代数与 Associated Variety

**来源**: Beem, Rastelli, "Vertex operator algebras, Higgs branches, and modular differential equations", Section 2.

---

## 1. VOA 基本设置

### 1.1 顶点算子映射

$\frac{1}{2}\mathbb{Z}_+$ 分次的共形 VOA，向量空间 $\mathcal{V}$ 上每个态 $a^i$ 定义一个顶点算子 (eq. 2.7)：

$$
a^i \;\longmapsto\; a^i(z) = \sum_{n=-\infty}^{\infty} a^i_{(-h_i - n)}\, z^n
$$

其中 $a^i_{(n)} \in \mathrm{End}(\mathcal{V})$，$h_i$ 是共形维数。真空态 $\Omega$（维数 0）恢复态 (eq. 2.8)：

$$
a^i = \lim_{z\to 0} a^i(z)\,\Omega = a^i_{(-h_i)}\,\Omega
$$

### 1.2 正规序积

非交换、非结合的乘法 (eq. 2.9)：

$$
\mathrm{NO}(a, b) := a_{-h_a}\, b_{-h_b}\,\Omega
$$

### 1.3 Secondary bracket（Zhu bracket）

(eq. 2.10)：

$$
\{a, b\} := a_{(-h_a + 1)}\, b \equiv \oint \frac{dz}{2\pi i}\, a(z)\, b(0)\;\Omega
$$

$\{a, \cdot\}$ 是关于正规序积的**导子** (eq. 2.11)：

$$
\{a, \mathrm{NO}(b, c)\} = \mathrm{NO}(b, \{a,c\}) + \mathrm{NO}(\{a,b\}, c)
$$

### 1.4 强生成元 (Strong generators)

VOA 的**强生成元**是不能表示为其他算子正规序积的算子(即不出现在任何 OPE 的非奇异项中，但可以作为奇异项出现)。强生成元及其奇异 OPE 系数完全生成 VOA 所有态/算符。

---

## 2. Zhu's $C_2$ 代数

### 2.1 $C_2(\mathcal{V})$ 子空间的定义

(eq. 2.24)：

$$
C_2(\mathcal{V}) := \mathrm{Span}\left\{ a^i_{(-h_i - 1)}\,\varphi \;:\; a^i, \varphi \in \mathcal{V} \right\}
$$

**直觉理解**: 态 $a^i_{(-h_i - n)}\Omega$ 通过态-算子映射对应顶点算子 $\partial^n a^i$。因此 $C_2(\mathcal{V})$ 大致是所有**含有导数**的正规序复合算子张成的空间。但如果 VOA 中有 null 关系，$C_2(\mathcal{V})$ 也可能包含不含导数的算子。

### 2.2 $C_2(\mathcal{V})$ 的代数性质

$C_2(\mathcal{V})$ 关于正规序积和 secondary bracket 都是**双侧理想**。并且正规序积的交换子和结合子、bracket 的对称化子和 Jacobi 子都映入 $C_2(\mathcal{V})$ (eq. 2.25)：

$$
[\mathcal{V}, \mathcal{V}]_{\mathrm{NO}} \subseteq C_2(\mathcal{V}), \quad [\mathcal{V}, \mathcal{V}, \mathcal{V}]_{\mathrm{NO}} \subseteq C_2(\mathcal{V})
$$

$$
\{\mathcal{V}, \mathcal{V}\}_+ \subseteq C_2(\mathcal{V}), \quad \{\mathcal{V}, \mathcal{V}, \mathcal{V}\}_{\text{Jacobi}} \subseteq C_2(\mathcal{V})
$$

### 2.3 $C_2$ 代数（Zhu's $C_2$ algebra）

(eq. 2.26)：

$$
\mathcal{R}_{\mathcal{V}} := \mathcal{V} / C_2(\mathcal{V})
$$

由正规序积和 secondary bracket 诱导的乘法和 Poisson bracket，$\mathcal{R}_{\mathcal{V}}$ 成为**交换、结合的 Poisson 代数**。

- 若 $\mathcal{V}$ 是强有限生成的，则 $\mathcal{R}_{\mathcal{V}}$ 是生成元的**多项式环**模去 null 关系诱导的理想
- 若 $\dim \mathcal{R}_{\mathcal{V}} < \infty$，则称 $\mathcal{V}$ 满足 **$C_2$ 余有限条件** ($C_2$-cofinite)，这是**有理性的必要条件**

### 2.4 示例：Virasoro VOA

生成元：应力张量 $T(z)$，$C_2$ 代数中对应 $t \equiv [L_{-2}\Omega]$。

**一般 $c$**: $\mathcal{R}_{\mathrm{Vir}} = \mathbb{C}[t]$（一元多项式环），Poisson bracket 平凡（$\{t,t\} = 0$）。

**特殊 $c$（存在 null vector）**: 若有 null vector 形如 $(L_{-2})^m\Omega + \sum_{n>2} L_{-n}(\cdots)\Omega$，则 (eq. 2.32)：

$$
\mathcal{R}_{\mathrm{Vir}} = \mathbb{C}[t] / \langle t^m \rangle
$$

此时 $\dim\mathcal{R}_{\mathrm{Vir}} = m$，VOA 满足 $C_2$ 余有限条件。

**例**: $(2,5)$ Virasoro 极小模型（$c = -22/5$），null vector 为 $(L_{-2})^2\Omega - \frac{5}{3}L_{-4}\Omega$，故 $\mathcal{R}_{\mathrm{Vir}(2,5)} = \mathbb{C}[t]/\langle t^2 \rangle$。

---

## 3. Associated Variety

### 3.1 定义

对一般 VOA $\mathcal{V}$，Arakawa 定义 **associated variety** 为 (eq. 2.39)：

$$
X_{\mathcal{V}} := \mathrm{Spec}\,(\mathcal{R}_{\mathcal{V}})_{\mathrm{red}}
$$

其中 $(\cdot)_{\mathrm{red}}$ 表示取约化（模去幂零根 nilradical）。


### 3.2 Quasi-lisse VOA

若强有限生成的 VOA 的 associated variety（视为 Poisson 簇）只有有限多个辛叶 (symplectic leaves)，则称该 VOA 为 **quasi-lisse**。



