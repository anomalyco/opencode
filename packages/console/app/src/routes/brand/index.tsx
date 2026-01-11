import "./index.css"
import { Title, Meta, Link } from "@solidjs/meta"
import { Header } from "~/component/header"
import { config } from "~/config"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import previewLogoLight from "../../asset/brand/preview-crazycode-logo-light.png"
import previewLogoDark from "../../asset/brand/preview-crazycode-logo-dark.png"
import previewWordmarkLight from "../../asset/brand/preview-crazycode-wordmark-light.png"
import previewWordmarkDark from "../../asset/brand/preview-crazycode-wordmark-dark.png"
import previewWordmarkSimpleLight from "../../asset/brand/preview-crazycode-wordmark-simple-light.png"
import previewWordmarkSimpleDark from "../../asset/brand/preview-crazycode-wordmark-simple-dark.png"
import logoLightPng from "../../asset/brand/crazycode-logo-light.png"
import logoDarkPng from "../../asset/brand/crazycode-logo-dark.png"
import wordmarkLightPng from "../../asset/brand/crazycode-wordmark-light.png"
import wordmarkDarkPng from "../../asset/brand/crazycode-wordmark-dark.png"
import wordmarkSimpleLightPng from "../../asset/brand/crazycode-wordmark-simple-light.png"
import wordmarkSimpleDarkPng from "../../asset/brand/crazycode-wordmark-simple-dark.png"
import logoLightSvg from "../../asset/brand/crazycode-logo-light.svg"
import logoDarkSvg from "../../asset/brand/crazycode-logo-dark.svg"
import wordmarkLightSvg from "../../asset/brand/crazycode-wordmark-light.svg"
import wordmarkDarkSvg from "../../asset/brand/crazycode-wordmark-dark.svg"
import wordmarkSimpleLightSvg from "../../asset/brand/crazycode-wordmark-simple-light.svg"
import wordmarkSimpleDarkSvg from "../../asset/brand/crazycode-wordmark-simple-dark.svg"
const brandAssets = "/crazycode-brand-assets.zip"

export default function Brand() {
  const downloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const blobUrl = window.URL.createObjectURL(blob)

      const link = document.createElement("a")
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      window.URL.revokeObjectURL(blobUrl)
    } catch (error) {
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
      <Title>CrazyCode | Brand</Title>
      <Link rel="canonical" href={`${config.baseUrl}/brand`} />
      <Meta name="description" content="CrazyCode brand guidelines" />
      <div data-component="container">
        <Header />

        <div data-component="content">
          <section data-component="brand-content">
            <h1>Brand guidelines</h1>
            <p>Resources and assets to help you work with the CrazyCode brand.</p>
            <button
              data-component="download-button"
              onClick={() => downloadFile(brandAssets, "crazycode-brand-assets.zip")}
            >
              Download all assets
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="square"
                />
              </svg>
            </button>

            <div data-component="brand-grid">
              <div>
                <img src={previewLogoLight} alt="CrazyCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoLightPng, "crazycode-logo-light.png")}>
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
                  <button onClick={() => downloadFile(logoLightSvg, "crazycode-logo-light.svg")}>
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
              <div>
                <img src={previewLogoDark} alt="CrazyCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoDarkPng, "crazycode-logo-dark.png")}>
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
                  <button onClick={() => downloadFile(logoDarkSvg, "crazycode-logo-dark.svg")}>
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
              <div>
                <img src={previewWordmarkLight} alt="CrazyCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkLightPng, "crazycode-wordmark-light.png")}>
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
                  <button onClick={() => downloadFile(wordmarkLightSvg, "crazycode-wordmark-light.svg")}>
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
              <div>
                <img src={previewWordmarkDark} alt="CrazyCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkDarkPng, "crazycode-wordmark-dark.png")}>
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
                  <button onClick={() => downloadFile(wordmarkDarkSvg, "crazycode-wordmark-dark.svg")}>
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
              <div>
                <img src={previewWordmarkSimpleLight} alt="CrazyCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkSimpleLightPng, "crazycode-wordmark-simple-light.png")}>
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
                  <button onClick={() => downloadFile(wordmarkSimpleLightSvg, "crazycode-wordmark-simple-light.svg")}>
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
              <div>
                <img src={previewWordmarkSimpleDark} alt="CrazyCode brand guidelines" />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkSimpleDarkPng, "crazycode-wordmark-simple-dark.png")}>
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
                  <button onClick={() => downloadFile(wordmarkSimpleDarkSvg, "crazycode-wordmark-simple-dark.svg")}>
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
        <Footer />
      </div>
      <Legal />
    </main>
  )
}
