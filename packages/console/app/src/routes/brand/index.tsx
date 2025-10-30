import "./index.css"
import { Title, Meta } from "@solidjs/meta"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import previewLogoLight from "../../asset/brand/preview-opencode-logo-light.png"
import previewLogoDark from "../../asset/brand/preview-opencode-logo-dark.png"
import previewWordmarkLight from "../../asset/brand/preview-opencode-wordmark-light.png"
import previewWordmarkDark from "../../asset/brand/preview-opencode-wordmark-dark.png"
import previewWordmarkSimpleLight from "../../asset/brand/preview-opencode-wordmark-simple-light.png"
import previewWordmarkSimpleDark from "../../asset/brand/preview-opencode-wordmark-simple-dark.png"


export default function Brand() {
  const downloadFile = (url: string, filename: string) => {
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <main data-page="enterprise">
      <Title>OpenCode | Brand</Title>
      <Meta name="description" content="OpenCode brand guidelines" />
      <div data-component="container">
        <Header />

        <div data-component="content">
          <section data-component="brand-content">
            <h2>Brand guidelines</h2>
            <p>Resources and assets to help you work with the OpenCode brand.</p>
            <button data-component="download-button">
              Download all assets
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                   xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                  stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>
              </svg>
            </button>

            <div data-component="brand-grid">
              <div>
                <img src={previewLogoLight} alt="OpenCode brand guidelines"/>
                <div data-component="actions">
                  <button
                    onClick={() => downloadFile(LogoLight, "opencode-logo-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(brandAssetsLight, "opencode-logo-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewLogoDark} alt="OpenCode brand guidelines"/>
                <div data-component="actions">
                  <button
                    onClick={() => downloadFile(brand, "opencode-logo-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="square"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => downloadFile(brandAssetsLight, "opencode-logo-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="square"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkLight} alt="OpenCode brand guidelines"/>
                <div data-component="actions">
                  <button
                    onClick={() => downloadFile(brand, "opencode-wordmark-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="square"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => downloadFile(brandAssetsLight, "opencode-wordmark-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="square"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkDark} alt="OpenCode brand guidelines"/>
                <div data-component="actions">
                  <button
                    onClick={() => downloadFile(brand, "opencode-wordmark-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="square"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => downloadFile(brandAssetsLight, "opencode-wordmark-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="square"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkSimpleLight} alt="OpenCode brand guidelines"/>
                <div data-component="actions">
                  <button
                    onClick={() => downloadFile(brand, "opencode-wordmark-simple-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="square"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => downloadFile(brandAssetsLight, "opencode-wordmark-simple-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="square"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkSimpleDark} alt="OpenCode brand guidelines"/>
                <div data-component="actions">
                  <button
                    onClick={() => downloadFile(brand, "opencode-wordmark-simple-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="square"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => downloadFile(brandAssetsLight, "opencode-wordmark-simple-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="square"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
        <Footer/>
      </div>
      <Legal/>
    </main>
  )
}
