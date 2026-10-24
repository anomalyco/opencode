import "./index.css"
import { Meta, Title } from "@solidjs/meta"
import { A } from "@solidjs/router"
import { For, type JSX } from "solid-js"
import { Faq } from "~/component/faq"
import { Footer } from "~/component/footer"
import { Header } from "~/component/header"
import { IconCheck, IconCopy } from "~/component/icon"
import { Legal } from "~/component/legal"
import { LocaleLinks } from "~/component/locale-links"
import { SocialMeta } from "~/component/social-meta"
import { config } from "~/config"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import type { Key } from "~/i18n"
import type { DownloadPlatform } from "./types"

type DownloadChannel = "stable" | "beta"

function getDownloadHref(platform: DownloadPlatform, channel: DownloadChannel) {
  return `/download/${channel}/${platform}`
}

function AppleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M20.0035 7.15814C19.3171 7.5784 18.7485 8.16594 18.351 8.86579C17.9534 9.56563 17.74 10.3549 17.7305 11.1597C17.7332 12.0655 18.0016 12.9506 18.5024 13.7054C19.0032 14.4602 19.7144 15.0515 20.5479 15.4061C20.2193 16.4664 19.7329 17.4712 19.1051 18.3868C18.2069 19.6798 17.2677 20.9727 15.8387 20.9727C14.4096 20.9727 14.0421 20.1425 12.3952 20.1425C10.7892 20.1425 10.2175 21 8.91088 21C7.60426 21 6.69246 19.8022 5.6444 18.3323C4.25999 16.2732 3.49913 13.8583 3.45312 11.3774C3.45312 7.29427 6.10722 5.13028 8.72032 5.13028C10.1086 5.13028 11.2656 6.04208 12.1366 6.04208C12.9669 6.04208 14.2599 5.07572 15.8387 5.07572C16.6504 5.05478 17.4548 5.23375 18.1811 5.59689C18.9074 5.96003 19.5332 6.49619 20.0035 7.15814ZM15.0901 3.34726C15.7861 2.52858 16.18 1.49589 16.2062 0.421702C16.2074 0.280092 16.1937 0.13875 16.1654 0C14.9699 0.116777 13.8644 0.686551 13.0757 1.59245C12.3731 2.37851 11.9643 3.38362 11.9188 4.43697C11.9193 4.56507 11.933 4.69278 11.9597 4.81808C12.0539 4.8359 12.1496 4.84503 12.2455 4.84536C12.7964 4.80152 13.3327 4.64611 13.8217 4.38858C14.3108 4.13104 14.7423 3.77676 15.0901 3.34726Z"
        fill="currentColor"
      />
    </svg>
  )
}

function WindowsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 2H11.481V11.4769H2V2ZM12.519 2H22V11.4769H12.519V2ZM2 12.519H11.481V22H2V12.519ZM12.519 12.519H22V22H12.519"
        fill="currentColor"
      />
    </svg>
  )
}

function LinuxIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.34591 22.7088C5.61167 22.86 7.03384 23.6799 8.22401 23.8247C9.42058 23.9758 9.79086 23.0098 9.79086 23.0098C9.79086 23.0098 11.1374 22.7088 12.553 22.6741C13.97 22.6344 15.3113 22.9688 15.3113 22.9688C15.3113 22.9688 15.5714 23.5646 16.057 23.8247C16.5426 24.0898 17.588 24.1257 18.258 23.4198C18.9293 22.7088 20.7204 21.8132 21.7261 21.2533C22.7382 20.6922 22.5525 19.8364 21.917 19.5763C21.2816 19.3163 20.7614 18.9063 20.8011 18.1196C20.8357 17.3394 20.24 16.8193 20.24 16.8193C20.24 16.8193 20.7614 15.1025 20.2759 13.6805C19.7903 12.2648 18.1889 9.98819 16.9577 8.27657C15.7266 6.55985 16.7719 4.5779 15.651 2.04503C14.5299 -0.491656 11.623 -0.341713 10.0562 0.739505C8.4893 1.8208 8.96968 4.50225 9.04526 5.77447C9.12084 7.04022 9.07985 7.94598 8.93509 8.27146C8.79033 8.60198 7.77951 9.80243 7.1082 10.8081C6.43818 11.819 5.95254 13.906 5.46187 14.7669C4.98142 15.6228 5.31711 16.403 5.31711 16.403C5.31711 16.403 4.98149 16.5182 4.71628 17.0795C4.45616 17.6342 3.93601 17.8993 2.99948 18.0801C2.06934 18.2709 2.06934 18.8705 2.29357 19.5419C2.51902 20.2119 2.29357 20.5873 2.03346 21.4431C1.77342 22.2988 3.07506 22.5588 4.34591 22.7088ZM17.5034 18.805C18.1683 19.0958 19.124 18.691 19.4149 18.4001C19.7045 18.1106 19.9094 17.6801 19.9094 17.6801C19.9094 17.6801 20.2002 17.8249 20.1707 18.2848C20.14 18.7512 20.3706 19.4161 20.8062 19.6467C21.2418 19.876 21.9067 20.1963 21.5621 20.5166C21.211 20.8369 19.2688 21.6183 18.6885 22.2282C18.1132 22.8341 17.3573 23.33 16.8974 23.1839C16.4324 23.0391 16.0262 22.4037 16.2261 21.4736C16.4324 20.5473 16.6066 19.5313 16.5771 18.951C16.5464 18.3707 16.4324 17.5892 16.5771 17.4738C16.7219 17.3598 16.9525 17.4148 16.9525 17.4148C16.9525 17.4148 16.8371 18.5156 17.5034 18.805ZM13.1885 3.12632C13.829 3.12632 14.3454 3.76175 14.3454 4.54324C14.3454 5.09798 14.0853 5.57844 13.7048 5.80906C13.6087 5.76937 13.5087 5.72449 13.3986 5.67832C13.6292 5.56434 13.7893 5.27352 13.7893 4.93783C13.7893 4.49844 13.519 4.13714 13.1794 4.13714C12.8489 4.13714 12.5734 4.49836 12.5734 4.93783C12.5734 5.09806 12.6132 5.25813 12.6785 5.38369C12.4786 5.30293 12.298 5.23383 12.1532 5.17874C12.0776 4.98781 12.0328 4.77257 12.0328 4.54331C12.0328 3.76183 12.5478 3.12632 13.1885 3.12632ZM11.6024 5.56823C11.9176 5.62331 12.7835 5.9987 13.1039 6.11398C13.4242 6.22415 13.7791 6.4291 13.7445 6.63413C13.7048 6.84548 13.5395 6.84548 13.1039 7.1107C12.6735 7.37082 11.7331 7.95116 11.432 7.99085C11.1322 8.03055 10.9618 7.86141 10.6415 7.65516C10.3211 7.44503 9.72039 6.95436 9.87147 6.69432C9.87147 6.69432 10.3416 6.33432 10.5467 6.14986C10.7517 5.95893 11.2821 5.50925 11.6024 5.56823ZM10.2213 3.35185C10.726 3.35185 11.1373 3.95268 11.1373 4.69318C11.1373 4.82773 11.1219 4.95322 11.0976 5.07878C10.972 5.11847 10.8466 5.18385 10.726 5.28891C10.6671 5.33889 10.612 5.38369 10.5621 5.43367C10.6415 5.28381 10.6722 5.06857 10.6363 4.84305C10.5672 4.44335 10.2968 4.14743 10.0316 4.18712C9.76511 4.232 9.60625 4.5984 9.67033 5.00327C9.74081 5.41325 10.0059 5.7091 10.2763 5.6643C10.2917 5.6592 10.3058 5.65409 10.3211 5.64891C10.1918 5.77447 10.0713 5.88464 9.94576 5.97432C9.58065 5.80388 9.31033 5.29402 9.31033 4.69318C9.31041 3.94758 9.71521 3.35185 10.2213 3.35185ZM7.40915 13.045C7.9293 12.2251 8.26492 10.4328 8.78507 9.83702C9.31041 9.24259 9.71521 7.97554 9.53075 7.41569C9.53075 7.41569 10.6517 8.75702 11.432 8.53668C12.2135 8.31116 13.97 7.00571 14.23 7.22994C14.4901 7.45539 16.727 12.375 16.9525 13.9419C17.178 15.5074 16.8026 16.7041 16.8026 16.7041C16.8026 16.7041 15.9468 16.4785 15.8366 16.9987C15.7264 17.524 15.7264 19.4265 15.7264 19.4265C15.7264 19.4265 14.5695 21.0279 12.7784 21.2931C10.9874 21.5532 10.0905 21.3636 10.0905 21.3636L9.08481 20.2118C9.08481 20.2118 9.86637 20.0965 9.75612 19.3112C9.64595 18.531 7.36801 17.4496 6.95803 16.4785C6.5482 15.5073 6.8826 13.8662 7.40915 13.045ZM2.9802 18.9204C3.06988 18.5361 4.23056 18.5361 4.67643 18.2657C5.12229 17.9954 5.21189 17.219 5.57197 17.0141C5.92679 16.804 6.58279 17.5496 6.85311 17.9697C7.11833 18.3797 8.13433 20.1721 8.54942 20.6179C8.96961 21.0676 9.35528 21.6633 9.23483 22.1988C9.12084 22.7343 8.48923 23.1251 8.48923 23.1251C7.92427 23.2993 6.34843 22.619 5.63231 22.3192C4.9162 22.0182 3.09433 21.9284 2.8599 21.6633C2.61906 21.393 2.97517 20.7972 3.06995 20.2322C3.15445 19.6609 2.8893 19.306 2.9802 18.9204Z"
        fill="currentColor"
      />
    </svg>
  )
}

// The Linux AppImage build is omitted until it works.
const desktopDownloads = [
  { platform: "darwin-aarch64-dmg", label: "download.platform.macosAppleSilicon", icon: AppleIcon },
  { platform: "darwin-x64-dmg", label: "download.platform.macosIntel", icon: AppleIcon },
  { platform: "windows-x64-nsis", label: "download.platform.windowsX64", icon: WindowsIcon },
  { platform: "windows-aarch64-nsis", label: "download.platform.windowsArm64", icon: WindowsIcon },
  { platform: "linux-x64-deb", label: "download.platform.linuxDeb", icon: LinuxIcon },
  { platform: "linux-x64-rpm", label: "download.platform.linuxRpm", icon: LinuxIcon },
] satisfies { platform: DownloadPlatform; label: Key; icon: () => JSX.Element }[]

function DesktopDownloadRows(props: { channel: DownloadChannel }) {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <For each={desktopDownloads}>
      {(download) => (
        <div data-component="download-row">
          <div data-component="download-info">
            <span data-slot="icon">
              <download.icon />
            </span>
            <span>{i18n.t(download.label)}</span>
          </div>
          <a href={language.route(getDownloadHref(download.platform, props.channel))} data-component="action-button">
            {i18n.t("download.action.download")}
          </a>
        </div>
      )}
    </For>
  )
}

function CopyStatus() {
  return (
    <span data-component="copy-status">
      <IconCopy data-slot="copy" />
      <IconCheck data-slot="check" />
    </span>
  )
}

export default function Download() {
  const i18n = useI18n()
  const language = useLanguage()
  const handleCopyClick = (command: string) => (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement
    void navigator.clipboard.writeText(command)
    button.setAttribute("data-copied", "")
    setTimeout(() => {
      button.removeAttribute("data-copied")
    }, 1500)
  }
  return (
    <main data-page="download">
      <Title>{i18n.t("download.title")}</Title>
      <LocaleLinks path="/download" />
      <Meta name="description" content={i18n.t("download.meta.description")} />
      <SocialMeta title={i18n.t("download.title")} description={i18n.t("download.meta.description")} path="/download" />
      <div data-component="container">
        <Header hideGetStarted />

        <div data-component="content">
          <section data-component="download-section">
            <div data-component="section-label">
              <span>[1]</span> {i18n.t("download.section.terminal")}
            </div>
            <div data-component="section-content">
              <button
                data-component="cli-row"
                onClick={handleCopyClick("curl -fsSL https://opencode.ai/v2/install | bash")}
              >
                <code>
                  curl -fsSL https://<strong>opencode.ai/v2/install</strong> | bash
                </code>
                <CopyStatus />
              </button>
              <button data-component="cli-row" onClick={handleCopyClick("npm install -g @opencode/cli")}>
                <code>
                  npm install -g <strong>@opencode/cli</strong>
                </code>
                <CopyStatus />
              </button>
              <button data-component="cli-row" onClick={handleCopyClick("bun install -g --trust @opencode/cli")}>
                <code>
                  bun install -g --trust <strong>@opencode/cli</strong>
                </code>
                <CopyStatus />
              </button>
              <button data-component="cli-row" onClick={handleCopyClick("brew install anomalyco/tap/opencode-v2")}>
                <code>
                  brew install <strong>anomalyco/tap/opencode-v2</strong>
                </code>
                <CopyStatus />
              </button>
              <button data-component="cli-row" onClick={handleCopyClick("paru -S opencode-beta")}>
                <code>
                  paru -S <strong>opencode-beta</strong>
                </code>
                <CopyStatus />
              </button>
              <button data-component="cli-row" onClick={handleCopyClick("yay -S opencode-beta")}>
                <code>
                  yay -S <strong>opencode-beta</strong>
                </code>
                <CopyStatus />
              </button>
            </div>
          </section>

          <section data-component="download-section">
            <div data-component="section-label">
              <span>[2]</span> {i18n.t("download.section.desktop")}
            </div>
            <div data-component="section-content">
              <button data-component="cli-row" onClick={handleCopyClick("brew install --cask opencode-desktop")}>
                <code>
                  brew install --cask <strong>opencode-desktop</strong>
                </code>
                <CopyStatus />
              </button>
              <DesktopDownloadRows channel="stable" />
            </div>
          </section>

          <section data-component="download-section">
            <div data-component="section-label">
              <span>[3]</span> {i18n.t("download.section.desktopBeta")}
            </div>
            <div data-component="section-content">
              <DesktopDownloadRows channel="beta" />
            </div>
          </section>
        </div>

        <section data-component="faq">
          <div data-slot="section-title">
            <h3>{i18n.t("common.faq")}</h3>
          </div>
          <ul>
            <li>
              <Faq question={i18n.t("home.faq.q1")}>{i18n.t("home.faq.a1")}</Faq>
            </li>
            <li>
              <Faq question={i18n.t("home.faq.q2")}>
                {i18n.t("home.faq.a2.before")} <a href={language.route("/docs")}>{i18n.t("home.faq.a2.link")}</a>.
              </Faq>
            </li>
            <li>
              <Faq question={i18n.t("home.faq.q3")}>
                {i18n.t("download.faq.a3.beforeLocal")}{" "}
                <a href={language.route("/docs/providers/#lm-studio")} target="_blank">
                  {i18n.t("download.faq.a3.localLink")}
                </a>{" "}
                {i18n.t("download.faq.a3.afterLocal.beforeZen")}{" "}
                <A href={language.route("/zen")}>{i18n.t("nav.zen")}</A>
                {i18n.t("download.faq.a3.afterZen")}
              </Faq>
            </li>
            <li>
              <Faq question={i18n.t("home.faq.q5")}>
                {i18n.t("home.faq.a5.beforeDesktop")}{" "}
                <a href={language.route("/download")}>{i18n.t("home.faq.a5.desktop")}</a> {i18n.t("home.faq.a5.and")}{" "}
                <a href={language.route("/docs/cli/#web")}>{i18n.t("home.faq.a5.web")}</a>!
              </Faq>
            </li>
            <li>
              <Faq question={i18n.t("home.faq.q6")}>
                {i18n.t("download.faq.a5.p1")} {i18n.t("download.faq.a5.p2.beforeZen")}{" "}
                <A href={language.route("/zen")}>{i18n.t("nav.zen")}</A>
                {i18n.t("download.faq.a5.p2.afterZen")}
              </Faq>
            </li>
            <li>
              <Faq question={i18n.t("home.faq.q7")}>
                {i18n.t("home.faq.a7.p1")} {i18n.t("home.faq.a7.p2.beforeModels")}{" "}
                <a href="/v2/docs/console/models/#privacy">{i18n.t("home.faq.a7.p2.modelsLink")}</a>.
              </Faq>
            </li>
            <li>
              <Faq question={i18n.t("home.faq.q8")}>
                {i18n.t("home.faq.a8.p1")}{" "}
                <a href={config.github.repoUrl} target="_blank">
                  {i18n.t("nav.github")}
                </a>{" "}
                {i18n.t("home.faq.a8.p2")}{" "}
                <a href={`${config.github.repoUrl}?tab=MIT-1-ov-file#readme`} target="_blank">
                  {i18n.t("home.faq.a8.mitLicense")}
                </a>
                {i18n.t("home.faq.a8.p3")}
              </Faq>
            </li>
          </ul>
        </section>

        <Footer />
      </div>
      <Legal />
    </main>
  )
}
