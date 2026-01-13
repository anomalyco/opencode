/**
 * ============================================================================
 * 文件名：components.tsx
 * 所属包：packages/console/mail/emails
 * ============================================================================
 *
 * 文件作用：
 * 定义邮件模板的可复用组件。
 * 提供文本、字体、HTML 元素等基础组件的封装。
 *
 * 主要功能：
 * - 封装基础 HTML 元素（Text、A、Span、Wbr）
 * - 定义邮件字体配置（Fonts）
 * - 提供文本分割功能（SplitString）
 *
 * 依赖关系：
 * - react：JSX 支持
 * - @jsx-email/all：邮件组件库
 * - ./styles：基础样式
 *
 * 导出内容：
 * - Text：文本组件
 * - Title：标题组件
 * - A：链接组件
 * - Span：span 元素组件
 * - Wbr：换行机会组件
 * - Fonts：字体配置组件
 * - SplitString：文本分割组件
 *
 * 使用场景：
 * - 邮件模板构建
 * - 保持邮件组件一致性
 *
 * @package console.mail
 * @module components
 */

// 禁用 TypeScript 类型检查
// JSX Email 组件的类型定义不完整，需要禁用检查
// @ts-nocheck

// 导入 React
// 用于创建 JSX 元素
import React from "react"

// 从 jsx-email 导入邮件组件
// Font：字体配置组件
// Text (JEText)：文本组件
// TextProps：文本组件的 Props 类型
import { Font, Text as JEText, type TextProps } from "@jsx-email/all"

// 导入基础文本样式
// 所有文本组件都使用这个基础样式
import { baseText } from "./styles"

/**
 * Text 组件
 *
 * 封装 jsx-email 的 Text 组件，自动应用基础文本样式。
 *
 * @param props - Text 组件的 props，包括 style 等
 * @returns 带有基础样式的文本元素
 *
 * 使用方式：
 * ```jsx
 * <Text style={{ color: 'red' }}>Hello</Text>
 * ```
 */
export function Text(props: TextProps) {
  // 合并基础样式和传入的样式
  // 使用展开运算符，传入的样式会覆盖基础样式
  return <JEText {...props} style={{ ...baseText, ...props.style }} />
}

/**
 * Title 组件
 *
 * 创建 HTML <title> 元素，用于邮件标题。
 *
 * @param props.children - 标题文本内容
 * @returns title 元素
 */
export function Title({ children }: TitleProps) {
  // 创建 title 元素
  // React.createElement 第一个参数是元素类型，第二个是 props，第三个是子元素
  return React.createElement("title", null, children)
}

/**
 * A 组件
 *
 * 创建 HTML <a> 链接元素。
 *
 * @param props.children - 链接内容
 * @param props - 链接属性（href、target 等）
 * @returns a 元素
 */
export function A({ children, ...props }: AProps) {
  // 创建 a 元素，传入所有 props
  return React.createElement("a", props, children)
}

/**
 * Span 组件
 *
 * 创建 HTML <span> 元素，用于文本内联样式。
 *
 * @param props.children - span 内容
 * @param props - span 属性（style、class 等）
 * @returns span 元素
 */
export function Span({ children, ...props }: SpanProps) {
  // 创建 span 元素
  return React.createElement("span", props, children)
}

/**
 * Wbr 组件
 *
 * 创建 HTML <wbr> 元素（Word Break Opportunity）。
 * 表示浏览器可以在该位置换行，用于控制长文本的换行。
 *
 * @param props.children - 内容（通常为空）
 * @param props - wbr 属性
 * @returns wbr 元素
 */
export function Wbr({ children, ...props }: WbrProps) {
  // 创建 wbr 元素
  return React.createElement("wbr", props, children)
}

/**
 * Fonts 组件
 *
 * 配置邮件使用的 Web 字体。
 *
 * @param props.assetsUrl - 静态资源 URL 基础路径
 * @returns Font 组件集合
 *
 * 字体说明：
 * - JetBrains Mono (400, 500)：等宽代码字体，用于正文
 * - Rubik (400-700)：无衬线字体，用于 UI 元素
 */
export function Fonts({ assetsUrl }: { assetsUrl: string }) {
  return (
    <>
      {/* JetBrains Mono Regular (400) */}
      {/* 用于正文内容 */}
      <Font
        fontFamily="JetBrains Mono"
        fallbackFontFamily="monospace"
        webFont={{
          // 字体文件 URL
          url: `${assetsUrl}/JetBrainsMono-Regular.woff2`,
          // 字体格式为 WOFF2，压缩率高
          format: "woff2",
        }}
        fontWeight="400"
        fontStyle="normal"
      />
      {/* JetBrains Mono Medium (500) */}
      {/* 用于强调文本和标题 */}
      <Font
        fontFamily="JetBrains Mono"
        fallbackFontFamily="monospace"
        webFont={{
          url: `${assetsUrl}/JetBrainsMono-Medium.woff2`,
          format: "woff2",
        }}
        fontWeight="500"
        fontStyle="normal"
      />
      {/* Rubik Variable Font (400-700) */}
      {/* 可变字体，支持多个字重，用于 UI 元素 */}
      <Font
        fontFamily="Rubik"
        // 回退字体栈：Helvetica -> Arial -> 系统无衬线字体
        fallbackFontFamily={["Helvetica", "Arial", "sans-serif"]}
        webFont={{
          url: `${assetsUrl}/rubik-latin.woff2`,
          format: "woff2",
        }}
        // 可变字体支持的字重范围
        fontWeight="400 500 600 700"
        fontStyle="normal"
      />
    </>
  )
}

/**
 * SplitString 组件
 *
 * 将长字符串分割成多个片段，并在每个片段后添加换行机会。
 * 用于防止邮件中长 URL 或连续文本被错误截断。
 *
 * @param props.text - 要分割的文本
 * @param props.split - 每个片段的字符数
 * @returns 分割后的文本片段和 wbr 元素
 *
 * 使用场景：
 * - 长 URL 换行
 * - 邮箱地址换行
 * - 防止文本溢出
 *
 * @example
 * ```jsx
 * <SplitString text="https://example.com/very/long/url" split={20} />
 * // 结果：https://example.com/<wbr>very/long/<wbr>url
 * ```
 */
export function SplitString({ text, split }: { text: string; split: number }) {
  // 存储分割后的片段和 wbr 元素
  const segments: JSX.Element[] = []

  // 遍历文本，按指定长度分割
  for (let i = 0; i < text.length; i += split) {
    // 添加当前片段（从 i 到 i + split）
    segments.push(<>{text.slice(i, i + split)}</>)

    // 如果不是最后一段，添加 wbr 元素
    // wbr 表示浏览器可以在此处换行
    if (i + split < text.length) {
      segments.push(<Wbr key={`${i}wbr`} />)
    }
  }

  // 返回所有片段
  return <>{segments}</>
}
