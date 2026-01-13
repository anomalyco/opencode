/**
 * ============================================================================
 * 文件名：rpc.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * Worker RPC（远程过程调用）模块。基于 Web Worker 的 JSON-RPC 实现。
 *
 * 主要功能：
 * - listen()：在 Worker 中注册 RPC 处理器
 * - emit()：向 Worker 发送事件消息
 * - client()：创建 RPC 客户端代理
 * - 支持请求-响应模式和事件模式
 * - 类型安全的远程方法调用
 *
 * 依赖关系：
 * - Web Worker API：postMessage, onmessage
 * - JSON：序列化消息
 *
 * 导出内容：
 * - Rpc namespace：RPC 命名空间
 *   - listen(rpc)：注册 RPC 处理器
 *   - emit(event, data)：发送事件
 *   - client(target)：创建 RPC 客户端
 *
 * 消息类型：
 * - rpc.request：客户端发起的远程方法调用
 * - rpc.result：服务端返回的方法执行结果
 * - rpc.event：服务端推送的事件通知
 *
 * 使用场景：
 * - 主线程与 Worker 线程之间通信
 * - 跨 iframe 通信
 * - 跨 window 通信（同源）
 * - 微前端架构中的组件通信
 *
 * 使用示例：
 * ```typescript
 * // 服务端（Worker 中）
 * Rpc.listen({
 *   // 定义远程方法
 *   async add(input: { a: number; b: number }) {
 *     return input.a + input.b
 *   },
 *   async multiply(input: { x: number; y: number }) {
 *     return input.x * input.y
 *   },
 * })
 *
 * // 客户端（主线程）
 * const worker = new Worker('worker.js')
 * const rpc = Rpc.client({
 *   postMessage: (data) => worker.postMessage(data),
 *   onmessage: null,
 * })
 * worker.onmessage = (evt) => rpc.onmessage?.call(worker, evt)
 *
 * // 调用远程方法
 * const result = await rpc.call('add', { a: 1, b: 2 })
 * console.log(result)  // 3
 *
 * // 监听事件
 * rpc.on<number>('progress', (data) => {
 *   console.log('进度:', data)
 * })
 *
 * // 发送事件（从服务端）
 * Rpc.emit('progress', 50)
 * ```
 *
 * 类型安全：
 * - Definition 类型定义所有可用的远程方法
 * - client() 返回的代理保留了类型信息
 * - call() 方法自动推断参数和返回值类型
 *
 * 通信流程：
 * 1. 客户端发送 rpc.request
 * 2. 服务端接收并执行对应方法
 * 3. 服务端返回 rpc.result
 * 4. 客户端接收并 resolve Promise
 *
 * @package opencode
 * @module util/rpc
 */

/**
 * RPC 命名空间
 *
 * 提供基于 Worker 的远程过程调用功能。
 */
export namespace Rpc {
  /**
   * RPC 方法定义类型
   *
   * 定义所有可远程调用的方法。
   * 键是方法名，值是处理函数。
   *
   * @template TDefinition - 方法定义的对象类型
   *
   * 方法签名：
   * - 接收一个 input 参数（可以是任意类型）
   * - 返回一个 Promise（可以是任意类型）
   */
  type Definition = {
    [method: string]: (input: any) => any
  }

  /**
   * 注册 RPC 处理器
   *
   * 在 Worker 或接收端注册所有可远程调用的方法。
   * 当收到 rpc.request 消息时，自动调用对应的方法。
   *
   * @param rpc - 方法定义对象，键是方法名，值是处理函数
   *
   * 工作原理：
   * 1. 设置全局 onmessage 处理器
   * 2. 解析收到的 JSON 消息
   * 3. 如果是 rpc.request，调用对应方法
   * 4. 将结果序列化为 rpc.result 消息返回
   *
   * 消息格式：
   * - 请求：{ type: "rpc.request", method: string, input: any, id: number }
   * - 响应：{ type: "rpc.result", result: any, id: number }
   *
   * @example
   * ```typescript
   * // 在 Worker 中注册方法
   * Rpc.listen({
   *   async greet(input: { name: string }) {
   *     return `Hello, ${input.name}!`
   *   },
   *   async compute(input: { n: number }) {
   *     return n * n
   *   },
   * })
   * ```
   */
  export function listen(rpc: Definition) {
    // 设置全局消息处理器
    onmessage = async (evt) => {
      // 解析 JSON 消息
      const parsed = JSON.parse(evt.data)

      // 处理 RPC 请求
      if (parsed.type === "rpc.request") {
        // 调用对应的方法，传入 input 参数
        const result = await rpc[parsed.method](parsed.input)

        // 将结果序列化并发送回客户端
        postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
      }
    }
  }

  /**
   * 发送事件消息
   *
   * 从服务端向客户端推送事件通知。
   * 与 request/response 模式不同，事件不需要响应。
   *
   * @param event - 事件名称（字符串标识符）
   * @param data - 事件携带的数据（任意类型）
   *
   * 消息格式：
   * { type: "rpc.event", event: string, data: any }
   *
   * 使用场景：
   * - 进度通知
   * - 状态更新
   * - 日志输出
   * - 实时数据推送
   *
   * @example
   * ```typescript
   * // 在长时间运行的操作中报告进度
   * Rpc.emit('progress', 50)
   * Rpc.emit('progress', 75)
   * Rpc.emit('complete', { result: 'done' })
   * ```
   */
  export function emit(event: string, data: unknown) {
    // 将事件序列化并发送
    postMessage(JSON.stringify({ type: "rpc.event", event, data }))
  }

  /**
   * 创建 RPC 客户端
   *
   * 创建一个类型安全的 RPC 客户端代理，用于调用远程方法。
   *
   * @param target - 通信目标对象，需要提供 postMessage 和 onmessage
   * @returns RPC 客户端对象，包含 call() 和 on() 方法
   *
   * @template TDefinition - 远程方法的定义类型
   *
   * 返回的对象：
   * - call<Method>(method, input)：调用远程方法
   * - on<Data>(event, handler)：监听远程事件
   *
   * 工作原理：
   * 1. 为每个请求生成唯一 ID
   * 2. 将 resolve 函数存储在 pending Map 中
   * 3. 发送请求到目标
   * 4. 收到响应时，根据 ID 找到对应的 resolve 并调用
   *
   * @example
   * ```typescript
   * // 创建客户端
   * const worker = new Worker('worker.js')
   * const rpc = Rpc.client({
   *   postMessage: (data) => worker.postMessage(data),
   *   onmessage: null,
   * })
   *
   * // 设置消息转发
   * worker.onmessage = (evt) => {
   *   if (rpc.onmessage) {
   *     rpc.onmessage.call(worker, evt)
   *   }
   * }
   *
   * // 调用远程方法（类型安全）
   * const result = await rpc.call('add', { a: 1, b: 2 })
   *
   * // 监听事件
   * const unsubscribe = rpc.on('log', (message) => {
   *   console.log('收到日志:', message)
   * })
   *
   * // 取消监听
   * unsubscribe()
   * ```
   */
  export function client<T extends Definition>(target: {
    postMessage: (data: string) => void | null
    onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
  }) {
    // 存储待处理的请求（ID -> resolve 函数）
    const pending = new Map<number, (result: any) => void>()

    // 存储事件监听器（事件名 -> 处理函数集合）
    const listeners = new Map<string, Set<(data: any) => void>>()

    // 请求 ID 计数器（确保每个请求有唯一 ID）
    let id = 0

    // 设置消息接收处理器
    target.onmessage = async (evt) => {
      // 解析 JSON 消息
      const parsed = JSON.parse(evt.data)

      // 处理 RPC 响应
      if (parsed.type === "rpc.result") {
        // 根据 ID 找到对应的 resolve 函数
        const resolve = pending.get(parsed.id)
        if (resolve) {
          // 调用 resolve，传递结果
          resolve(parsed.result)
          // 从 pending 中移除已处理的请求
          pending.delete(parsed.id)
        }
      }

      // 处理事件推送
      if (parsed.type === "rpc.event") {
        // 找到该事件的所有监听器
        const handlers = listeners.get(parsed.event)
        if (handlers) {
          // 调用所有监听器
          for (const handler of handlers) {
            handler(parsed.data)
          }
        }
      }
    }

    // 返回 RPC 客户端对象
    return {
      /**
       * 调用远程方法
       *
       * @param method - 方法名（必须是 Definition 中的键）
       * @param input - 方法参数（类型由 Definition 定义）
       * @returns Promise，解析为方法返回值
       *
       * @template Method - 方法名的字面量类型
       *
       * 类型推断：
       * - Parameters<T[Method]>[0]：推断 input 参数类型
       * - ReturnType<T[Method]>：推断返回值类型
       */
      call<Method extends keyof T>(
        method: Method,
        input: Parameters<T[Method]>[0]
      ): Promise<ReturnType<T[Method]>> {
        // 生成唯一的请求 ID
        const requestId = id++

        // 创建 Promise 并存储 resolve 函数
        return new Promise((resolve) => {
          pending.set(requestId, resolve)

          // 发送请求消息
          target.postMessage(
            JSON.stringify({ type: "rpc.request", method, input, id: requestId })
          )
        })
      },

      /**
       * 监听远程事件
       *
       * @param event - 事件名称
       * @param handler - 事件处理函数
       * @returns 取消监听函数
       *
       * @template Data - 事件数据的类型
       *
       * 返回的函数调用后可以取消监听。
       */
      on<Data>(event: string, handler: (data: Data) => void) {
        // 获取或创建该事件的监听器集合
        let handlers = listeners.get(event)
        if (!handlers) {
          handlers = new Set()
          listeners.set(event, handlers)
        }

        // 添加监听器
        handlers.add(handler)

        // 返回取消监听函数
        return () => {
          handlers!.delete(handler)
        }
      },
    }
  }
}
