/**
 * ============================================================================
 * 文件名：InviteEmail.tsx
 * 所属包：packages/console/mail/emails/templates
 * ============================================================================
 *
 * 文件作用：
 * 工作区邀请邮件模板。
 * 当用户被邀请加入 OpenCode 工作区时发送此邮件。
 *
 * 主要功能：
 * - 显示邀请者信息
 * - 显示工作区名称
 * - 提供加入工作区的按钮
 * - 提供备用链接
 *
 * 依赖关系：
 * - react：JSX 支持
 * - @jsx-email/all：邮件组件库
 * - ../components：自定义组件
 * - ../styles：样式配置
 *
 * 导出内容：
 * - InviteEmail：邀请邮件组件
 *
 * 使用场景：
 * - 用户被邀请加入工作区时发送
 *
 * @package console.mail
 * @module InviteEmail
 */

// 禁用 TypeScript 类型检查
// JSX Email 组件的类型定义不完整，需要禁用检查
// @ts-nocheck

// 导入 React
import React from "react"

// 从 jsx-email 导入邮件布局组件
// Img：图片组件
// Row：行布局组件
// Html：HTML 根元素
// Link：链接组件
// Body：邮件主体
// Head：邮件头部
// Button：按钮组件
// Column：列布局组件
// Preview：邮件预览文本
// Section：区块组件
// Container：容器组件
import { Img, Row, Html, Link, Body, Head, Button, Column, Preview, Section, Container } from "@jsx-email/all"

// 导入自定义组件
import { Text, Fonts, Title, A, Span } from "../components"

// 导入样式配置
import {
  unit,                 // 基础单位
  body,                 // 主体样式
  frame,                // 框架样式
  headingText,          // 标题样式
  container,            // 容器样式
  contentText,          // 内容样式
  button,               // 按钮样式
  contentHighlightText, // 高亮样式
  linkText,             // 链接样式
  buttonText,           // 按钮文本样式
} from "../styles"

/**
 * 控制台 URL
 *
 * OpenCode Web 控制台的基础 URL。
 */
const CONSOLE_URL = "https://opencode.ai/"

/**
 * 邀请邮件 Props 接口
 *
 * 定义邮件组件所需的输入参数。
 */
interface InviteEmailProps {
  // 邀请者的邮箱地址
  inviter: string

  // 工作区 ID
  workspaceID: string

  // 工作区名称
  workspaceName: string

  // 静态资源 URL 基础路径（用于加载图片、字体等）
  assetsUrl: string
}

/**
 * 邀请邮件组件
 *
 * 发送给被邀请用户的邮件模板，包含邀请信息和加入按钮。
 *
 * @param props.inviter - 邀请者邮箱（默认：test@anoma.ly）
 * @param props.workspaceID - 工作区 ID（默认：wrk_01K6XFY7V53T8XN0A7X8G9BTN3）
 * @param props.workspaceName - 工作区名称（默认：anomaly）
 * @param props.assetsUrl - 静态资源 URL（默认：https://opencode.ai/email）
 * @returns 邮件 JSX 元素
 */
export const InviteEmail = ({
  inviter = "test@anoma.ly",
  workspaceID = "wrk_01K6XFY7V53T8XN0A7X8G9BTN3",
  workspaceName = "anomaly",
  assetsUrl = `${CONSOLE_URL}email`,
}: InviteEmailProps) => {
  // 邮件预览文本（在收件箱列表中显示）
  const messagePlain = `${inviter} invited you to join the ${workspaceName} workspace.`

  // 加入工作区的完整 URL
  const url = `${CONSOLE_URL}workspace/${workspaceID}`

  return (
    // HTML 根元素，lang="en" 表示英文内容
    <Html lang="en">
      {/* 邮件头部，包含元数据 */}
      <Head>
        {/* 邮件标题，显示在邮件客户端标题栏 */}
        <Title>{`OpenCode — ${messagePlain}`}</Title>
      </Head>

      {/* 配置 Web 字体 */}
      <Fonts assetsUrl={assetsUrl} />

      {/* 邮件预览文本 */}
      {/* 在邮件客户端的列表视图中显示，不打开邮件就能看到内容 */}
      <Preview>{messagePlain}</Preview>

      {/* 邮件主体 */}
      {/* id 属性用于唯一标识，使用随机数避免冲突 */}
      <Body style={body} id={Math.random().toString()}>
        {/* 主容器，控制最小宽度和整体布局 */}
        <Container style={container}>
          {/* 白色框架卡片 */}
          <Section style={frame}>
            {/* 顶部：Logo 区域 */}
            <Row>
              <Column>
                {/* Logo 链接，点击跳转到 Zen 页面 */}
                <A href={`${CONSOLE_URL}zen`}>
                  {/* OpenCode Logo 图片 */}
                  <Img height="32" alt="OpenCode Logo" src={`${assetsUrl}/logo.png`} />
                </A>
              </Column>
            </Row>

            {/* 邀请信息区域 */}
            <Section style={{ padding: `${unit * 2}px 0 0 0` }}>
              {/* 主标题 */}
              <Text style={headingText}>Join your team's OpenCode workspace</Text>

              {/* 邀请内容文本 */}
              <Text style={contentText}>
                {/* 提示文本 */}
                You have been invited by{" "}
                {/* 邀请者邮箱，使用高亮样式突出显示 */}
                <Span style={contentHighlightText}>{inviter}</Span> to join the{" "}
                {/* 工作区名称，使用高亮样式突出显示 */}
                <Span style={contentHighlightText}>{workspaceName}</Span> workspace on OpenCode.
              </Text>
            </Section>

            {/* 加入按钮区域 */}
            <Section style={{ padding: `${unit}px 0 0 0` }}>
              {/* 主按钮，点击跳转到工作区 */}
              <Button style={button} href={url}>
                <Text style={buttonText}>
                  {/* 按钮文本 */}
                  Join workspace
                  {/* 右箭头图标 */}
                  <Img width="24" height="24" src={`${assetsUrl}/right-arrow.png`} alt="Arrow right" />
                </Text>
              </Button>
            </Section>

            {/* 备用链接区域 */}
            {/* 当按钮不可用时（如某些邮件客户端不支持），用户可以复制链接 */}
            <Section style={{ padding: `${unit}px 0 0 0` }}>
              {/* 提示文本 */}
              <Text style={contentText}>Button not working? Copy the following link...</Text>

              {/* 可点击的链接 */}
              <Link href={url}>
                {/* 链接文本，使用链接样式 */}
                <Text style={linkText}>{url}</Text>
              </Link>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

// 默认导出邮件组件
export default InviteEmail
