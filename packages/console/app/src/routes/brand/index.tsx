/**
 * ============================================================================
 * 文件名：index.tsx
 * 所属包：packages/console/app/src/routes/brand
 * ============================================================================
 *
 * 文件作用：
 * 品牌资源页面。展示 OpenCode 的品牌资产并提供下载。
 *
 * 主要功能：
 * - 显示 OpenCode 品牌指南
 * - 提供品牌资产下载（Logo、Wordmark）
 * - 支持浅色和深色版本
 * - 提供 PNG 和 SVG 格式
 * - 提供全部资产的打包下载
 *
 * 依赖关系：
 * - @solidjs/meta：页面 Meta 标签
 * - ~/component/*：公共组件
 * - ~/config：应用配置
 * - ../../asset/brand/*：品牌资产图片
 *
 * 导出内容：
 * - default：品牌页面组件
 *
 * 路由：
 * - GET /brand → 品牌资源页面
 *
 * 资产类型：
 * - Logo：OpenCode 图标
 * - Wordmark：OpenCode 文字标识
 * - Wordmark Simple：简化版文字标识
 * - 格式：PNG（位图）和 SVG（矢量图）
 * - 主题：Light（浅色）和 Dark（深色）
 *
 * @package console.app
 * @module brand/page
 */

// 导入品牌页面样式
import "../../brand/index.css"

// 导入 Meta 标签组件
import { Title, Meta, Link } from "@solidjs/meta"

// 导入路由组件
import { A, createAsync, query } from "@solidjs/router"

// 导入公共组件
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"

// 导入品牌资产预览图
import previewLogoLight from "../../asset/brand/preview-opencode-logo-light.png"
import previewLogoDark from "../../asset/brand/preview-opencode-logo-dark.png"
import previewWordmarkLight from "../../asset/brand/preview-opencode-wordmark-light.png"
import previewWordmarkDark from "../../asset/brand/preview-opencode-wordmark-dark.png"
import previewWordmarkSimpleLight from "../../asset/brand/preview-opencode-wordmark-simple-light.png"
import previewWordmarkSimpleDark from "../../asset/brand/preview-opencode-wordmark-simple-dark.png"

// 导入品牌资产文件（用于下载）
import logoLightPng from "../../asset/brand/opencode-logo-light.png"
import logoDarkPng from "../../asset/brand/opencode-logo-dark.png"
import wordmarkLightPng from "../../asset/brand/opencode-wordmark-light.png"
import wordmarkDarkPng from "../../asset/brand/opencode-wordmark-dark.png"
import wordmarkSimpleLightPng from "../../asset/brand/opencode-wordmark-simple-light.png"
import wordmarkSimpleDarkPng from "../../asset/brand/opencode-wordmark-simple-dark.png"

// 导入 SVG 格式品牌资产
import logoLightSvg from "../../asset/brand/opencode-logo-light.svg"
import logoDarkSvg from "../../asset/brand/opencode-logo-dark.svg"
import wordmarkLightSvg from "../../asset/brand/opencode-wordmark-light.svg"
import wordmarkDarkSvg from "../../asset/brand/opencode-wordmark-dark.svg"
import wordmarkSimpleLightSvg from "../../asset/brand/opencode-wordmark-simple-light.svg"
import wordmarkSimpleDarkSvg from "../../asset/brand/opencode-wordmark-simple-dark.svg"

// 品牌资产打包文件路径
const brandAssets = "/opencode-brand-assets.zip"

/**
 * 品牌页面组件
 *
 * 展示 OpenCode 品牌资产，包括：
 * - Logo（图标）
 * - Wordmark（文字标识）
 * - Wordmark Simple（简化文字标识）
 * - 每种资产都有 Light/Dark 主题
 * - 每种资产都有 PNG/SVG 格式
 *
 * @returns SolidJS 组件
 */
export default function Brand() {
  /**
   * 下载文件函数
   *
   * 触发浏览器下载指定文件。
   * 使用 fetch 获取文件，创建临时 blob URL，然后触发下载。
   * 如果 fetch 失败，回退到在新标签页打开文件。
   *
   * @param url - 要下载的文件 URL
   * @param filename - 下载时保存的文件名
   */
  const downloadFile = async (url: string, filename: string) => {
    try {
      // 获取文件内容
      const response = await fetch(url)
      // 转换为 Blob
      const blob = await response.blob()
      // 创建临时 URL
      const blobUrl = window.URL.createObjectURL(blob)

      // 创建隐藏的下载链接
      const link = document.createElement("a")
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      // 触发点击
      link.click()
      // 清理
      document.body.removeChild(link)

      // 释放临时 URL
      window.URL.revokeObjectURL(blobUrl)
    } catch (error) {
      // 下载失败时，在新标签页打开文件
      console.error("Download failed:", error)
      const link = document.createElement("a")
      link.href = url
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  return (
    <main data-page="enterprise">
      {/* 页面标题和 SEO */}
      <Title>OpenCode | Brand</Title>
      <Link rel="canonical" href={`${config.baseUrl}/brand`} />
      <Meta name="description" content="OpenCode brand guidelines" />

      <div data-component="container">
        {/* 页面头部 */}
        <Header />

        <div data-component="content">
          <section data-component="brand-content">
            <h1>Brand guidelines</h1>
            <p>Resources and assets to help you work with the OpenCode brand.</p>

            {/* 下载全部资产按钮 */}
            <button
              data-component="download-button"
              onClick={() => downloadFile(brandAssets, "opencode-brand-assets.zip")}
            >
              Download all assets
              {/* 下载图标 */}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="square"
                />
              </svg>
            </button>

            {/* 品牌资产网格 */}
            <div data-component="brand-grid">
              {/* Logo Light */}
              <div>
                <img src={previewLogoLight} alt="OpenCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoLightPng, "opencode-logo-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(logoLightSvg, "opencode-logo-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Logo Dark */}
              <div>
                <img src={previewLogoDark} alt="OpenCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoDarkPng, "opencode-logo-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(logoDarkSvg, "opencode-logo-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Wordmark Light */}
              <div>
                <img src={previewWordmarkLight} alt="OpenCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkLightPng, "opencode-wordmark-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkLightSvg, "opencode-wordmark-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Wordmark Dark */}
              <div>
                <img src={previewWordmarkDark} alt="OpenCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkDarkPng, "opencode-wordmark-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkDarkSvg, "opencode-wordmark-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Wordmark Simple Light */}
              <div>
                <img src={previewWordmarkSimpleLight} alt="OpenCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkSimpleLightPng, "opencode-wordmark-simple-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkSimpleLightSvg, "opencode-wordmark-simple-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Wordmark Simple Dark */}
              <div>
                <img src={previewWordmarkSimpleDark} alt="OpenCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkSimpleDarkPng, "opencode-wordmark-simple-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkSimpleDarkSvg, "opencode-wordmark-simple-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* 页脚 */}
        <Footer />
      </div>

      {/* 法律信息 */}
      <Legal />
    </main>
  )
}
