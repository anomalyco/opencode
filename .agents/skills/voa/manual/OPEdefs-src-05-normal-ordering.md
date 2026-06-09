# OPEdefs 源码模块 5: 正规序 (Normal Ordering)

**源文件**: `computations/OPEdefs.wls`
**行范围**: 1434-1656

## 概览

本模块实现正规序积 `NO[A, B]` 的化简规则。目标是将所有正规序积化为**标准形式**：从右到左嵌套，算子按声明顺序排列，高阶导数在左（默认）。

## 功能块

### NO 与算子系统的关系 (行 1453-1482)

- `OperatorQ[_NO] = True` — 正规序积是算子
- `BosonQ[NO[A_,B_]]` — XOR 判定：两玻色/两费米 → 玻色
- `OPEParity[NO[A_,B_]]` — 宇称相加

#### NOOrder (导数排序)

- `NOOrder[A, B]` — 类似 `OPEOrder`，但额外处理同一算子不同导数的排序
- `NOOrderHelp` — 剥离导数后比较
- `NOOrderingValue` — 全局变量控制导数排序方向（默认 `-1`，高阶导数在左）

### NO 主规则 (行 1486-1546)

1. `NO[A, B, C, ...]` → `NO[A, NO[B, C, ...]]` — 多参数展开为右嵌套
2. `NO[0, _] = 0` / `NO[_, 0] = 0` — 含零
3. 线性性（和式分配，系数提出）
4. `NO[NO[A,B], NO[C,D]]` — 双复合：根据 `NOOrder[A,C]` 选择展开方向
5. `NO[NO[A,B], C]` — 左复合：A > C 时展开（否则交换）
6. `NO[B, NO[A,C]]` — 右复合：A > B 时展开
7. `NO[A, NO[A,C]]` (A 费米) — 特殊情况：$= \frac{1}{2} [\text{commutator}, C]_0$
8. `NO[A, A]` (A 费米) — $= \frac{1}{2} [AA]_{\text{commutator}}$
9. `NO[B, A]` (A < B) — 交换：$[BA]_0 = (-1)^{|A||B|} [AB]_0 - (-1)^{|A||B|} \text{commutator}$
10. `Derivative[i][NO[A,B]]` — 正规序积求导 → `NODerivativeHelp`

### 通用辅助函数 (行 1550-1562)

- `NODerivativeHelp[i, A, B]` — Leibniz 规则：

$$\partial^i [AB]_0 = \sum_{j=0}^{i} \binom{i}{j} [\partial^j A, \partial^{i-j} B]_0$$

### 量子情形辅助 (行 1565-1631)

#### NOCommuteHelpQ (行 1579-1587)

正规序交换子：$[AB]_0 - (-1)^{|A||B|} [BA]_0$

$$= -\sum_{m \geq 1} \frac{(-1)^m}{m!} \partial^m [AB]_m$$

#### NOCompositeHelpRQ (行 1599-1607)

`NO[B, NO[A,C]]` 当 A > B 时：

$$= (-1)^{|A||B|} [A [BC]_0]_0 + [\text{commutator}(B,A), C]_0$$

#### NOCompositeHelpLQ (行 1611-1631)

`NO[NO[A,B], C]` 的标准化：

$$= [A [BC]_0]_0 + \sum_{l>0} \frac{1}{l!} [\partial^l A [BC]_l]_0 + (-1)^{|A||B|} \sum_{l>0} \frac{1}{l!} [\partial^l B [AC]_l]_0$$

### 经典情形辅助 (行 1634-1656)

- `NOCommuteHelpPB[A_, B_] = 0` — 经典情形交换子为零
- `NOCompositeHelpRPB` — graded-commutative：仅交换符号
- `NOCompositeHelpLPB` — associative：直接重新嵌套
