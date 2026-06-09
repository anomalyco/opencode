# OPEdefs 源码模块 4: OPEPole 计算

**源文件**: `computations/OPEdefs.wls`
**行范围**: 1191-1431

## 概览

`OPEPole[n][A, B]` 直接计算 OPE 的第 $n$ 阶极点，无需计算完整 OPE。这在只需要特定极点时显著提升效率。

## 功能块

### OPEPole 主规则 (行 1206-1299)

规则按优先级匹配：

1. `OPEPole[_][..., 0, ...]` — 含零算子返回 0
2. `OPEPole[n_Integer][OPEData[A_List]]` — 从已计算的 OPE 中提取第 n 阶极点
3. `OPEPole[0][A_, B_] := NO[A, B]` — 零阶极点即正规序积
4. `OPEPole[i_][A_, B_]` (i<0) — 负阶：$[AB]_{-q} = \frac{1}{q!} [\partial^q A, B]_0$
5. 线性性规则（和式分配，系数提出）
6. `OPEPole[i][Derivative[j][A], B]` — 左导数：$(1-i)_j \cdot [AB]_{i-j}$
7. `OPEPole[j][A, Derivative[i][B]]` — 右导数：$\sum_k \binom{i}{k} (j-k)_k \partial^{i-k} [AB]_{j-k}$
8. `OPEPole[i][A, NO[B,C]]` → `OPEPoleHelpR`
9. `OPEPole[i][NO[A,B], C]` → `OPEPoleHelpL`
10. `OPEPole[i][B, A]` (A < B) — 交换 → `OPEPoleCommuteHelp`
11. `OPEPole[i][A, C]` — 回退：计算完整 OPE 再提取

### 通用辅助函数 (行 1302-1312)

- `OPEPoleCommuteHelp[q][B, A]` — 已知 `OPE[A,B]`，直接计算 $[BA]_q$：

$$[BA]_q = \text{sign} \sum_{l \geq q} \frac{(-1)^l}{(l-q)!} \partial^{l-q} [AB]_l$$

- `opepole[n][OPEData[A_List]]` — 内部版本，带越界警告

### 量子情形辅助 (行 1315-1383)

#### OPEPoleHelpRQ (右复合)

两个定义，按条件分发：

1. 当 `A` 是 NO 复合或 `OPEOrder[A,B] < 0`（即已知 `OPE[B,A]`）时，使用优化路径：

$$[A[BC]_0]_q = (-1)^{|A||B|} [B [AC]_q]_0 + (-1)^{|A||B|} \sum_l (-1)^l [[BA]_l C]_{q-l}$$

2. 通用路径（使用 `OPE[A,B]`）

#### OPEPoleHelpLQ (左复合)

$$[[AB]_0 C]_q = \sum_l \frac{1}{l!} [\partial^l A [BC]_{l+q}]_0 + (-1)^{|A||B|} \sum_l \frac{1}{l!} [\partial^l B [AC]_{l+q}]_0 + \text{交叉项}$$

### 经典情形辅助 (行 1386-1431)

- `OPEPoleHelpRPB` — 经典右复合：去掉多重收缩
- `OPEPoleHelpLPB` — 经典左复合：去掉交叉项
