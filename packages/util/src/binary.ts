/**
 * ============================================================================
 * 文件名：binary.ts
 * 所属包：packages/util
 * ============================================================================
 *
 * 文件作用：
 * 提供二分查找（Binary Search）相关的数组操作工具函数。
 * 二分查找是一种高效的搜索算法，时间复杂度为 O(log n)，远优于线性查找的 O(n)。
 * 要使用二分查找，数组必须是已排序的。
 *
 * 主要功能：
 * - 查找：在已排序数组中查找指定元素的位置
 * - 插入：在已排序数组中插入新元素并保持排序
 *
 * 依赖关系：
 * - 无外部依赖，仅使用 JavaScript 内置数组方法
 *
 * 导出内容：
 * - Binary.search：在已排序数组中查找元素
 * - Binary.insert：在已排序数组中插入元素
 *
 * 使用场景：
 * - 大型数据集的高效查找
 * - 维护排序数组的插入操作
 * - 日志时间戳查找
 * - 有序数据的快速索引
 *
 * @package util
 * @module binary
 */

/**
 * Binary 命名空间
 *
 * 包含二分查找相关的数组操作函数。
 * 使用命名空间组织相关函数，避免全局命名空间污染。
 */
export namespace Binary {
  /**
   * 二分查找函数
   *
   * 在已排序的数组中查找指定 ID 的元素。
   * 使用二分查找算法，时间复杂度为 O(log n)。
   *
   * @template T - 数组元素的类型
   * @param array - 已排序的数组，必须按照 compare 函数返回的字符串顺序排序
   * @param id - 要查找的 ID（字符串）
   * @param compare - 从元素中提取 ID 的比较函数，接收元素返回字符串 ID
   * @returns 查找结果对象：
   *          - found: 布尔值，表示是否找到匹配的元素
   *          - index: 数字，如果 found 为 true，这是匹配元素的索引
   *                          如果 found 为 false，这是应该插入的位置
   *
   * 二分查找算法：
   * 1. 初始化左右边界：left=0, right=array.length-1
   * 2. 当 left <= right 时循环：
   *    a. 计算中间位置：mid = floor((left + right) / 2)
   *    b. 获取中间元素的 ID：midId = compare(array[mid])
   *    c. 比较 midId 与目标 id：
   *       - 如果相等：找到目标，返回 { found: true, index: mid }
   *       - 如果 midId < id：目标在右半部分，left = mid + 1
   *       - 如果 midId > id：目标在左半部分，right = mid - 1
   * 3. 如果循环结束未找到，返回 { found: false, index: left }
   *    - index 是应该插入的位置，可以保持数组排序
   *
   * 时间复杂度：
   * - 最好情况：O(1)（目标在中间）
   * - 平均情况：O(log n)
   * - 最坏情况：O(log n)
   *
   * 空间复杂度：O(1)（只使用常数空间）
   *
   * 使用场景：
   * - 在大型排序数组中快速查找元素
   * - 检查元素是否存在于排序数组
   * - 为插入操作找到正确的位置
   *
   * @example
   * ```typescript
   * // 在按 ID 排序的用户数组中查找
   * const users = [
   *   { id: "alice", name: "Alice" },
   *   { id: "bob", name: "Bob" },
   *   { id: "charlie", name: "Charlie" }
   * ]
   *
   * // 查找存在的用户
   * const result1 = Binary.search(users, "bob", (user) => user.id)
   * // 返回 { found: true, index: 1 }
   *
   * // 查找不存在的用户
   * const result2 = Binary.search(users, "david", (user) => user.id)
   * // 返回 { found: false, index: 3 }
   * // index=3 表示 "david" 应该插入的位置，以保持排序
   * ```
   */
  export function search<T>(
    array: T[],           // 已排序的数组
    id: string,           // 要查找的 ID
    compare: (item: T) => string  // 从元素中提取 ID 的函数
  ): { found: boolean; index: number } {
    // 初始化左边界指针，指向数组的起始位置
    let left = 0

    // 初始化右边界指针，指向数组的最后一个元素
    let right = array.length - 1

    // 二分查找主循环
    // 当左边界不超过右边界时，继续查找
    while (left <= right) {
      // 计算中间位置
      // Math.floor 确保结果是整数
      // 使用 (left + right) / 2 而不是 >> 1，更易读
      const mid = Math.floor((left + right) / 2)

      // 获取中间元素的 ID，用于与目标 ID 比较
      const midId = compare(array[mid])

      // 比较中间元素的 ID 与目标 ID
      if (midId === id) {
        // 找到匹配的元素
        // 返回找到标志和元素索引
        return { found: true, index: mid }

      } else if (midId < id) {
        // 中间元素的 ID 小于目标 ID
        // 说明目标在右半部分，移动左边界到中间位置的右侧
        left = mid + 1

      } else {
        // 中间元素的 ID 大于目标 ID
        // 说明目标在左半部分，移动右边界到中间位置的左侧
        right = mid - 1
      }
    }

    // 循环结束，未找到匹配的元素
    // 返回未找到标志和应该插入的位置
    // index = left 是正确的插入位置，可以保持数组排序
    return { found: false, index: left }
  }

  /**
   * 二分插入函数
   *
   * 在已排序的数组中插入新元素并保持数组排序。
   * 先使用二分查找找到插入位置，然后在该位置插入元素。
   *
   * @template T - 数组元素的类型
   * @param array - 已排序的数组（会被直接修改）
   * @param item - 要插入的新元素
   * @param compare - 从元素中提取 ID 的比较函数，用于确定插入位置
   * @returns 插入后的原数组（链式调用支持）
   *
   * 插入算法：
   * 1. 提取新元素的 ID：id = compare(item)
   * 2. 使用二分查找确定插入位置：
   *    a. 初始化边界：left=0, right=array.length
   *    b. 当 left < right 时循环：
   *       - 计算中间位置：mid = floor((left + right) / 2)
   *       - 比较中间元素 ID 与新元素 ID：
   *         * 如果 midId < id：插入位置在右半部分，left = mid + 1
   *         * 否则：插入位置在左半部分（包括当前位置），right = mid
   *    c. 循环结束，left 就是插入位置
   * 3. 使用 splice 在找到的位置插入元素
   * 4. 返回修改后的数组
   *
   * 时间复杂度：
   * - 查找插入位置：O(log n)
   * - 插入元素：O(n)（需要移动后续元素）
   * - 总体：O(n)
   *
   * 空间复杂度：O(1)（原地操作）
   *
   * 使用场景：
   * - 在排序数组中添加新元素
   * - 维护动态排序集合
   * - 实时更新的有序列表
   *
   * @example
   * ```typescript
   * // 在排序的用户数组中插入新用户
   * const users = [
   *   { id: "alice", name: "Alice" },
   *   { id: "charlie", name: "Charlie" }
   * ]
   *
   * // 插入一个 ID 为 "bob" 的用户
   * Binary.insert(users, { id: "bob", name: "Bob" }, (user) => user.id)
   * // users 变为：
   * // [
   * //   { id: "alice", name: "Alice" },
   * //   { id: "bob", name: "Bob" },
   * //   { id: "charlie", name: "Charlie" }
   * // ]
   *
   * // 插入一个 ID 为 "david" 的用户
   * Binary.insert(users, { id: "david", name: "David" }, (user) => user.id)
   * // users 变为：
   * // [
   * //   { id: "alice", name: "Alice" },
   * //   { id: "bob", name: "Bob" },
   * //   { id: "charlie", name: "Charlie" },
   * //   { id: "david", name: "David" }
   * // ]
   * ```
   *
   * 注意事项：
   * - 此函数会直接修改原数组（mutating operation）
   * - 如果需要不修改原数组，应先创建副本
   * - 数组必须已排序，否则插入后不一定有序
   */
  export function insert<T>(
    array: T[],           // 已排序的数组（将被修改）
    item: T,              // 要插入的新元素
    compare: (item: T) => string  // 从元素中提取 ID 的函数
  ): T[] {
    // 提取新元素的 ID，用于确定插入位置
    const id = compare(item)

    // 初始化查找边界
    // left 从 0 开始
    // right 从 array.length 开始（注意不是 length-1）
    let left = 0
    let right = array.length

    // 二分查找确定插入位置
    // 当 left < right 时继续循环
    // 注意：这里是 < 而不是 <=，因为我们要找插入位置而非匹配元素
    while (left < right) {
      // 计算中间位置
      const mid = Math.floor((left + right) / 2)

      // 获取中间元素的 ID
      const midId = compare(array[mid])

      // 比较中间元素 ID 与新元素 ID
      if (midId < id) {
        // 中间元素的 ID 小于新元素 ID
        // 新元素应该在右半部分
        // 移动左边界到 mid + 1
        left = mid + 1

      } else {
        // 中间元素的 ID 大于或等于新元素 ID
        // 新元素应该在左半部分或在当前位置
        // 移动右边界到 mid（不是 mid - 1，因为 mid 可能就是插入位置）
        right = mid
      }
    }

    // 循环结束，left 就是正确的插入位置
    // 使用 splice 在该位置插入新元素
    // splice 的参数：
    // - left：插入位置的索引
    // - 0：删除 0 个元素（不删除，只插入）
    // - item：要插入的元素
    array.splice(left, 0, item)

    // 返回修改后的数组，支持链式调用
    return array
  }
}
