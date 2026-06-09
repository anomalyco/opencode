# VOA.wls 固定权重算符空间与关系搜索

本文件说明 [VOA.wls](scripts/VOA.wls) 中用于枚举固定 conformal weight 算符、构造候选基底、以及搜索线性关系的函数。

---

## 基本约定

脚本使用全局 `generators` 和权重函数 `h[...]`：

```wolfram
generators = {T, J, W};
h[T] = 2;
h[J] = 1;
h[W] = 3;
```

固定权重空间中的基本 letter 形如：

```wolfram
Derivative[k][g]
```

其权重按脚本逻辑理解为：

$$
h(\partial^k g) = h(g) + k
$$

正规序复合算符由 `NO[...]` 表示。

---

## `ListLettersAtWeight`: 枚举单个 letter

接口：

```wolfram
ListLettersAtWeight[n, generators_: generators]
```

它遍历 `generators` 中的每个生成元 `g`，若 `n - h[g]` 是非负整数，就输出：

```wolfram
Derivative[n - h[g]][g]
```

否则该生成元不贡献 letter。

示意：若 `h[T] = 2`，则：

```wolfram
ListLettersAtWeight[2, {T}]
```

包含 `Derivative[0][T]`；

```wolfram
ListLettersAtWeight[4, {T}]
```

包含 `Derivative[2][T]`。

脚本还设置：

```wolfram
LettersAtWeight[0] = {};
```

这表示权重 $0$ 不产生普通 letter。

---

## `ListOpsAtPartition`: 对权重分拆生成正规序算符

接口：

```wolfram
ListOpsAtPartition[partition_List, generators_: generators]
```

例如 `partition = {1, 2}` 时，函数会：

1. 对每个权重片段调用 `LettersAtWeight[part]`；
2. 用 `Outer` 取所有组合；
3. 把组合包装成 `NO[...]`；
4. 用 `SortBy[..., OPEPosition]` 按底层 OPE 声明顺序排序；
5. 删除重复项和 `0`。

这一步保证复合算符有稳定的正规序表示，避免同一组合因顺序不同重复出现。

源码中这一段调用的是 `LettersAtWeight[part]`，而公开枚举函数名是 `ListLettersAtWeight[n, generators]`，并且文件里只显式设置了 `LettersAtWeight[0] = {}`。如果运行时没有在别处给 `LettersAtWeight[n]` 定义规则，需要先确认这里是否应当补一个别名，例如让 `LettersAtWeight[n_]` 转发到 `ListLettersAtWeight[n]`。

一个最小的运行时补法可以写成：

```wolfram
LettersAtWeight[n_] := ListLettersAtWeight[n]
```

如果要使用非全局生成元列表，则需要把第二个参数也纳入你的封装。本文按脚本意图说明固定权重枚举流程，但实际计算时应检查这个符号是否已经在加载链中定义。

---

## `ListOpsAtWeight`: 枚举总权重为 `n` 的候选算符

接口：

```wolfram
ListOpsAtWeight[n, generators_: generators]
```

实现方式：

```wolfram
Table[
  ListOpsAtPartition[partition],
  {partition, 1/2 IntegerPartitions[2 n]}
] // Flatten
```

因为它对 `2 n` 做整数分拆再除以 $2$，所以可以自然处理半整数权重。例如 $n = 5/2$ 时，会枚举由半整数权重 letter 组成的正规序表达式。

### 使用示例

```wolfram
generators = {T, J, G};
h[T] = 2;
h[J] = 1;
h[G] = 3/2;

ListOpsAtWeight[3]
ListOpsAtWeight[5/2]
```

这些输出常用于：

- 给 `CheckStrongClosure` 提供候选右端项；
- 给 `ListRelations` 提供待检查的同权重表达式列表；
- 手动构造 ansatz。

---

## `ListRelations`: 搜索线性关系

脚本定义了两个版本：

```wolfram
ListRelations[ops_List]
ListRelations[ops_List, realization_]
```

### 带 realization 的版本

更常用的是：

```wolfram
ListRelations[ops, realization]
```

它构造线性组合：

```wolfram
linearCombination = Array[$a, Length[ops]] . ops;
```

然后代入 realization：

```wolfram
linearCombinationRealized = linearCombination //. realization
```

接着按 `NO[_, _]`、生成元、自由场及其导数收集系数，并求解所有系数同时为零的线性方程。若有解，返回线性关系表达式列表。

### 使用骨架

```wolfram
ops = ListOpsAtWeight[3];

realization = {
  T -> (* free-field expression *),
  J -> (* free-field expression *)
};

relations = ListRelations[ops, realization];
```

结果中的每一项是一个线性组合，表示在给定 realization 下为零的关系。它可以用于找 null relation 或删除冗余候选。

### 不带 realization 的版本

```wolfram
ListRelations[ops]
```

这个版本的实现内部重新设置：

```wolfram
ops = ListOpsAtWeight[3] // OPESimplify;
```

也就是说，它会忽略传入的 `ops`，固定检查权重 $3$ 的空间。使用时要注意这一点；如果要检查指定列表，优先使用带 `realization` 的版本，或者先修改源码中的这行固定赋值。

---

## 与 `CheckStrongClosure` 的关系

`CheckStrongClosure` 对每个 OPE 极点构造：

```wolfram
candidates = ListOpsAtWeight[h[A] + h[B] - n]
```

因此固定权重算符枚举是强闭合检查的基础。如果 `ListOpsAtWeight` 给出的空间缺少某些生成元或导数，闭合检查就会失败。

实际工作中通常按以下顺序处理：

1. 定义 `generators` 和 `h[...]`；
2. 用 `ListOpsAtWeight[targetWeight]` 查看候选空间；
3. 用 `ListRelations[ops, realization]` 找出 realization 下的零关系；
4. 用 `CheckStrongClosure` 检查 OPE 极点是否可以写成抽象候选空间中的线性组合。

---

## 常见问题

### 1. 为什么输出里有 `Derivative[0][T]`？

脚本直接用 `Derivative[n - h[g]][g]` 表示 letter。当 $n = h[g]$ 时得到 `Derivative[0][g]`。底层显示或进一步化简可能会把它视作 `g`。

### 2. 为什么需要 `OPEPosition`？

正规序积在底层 OPE 系统中有标准排序。`OPEPosition` 用来按声明顺序排序，避免 `NO[A, B]` 和 `NO[B, A]` 同时作为不同候选出现。

### 3. 有非正权重生成元怎么办？

`ListOpsAtWeight` 本身按分拆枚举候选。如果存在非正权重生成元，固定权重空间可能变得无限，需要额外约束出现次数或手工筛选候选。这个脚本没有在 `ListOpsAtWeight` 中提供出现次数上限参数。

### 4. 关系搜索为什么没有找到预期 null relation？

常见原因包括：

- `realization` 没有完全代入；
- 表达式没有经过需要的 Lie 代数化简或 OPE 化简；
- `freefields`、`generators` 等全局列表没有覆盖所有被收集的基本对象；
- 目标关系不在传入 `ops` 的线性张成空间中。
- 不带 `realization` 的版本固定改用 `ListOpsAtWeight[3]`，导致你以为传入的 `ops` 实际没有参与计算。
