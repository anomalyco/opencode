/**
 * ============================================================================
 * 文件名：styles.ts
 * 所属包：packages/console/mail/emails
 * ============================================================================
 *
 * 文件作用：
 * 定义邮件模板的样式配置。
 * 提供统一的颜色、字体、间距等设计规范。
 *
 * 主要功能：
 * - 定义设计系统的颜色常量
 * - 定义邮件布局样式
 * - 定义文本样式（标题、内容、按钮、链接）
 * - 定义组件样式（容器、框架、按钮）
 *
 * 依赖关系：
 * - 无外部依赖，纯样式配置
 *
 * 导出内容：
 * - unit：基础单位
 * - PRIMARY_COLOR、TEXT_COLOR、LINK_COLOR 等：颜色常量
 * - body、container、frame：布局样式
 * - baseText、headingText、contentText：文本样式
 * - button、buttonText、linkText：交互元素样式
 *
 * 使用场景：
 * - 邮件模板组件使用
 * - 保持邮件样式一致性
 *
 * @package console.mail
 * @module styles
 */

// 禁用 TypeScript 类型检查
// 这是一个样式文件，包含动态样式对象，不需要严格的类型检查
// @ts-nocheck

/**
 * 基础单位
 *
 * 所有间距和尺寸都基于这个单位计算。
 * 1 unit = 12px
 */
export const unit = 12

/**
 * 主色调
 *
 * 用于品牌标识、重要文本、按钮背景等。
 * 深灰色，给人专业、可靠的感觉。
 */
export const PRIMARY_COLOR = "#211E1E"

/**
 * 文本颜色
 *
 * 用于正文内容。
 * 中灰色，保证可读性。
 */
export const TEXT_COLOR = "#656363"

/**
 * 链接颜色
 *
 * 用于链接文本。
 * 蓝色，符合用户对链接的认知。
 */
export const LINK_COLOR = "#007AFF"

/**
 * 链接背景色
 *
 * 用于链接按钮的背景。
 * 浅灰色，突出链接区域。
 */
export const LINK_BACKGROUND_COLOR = "#F9F8F8"

/**
 * 页面背景色
 *
 * 用于邮件整体的背景。
 * 浅灰色，与白色内容区域形成对比。
 */
export const BACKGROUND_COLOR = "#F0F0F1"

/**
 * 分割线和边框颜色
 *
 * 用于边框、分割线等。
 */
export const SURFACE_DIVIDER_COLOR = "#D5D5D9"

/**
 * Body 样式
 *
 * 邮件主体的背景样式。
 */
export const body = {
  // 背景色使用浅灰色
  background: BACKGROUND_COLOR,
}

/**
 * 容器样式
 *
 * 邮件内容的主容器，控制最小宽度和内边距。
 */
export const container = {
  // 最小宽度确保在桌面端显示正常
  minWidth: "600px",
  // 上下 64px 内边距，左右无内边距
  padding: "64px 0px",
}

/**
 * 框架样式
 *
 * 邮件内容的白色卡片框架，包含边框、阴影、圆角。
 */
export const frame = {
  // 内边距：2 个单位（24px）
  padding: `${unit * 2}px`,
  // 1px 实线边框
  border: `1px solid ${SURFACE_DIVIDER_COLOR}`,
  // 白色背景
  background: "#FFF",
  // 6px 圆角，现代化设计
  borderRadius: "6px",
  // 多层阴影，营造深度感
  // 使用三层不同模糊半径的阴影，产生柔和的阴影效果
  boxShadow: `0 1px 2px rgba(0,0,0,0.03),
              0 2px 4px rgba(0,0,0,0.03),
              0 2px 6px rgba(0,0,0,0.03)`,
}

/**
 * 基础文本样式
 *
 * 所有文本的默认字体设置。
 */
export const baseText = {
  // 使用 JetBrains Mono 等宽字体
  // 符合代码工具的专业定位
  fontFamily: "JetBrains Mono, monospace",
}

/**
 * 标题文本样式
 *
 * 用于邮件中的标题和重要文本。
 */
export const headingText = {
  // 使用主色调
  color: PRIMARY_COLOR,
  // 16px 字号
  fontSize: "16px",
  // 正常字体样式
  fontStyle: "normal",
  // 500 字重，中等粗细
  fontWeight: 500,
  // 正常行高
  lineHeight: "normal",
}

/**
 * 内容文本样式
 *
 * 用于邮件正文内容。
 */
export const contentText = {
  // 使用文本颜色
  color: TEXT_COLOR,
  // 14px 字号
  fontSize: "14px",
  // 正常字体样式
  fontStyle: "normal",
  // 400 字重，正常粗细
  fontWeight: 400,
  // 180% 行高，提高可读性
  lineHeight: "180%",
}

/**
 * 按钮文本样式
 *
 * 按钮内的文本样式。
 */
export const buttonText = {
  // 白色文本，与深色按钮形成对比
  color: "#FDFCFC",
  // 16px 字号
  fontSize: "16px",
  // 500 字重，中等粗细
  fontWeight: 500,
  // 清除默认外边距
  margin: 0,
  // 清除默认内边距
  padding: 0,
  // 使用 inline-flex 布局
  display: "inline-flex",
  // 垂直居中对齐
  alignItems: "center",
  // 元素之间 12px 间距
  gap: "12px",
}

/**
 * 链接文本样式
 *
 * 链接按钮的样式。
 */
export const linkText = {
  // 使用链接颜色
  color: LINK_COLOR,
  // 14px 字号
  fontSize: "14px",
  // 正常字体样式
  fontStyle: "normal",
  // 400 字重
  fontWeight: 400,
  // 150% 行高
  lineHeight: "150%",
  // 下划线装饰
  textDecorationLine: "underline",
  // 实线样式
  textDecorationStyle: "solid" as const,
  // 自动跳过墨水（下划线不穿过字符降部）
  textDecorationSkipInk: "auto" as const,
  // 自动下划线粗细
  textDecorationThickness: "auto",
  // 自动下划线偏移
  textUnderlineOffset: "auto",
  // 下划线位置基于字体
  textUnderlinePosition: "from-font",
  // 4px 圆角
  borderRadius: "4px",
  // 浅灰背景
  background: LINK_BACKGROUND_COLOR,
  // 8px 上下、12px 左右内边距
  padding: "8px 12px",
  // 文本居中
  textAlign: "center" as const,
}

/**
 * 内容高亮文本样式
 *
 * 用于强调重要信息（如人名、工作区名）。
 */
export const contentHighlightText = {
  // 使用主色调突出显示
  color: PRIMARY_COLOR,
}

/**
 * 按钮样式
 *
 * 可点击按钮的容器样式。
 */
export const button = {
  // 使用 inline-grid 布局
  display: "inline-grid",
  // 上 8px、左右 12px、下 8px 内边距
  padding: "8px 12px 8px 20px",
  // 内容居中对齐
  justifyContent: "center",
  // 垂直居中对齐
  alignItems: "center",
  // 元素之间 8px 间距
  gap: "8px",
  // 不允许收缩
  flexShrink: "0",
  // 4px 圆角
  borderRadius: "4px",
  // 使用主色调作为背景
  backgroundColor: PRIMARY_COLOR,
}
