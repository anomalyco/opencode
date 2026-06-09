# BMR Appendix A 摘录: OPE 与 VOA 通用公式

**来源**: Bonetti, Meneghelli, Rastelli, "VOAs labelled by complex reflection groups and 4d SCFTs", Appendix A.

---

## 1. OPE 记号

$$
A(z_1)\, B(z_2) = \sum_{n \in \mathbb{Z}} \frac{\{AB\}_n(z_2)}{z_{12}^n}, \quad z_{12} := z_1 - z_2
\tag{A.1}
$$

## 2. $\mathfrak{sl}(2)_z$ 准初级场 (quasi-primary)

准初级场 $\mathcal{O}$ 在全局共形群 $SL(2)_z$ 下张量变换：

$$
\mathcal{O}'(z') = \left(\frac{\partial z'}{\partial z}\right)^{-h_{\mathcal{O}}} \mathcal{O}(z), \quad z' = \frac{az+b}{cz+d}
\tag{A.2, A.3}
$$

等价的 OPE 条件：

$$
\{T\mathcal{O}\}_3 = 0, \quad \{T\mathcal{O}\}_2 = h_{\mathcal{O}}\,\mathcal{O}, \quad \{T\mathcal{O}\}_1 = \partial\mathcal{O}
\tag{A.4}
$$

## 3. 准初级场 OPE 的 $\mathfrak{sl}(2)_z$ 协变形式

两个准初级场 $\mathcal{O}_1$, $\mathcal{O}_2$（维数 $h_1$, $h_2$）的 OPE：

$$
\mathcal{O}_1(z_1)\,\mathcal{O}_2(z_2) = \sum_{\mathcal{O} \in B_h} \lambda_{\mathcal{O}_1\mathcal{O}_2}^{\mathcal{O}} \frac{1}{z_{12}^{h_1+h_2-h}} \mathcal{D}_{h_1,h_2;h}(z_{12}, \partial_{z_2})\,\mathcal{O}(z_2)
\tag{A.5}
$$

其中 $B_h$ 是维数 $h$ 的准初级场基，$\lambda$ 是 OPE 系数，微分算子为：

$$
\mathcal{D}_{h_1,h_2;h}(z_{12}, \partial_{z_2}) = \sum_{k=0}^{\infty} \frac{(h+h_1-h_2)_k}{k!\,(2h)_k}\, z_{12}^k\, \partial_{z_2}^k
\tag{A.6}
$$

$(x)_k = \prod_{i=0}^{k-1}(x+i)$ 是升 Pochhammer 符号。

## 4. 从 OPE 极点提取准初级场

$\{\mathcal{O}_1\mathcal{O}_2\}_n$ 一般**不是**准初级场。从中提取维数 $h_1+h_2-n$ 的准初级分量：

$$
(\mathcal{O}_1\mathcal{O}_2)_n(z) = \sum_{p \geq 0} \mathcal{K}_{h_1,h_2,n,p}\, \partial_z^p \{\mathcal{O}_1\mathcal{O}_2\}_{n+p}(z)
\tag{A.7}
$$

其中：

$$
\mathcal{K}_{h_1,h_2,n,p} = \frac{(-)^p\,(2h_1 - n - p)_p}{p!\,(2h_1 + 2h_2 - 2n - p - 1)_p}
\tag{A.8}
$$

用准初级分量重写完整 OPE：

$$
\mathcal{O}_1(z_1)\,\mathcal{O}_2(z_2) = \sum_n \frac{1}{z_{12}^{h_1+h_2-h}} \mathcal{D}_{h_1,h_2;h}(z_{12}, \partial_{z_2})\,(\mathcal{O}_1\mathcal{O}_2)_n(z_2)
\tag{A.9}
$$

## 5. Primary 条件层级

### 5.1 $\mathfrak{sl}(2)_z$ primary（准初级）

$$
\{T\mathcal{O}\}_3 = 0, \quad \{T\mathcal{O}\}_2 = h\,\mathcal{O}, \quad \{T\mathcal{O}\}_1 = \partial_z\mathcal{O}
\tag{A.21}
$$

### 5.2 Virasoro primary

$$
\{T\mathcal{O}\}_{n \geq 3} = 0, \quad \{T\mathcal{O}\}_2 = h\,\mathcal{O}, \quad \{T\mathcal{O}\}_1 = \partial_z\mathcal{O}
\tag{A.22}
$$

### 5.3 AKM primary（$\mathfrak{gl}(1)$ 荷 $m$，$\mathcal{N}=2$ 情形）

$$
\{\mathcal{J}\mathcal{O}\}_{n \geq 2} = 0, \quad \{\mathcal{J}\mathcal{O}\}_1 = 2m\,\mathcal{O}
\tag{A.33}
$$

### 5.4 $\mathfrak{osp}(2|2)$ primary（$\mathcal{N}=2$ 超共形初级，量子数 $(h,m)$）

$$
\{T\mathcal{O}\}_3 = 0, \quad \{T\mathcal{O}\}_2 = h\,\mathcal{O}, \quad \{T\mathcal{O}\}_1 = \partial_z\mathcal{O}
\tag{A.34}
$$

$$
\{\mathcal{J}\mathcal{O}\}_1 = 2m\,\mathcal{O}
\tag{A.35}
$$

$$
\{\mathcal{G}\,\mathcal{O}\}_2 = 0, \quad \{\widetilde{\mathcal{G}}\,\mathcal{O}\}_2 = 0
\tag{A.36}
$$

### 5.5 $\mathcal{N}=2$ super-Virasoro primary（量子数 $(h,m)$）

$$
\{T\mathcal{O}\}_{n \geq 3} = 0, \quad \{T\mathcal{O}\}_2 = h\,\mathcal{O}, \quad \{T\mathcal{O}\}_1 = \partial_z\mathcal{O}
\tag{A.37}
$$

$$
\{\mathcal{J}\mathcal{O}\}_{n \geq 2} = 0, \quad \{\mathcal{J}\mathcal{O}\}_1 = 2m\,\mathcal{O}
\tag{A.38}
$$

$$
\{\mathcal{G}\,\mathcal{O}\}_{n \geq 2} = 0, \quad \{\widetilde{\mathcal{G}}\,\mathcal{O}\}_{n \geq 2} = 0
\tag{A.39}
$$

**注**: AKM primary + $\mathfrak{osp}(2|2)$ primary $\Leftrightarrow$ $\mathcal{N}=2$ super-Virasoro primary。

## 6. $\mathcal{N}=2$ SCA 的 OPE（紧凑记号）

$$
\mathcal{J}\mathcal{J} = 2k\,\text{id}, \quad \mathcal{J}\mathcal{G} = -\mathcal{G}, \quad \mathcal{J}\widetilde{\mathcal{G}} = \widetilde{\mathcal{G}}
$$

$$
\mathcal{T}\mathcal{J} = \mathcal{J}, \quad \mathcal{T}\mathcal{G} = \tfrac{3}{2}\mathcal{G}, \quad \mathcal{T}\widetilde{\mathcal{G}} = \tfrac{3}{2}\widetilde{\mathcal{G}}
$$

$$
\mathcal{T}\mathcal{T} = 3k\,\text{id} + 2\mathcal{T}, \quad \mathcal{G}\widetilde{\mathcal{G}} = -2k\,\text{id} + \mathcal{J} - \mathcal{T}
\tag{A.20}
$$

紧凑记号中，省略了所有 $z_{12}$ 因子和 $\partial_z$、$\partial_y$ 导数项，可由 (A.5)-(A.6) 唯一重建。

## 7. $\mathcal{N}=2$ 超共形多重态

超荷作用记号：

$$
\mathcal{G} \cdot \mathcal{O} := (\mathcal{G}\mathcal{O})_1, \quad \widetilde{\mathcal{G}} \cdot \mathcal{O} := (\widetilde{\mathcal{G}}\mathcal{O})_1
\tag{A.43}
$$

从 $\mathfrak{osp}(2|2)$ primary $X$（$h > |m|$，非手征）出发，长多重态 $\mathfrak{X}_{h,m}$：

$$
X \quad \to \quad \mathcal{G}_X := \mathcal{G} \cdot X, \quad \widetilde{\mathcal{G}}_X := \widetilde{\mathcal{G}} \cdot X \quad \to \quad \mathcal{T}_X := -\mathcal{G} \cdot (\widetilde{\mathcal{G}} \cdot X)
\tag{A.44}
$$

特殊情形：$h = +m$ 时 $\mathcal{G} \cdot X = 0$，得手征多重态 $\mathfrak{C}_h$（仅含 $X$ 和 $\widetilde{\mathcal{G}}_X$）；$h = -m$ 时 $\widetilde{\mathcal{G}} \cdot X = 0$，得反手征多重态 $\bar{\mathfrak{C}}_h$。

## 8. Small $\mathcal{N}=4$ SCA 的 OPE（紧凑记号）

$$
JJ = -k\,\text{id} + 2J, \quad JG = G, \quad J\widetilde{G} = \widetilde{G}
$$

$$
TJ = J, \quad TG = \tfrac{3}{2}G, \quad T\widetilde{G} = \tfrac{3}{2}\widetilde{G}
$$

$$
TT = 3k\,\text{id} + 2T, \quad G\widetilde{G} = -2k\,\text{id} + 2J - T
\tag{A.18}
$$

中心荷与级别的关系：$c = 6k$。

$\mathfrak{sl}(2)$ R-对称的 index-free 参数化：

$$
J(y) = J^+ + J^0 y + J^- y^2, \quad G(y) = G^+ + G^- y, \quad \widetilde{G}(y) = \widetilde{G}^+ + \widetilde{G}^- y
\tag{A.19}
$$

$\mathcal{N}=2$ SCA 作为 $\mathcal{N}=4$ 的子代数：$\mathcal{J} = J^0$，$\mathcal{G} = G^-$，$\widetilde{\mathcal{G}} = \widetilde{G}^+$，$\mathcal{T} = T$。

## 9. $\mathfrak{sl}(2)_y$ 自旋分解

对自旋 $j_1$, $j_2$ 的对象 $\mathcal{O}_1(y)$, $\mathcal{O}_2(y)$，任意双线性运算 $\mathcal{B}$ 的自旋 $j$ 分解：

$$
\mathcal{B}(\mathcal{O}_1(y_1), \mathcal{O}_2(y_2)) = \sum_j y_{12}^{j_1+j_2-j}\, \widehat{\mathcal{D}}_{j_1,j_2;j}(y_{12}, \partial_{y_2})\, \mathcal{B}(\mathcal{O}_1, \mathcal{O}_2)^j(y_2)
\tag{A.12}
$$

自旋求和范围：$j \in \{|j_1-j_2|, |j_1-j_2|+1, \ldots, j_1+j_2\}$。

微分算子（$\mathcal{D}_{h_1,h_2;h}$ 在 $h = -j$ 处的延拓）：

$$
\widehat{\mathcal{D}}_{j_1,j_2;j}(y_{12}, \partial_{y_2}) = \sum_{k=0}^{\infty} \frac{(-j-j_1+j_2)_k}{k!\,(-2j)_k}\, y_{12}^k\, \partial_{y_2}^k
\tag{A.14}
$$

（求和总截断为有限项。）

特例 $\widehat{D}_{1,j;j}$：

$$
\widehat{D}_{1,j;j}(y_{12}, \partial_{y_2}) = 1 + \frac{1}{2j}\, y_{12}\, \partial_{y_2}
\tag{A.31}
$$

## 10. $\mathfrak{psl}(2|2)$ 超共形多重态（$\mathcal{N}=4$）

超荷作用记号：

$$
G^{\uparrow}\mathcal{O} := (G\mathcal{O})_1^{j+\frac{1}{2}}, \quad G^{\downarrow}\mathcal{O} := (G\mathcal{O})_1^{j-\frac{1}{2}}, \quad \widetilde{G}^{\uparrow}\mathcal{O} := (\widetilde{G}\mathcal{O})_1^{j+\frac{1}{2}}, \quad \widetilde{G}^{\downarrow}\mathcal{O} := (\widetilde{G}\mathcal{O})_1^{j-\frac{1}{2}}
\tag{A.40}
$$

**短多重态** $\mathfrak{S}_h$（$h = j$）：

$$
W \quad \to \quad G_W := G^{\downarrow}W, \quad \widetilde{G}_W := \widetilde{G}^{\downarrow}W \quad \to \quad T_W := -G^{\downarrow}\widetilde{G}^{\downarrow}W
\tag{A.41}
$$

**长多重态** $\mathfrak{L}_{h,j}$（$h > j$）包含 $4(2j+1)$ 个分量，由 $G^{\uparrow,\downarrow}$ 和 $\widetilde{G}^{\uparrow,\downarrow}$ 反复作用生成，详见原文表格。

特殊情形：$j=0$ 时自旋为负的态恒等于零，且 $G^{\downarrow}\widetilde{G}^{\uparrow}X = \widetilde{G}^{\downarrow}G^{\uparrow}X$。
