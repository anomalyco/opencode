# OPEdefs 源码模块 3: OPE 计算引擎

**源文件**: `computations/OPEdefs.wls`
**行范围**: 815-1188

## 概览

本模块实现了 OPE 的核心计算规则，包括线性性、导数处理、交换关系和复合算子的 OPE 展开。同时提供量子 OPE 和经典 Poisson bracket 两种计算模式。

## 功能块

### MaxPole (行 838-848)

- `MaxPole[OPEData[A_List]]` — 返回最高阶极点阶数（= 列表长度）

### OPE 主规则 (行 852-903)

规则按优先级依次匹配：

1. `OPE[..., 0, ...]` — 含零算子的 OPE 为空
2. `OPE[..., b_Plus, ...]` — **线性性**：对求和分配
3. `OPE[..., s_ B_, ...]` — **线性性**：系数提出
4. `OPE[Derivative[i_][A_], B_]` — **左导数规则** $[\partial^i A, B]_q = (-1)^i \binom{q+i-1}{i} [AB]_q$ → 调用 `OPEDerivativeHelpL`
5. `OPE[A_, Derivative[i_][B_]]` — **右导数规则** → 调用 `OPEDerivativeHelpR`
6. `OPE[A_, NO[B_,C_]]` — **右复合** → 调用 `OPECompositeHelpR`（通过 `CallAndSave`）
7. `OPE[NO[A_,B_], C_]` — **左复合** → 调用 `OPECompositeHelpL`（仅当 B 非复合时）
8. `OPE[B_, A_]` — **交换** → 调用 `OPECommuteHelp`（当 B 是 NO 或 A < B 时）
9. `OPE[_, _] = OPEData[{}]` — 未定义的 OPE 视为正则

### 通用辅助函数 (行 906-993)

#### 导数辅助

- `OPEDerivativeHelpL[A, B, i]` — 实现公式 $[\partial^i A, B]_q = (-1)^i (q)_i [AB]_q$，使用 `Pochhammer`
- `OPEDerivativeHelpR[A, B, i]` — 实现 $[A, \partial^i B]_q$ 的递推关系，需逐阶求导

#### 交换辅助

- `OPECommuteHelp[B, A]` — 已知 `OPE[A,B]`，计算 `OPE[B,A]`：

$$[BA]_q = \text{sign} \sum_{l \geq q} \frac{(-1)^l}{(l-q)!} \partial^{l-q} [AB]_l$$

### 量子情形：复合算子辅助 (行 996-1111)

#### OPE[A, NO[B,C]] (行 1004-1043)

`OPECompositeHelpRQ` — 计算 $[A, [BC]_0]$ 的所有极点：

$$[A[BC]_0]_q = (-1)^{|A||B|} [B[AC]_q]_0 + [[AB]_q C]_0 + \sum_l \binom{q-1}{l} [[AB]_{q-l} C]_l$$

包含 `Clear` 和 `Redefine` 函数对，用于缓存管理。

#### OPE[NO[A,B], C] (行 1050-1111)

`OPECompositeHelpLQ` — 计算 $[[AB]_0, C]$ 的所有极点，基于公式 (18)/(19)。

### 经典情形 (Poisson bracket)：复合算子辅助 (行 1115-1188)

`OPECompositeHelpRPB` / `OPECompositeHelpLPB` — 经典版本：去掉多重收缩项（仅保留单收缩），正规序变为 graded-commutative 且 associative。

## 调用关系

```
OPE[A, B]
  ├─ OPEDerivativeHelpL/R  (导数)
  ├─ OPECommuteHelp         (交换)
  ├─ CallAndSave → OPECompositeHelpR/L  (复合)
  │   ├─ OPECompositeHelpRQ / RPB  (量子/经典 右复合)
  │   └─ OPECompositeHelpLQ / LPB  (量子/经典 左复合)
  └─ OPEData[{}]  (默认: 正则)
```
