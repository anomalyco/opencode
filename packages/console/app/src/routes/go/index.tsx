import "./index.css"
import { createAsync, query, useSearchParams } from "@solidjs/router"
import { Title, Meta } from "@solidjs/meta"
import { For, Show } from "solid-js"
//import { HttpHeader } from "@solidjs/start"
import { EmailSignup } from "~/component/email-signup"
import { Faq } from "~/component/faq"
import { Legal } from "~/component/legal"
import { Footer } from "~/component/footer"
import { Header } from "~/component/header"
import { GoPlanChart } from "~/component/go-plan-chart"
import { config } from "~/config"
import { getLastSeenWorkspaceID } from "../workspace/common"
import {
  IconAlibaba,
  IconAnthropic,
  IconGoogle,
  IconMiniMax,
  IconMoonshotAI,
  IconOpenAI,
  IconXai,
  IconZai,
} from "~/component/icon"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { LocaleLinks } from "~/component/locale-links"
import { goUsageLimits } from "~/lib/language"

const checkLoggedIn = query(async () => {
  "use server"
  return await getLastSeenWorkspaceID().catch(() => undefined)
}, "checkLoggedIn.get")

const models = [
  { name: "Space Bunny", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "LongCat 2.5 Preview Free", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "Grok 4.7", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention30" },
  { name: "Grok 4.6", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention30" },
  { name: "GPT 6 Luna", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention30" },
  { name: "GPT 5.6 Luna", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention30" },
  { name: "Claude Haiku 5.5", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention30" },
  { name: "GLM-5.3-Flash", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "GLM-5.3", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "GLM-5.2", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "Kimi K3", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "Kimi K2.7 Code", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "LongCat-2.0", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "MiMo-V2.6-Pro", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "MiMo-V2.6-Flash", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "MiMo-V2.5-Pro", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "MiMo-V2.5", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "Qwen3.8 Max", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "Qwen3.8 Flash", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "Qwen3.7 Plus", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "MiniMax M3", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "MiniMax M2.7", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "Muse Spark 1.3 Contributor", training: "go.faq.a5.used", retention: "go.faq.a5.notZdr" },
  { name: "Muse Spark 1.2 Contributor", training: "go.faq.a5.used", retention: "go.faq.a5.notZdr" },
  { name: "DeepSeek V4.1 Flash", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "DeepSeek V4 Pro", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "DeepSeek V4 Flash", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "DeepSeek V4 Flash Vision Exp", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "Hy4 preview", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
  { name: "Hy3", training: "go.faq.a5.notUsed", retention: "go.faq.a5.retention0" },
] as const

export default function Home() {
  const workspaceID = createAsync(() => checkLoggedIn())
  const subscribeUrl = "https://opencode.ai/console/go"
  const i18n = useI18n()
  const language = useLanguage()
  const [searchParams] = useSearchParams()
  return (
    <main data-page="go">
      {/*<HttpHeader name="Cache-Control" value="public, max-age=1, s-maxage=3600, stale-while-revalidate=86400" />*/}
      <Title>{i18n.t("go.title")}</Title>
      <Meta name="description" content={`${i18n.t("go.meta.description")} ${i18n.t("go.plans.plus.description")}`} />
      <LocaleLinks path="/go" />
      <Meta property="og:type" content="website" />
      <Meta property="og:url" content={`${config.baseUrl}${language.route("/go")}`} />
      <Meta property="og:title" content={i18n.t("go.title")} />
      <Meta
        property="og:description"
        content={`${i18n.t("go.meta.description")} ${i18n.t("go.plans.plus.description")}`}
      />
      <Meta property="og:image" content="/social-share-black.png" />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content={i18n.t("go.title")} />
      <Meta
        name="twitter:description"
        content={`${i18n.t("go.meta.description")} ${i18n.t("go.plans.plus.description")}`}
      />
      <Meta name="twitter:image" content="/social-share-black.png" />
      <Meta name="opencode:auth" content={workspaceID() ? "true" : "false"} />

      <div data-component="container">
        <Header go hideGetStarted />

        <div data-component="content">
          <section data-component="hero">
            <Show when={searchParams.ref}>
              <aside data-component="referral-ended-notice" aria-label={i18n.t("go.referral.ended.label")}>
                <strong>{i18n.t("go.referral.ended.label")}</strong>
                <p>{i18n.t("go.referral.ended")}</p>
              </aside>
            </Show>
            <div data-slot="hero-copy">
              <div data-slot="headline">
                <h1>{i18n.t("go.hero.title")}</h1>
                <p>{i18n.t("go.hero.body")}</p>
              </div>
              <div data-slot="model-logos">
                <IconOpenAI />
                <IconAnthropic />
                <IconGoogle />
                <IconXai />
                <IconMiniMax />
                <IconMoonshotAI />
                <IconZai />
                <IconAlibaba />
              </div>
              <p data-slot="tagline">{i18n.t("go.hero.tagline")}</p>
            </div>
            <div data-slot="plans">
              <For
                each={
                  [
                    {
                      name: "Go",
                      price: "$10",
                      cta: "go.cta.text",
                      features: ["go.plans.go.feature1", "go.plans.go.feature2", "go.plans.go.feature3"],
                      marker: "square",
                    },
                    {
                      name: "Go Plus",
                      price: "$40",
                      cta: "go.plans.plus.cta",
                      features: ["go.plans.plus.feature1", "go.plans.plus.feature2", "go.plans.plus.feature3"],
                      marker: "plus",
                    },
                  ] as const
                }
              >
                {(plan) => (
                  <div data-slot="plan">
                    <div data-slot="plan-body">
                      <p data-slot="name">{plan.name}</p>
                      <p data-slot="price">
                        {plan.price} <span>{i18n.t("go.plans.month")}</span>
                      </p>
                      <ul>
                        <For each={plan.features}>
                          {(feature) => (
                            <li>
                              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                                {plan.marker === "square" ? (
                                  <path d="M11 5H5V11H11V5Z" fill="currentColor" />
                                ) : (
                                  <path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" />
                                )}
                              </svg>
                              {i18n.t(feature)}
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                    <a href={subscribeUrl}>{i18n.t(plan.cta)}</a>
                  </div>
                )}
              </For>
            </div>
          </section>

          <section data-component="comparison">
            <GoPlanChart href={goUsageLimits(language.locale())} />
          </section>

          <section data-component="problem">
            <div data-slot="section-title">
              <h3>{i18n.t("go.problem.title")}</h3>
              <p>
                {i18n.t("go.problem.body")} {i18n.t("go.plans.plus.description")}
              </p>
            </div>
            <p>{i18n.t("go.problem.subtitle")}</p>
            <ul>
              <li>
                <span>[*]</span> {i18n.t("go.problem.item1")}
              </li>
              <li>
                <span>[*]</span> {i18n.t("go.problem.item2")}
              </li>
              <li>
                <span>[*]</span> {i18n.t("go.problem.item3")}
              </li>
              <li>
                <span>[*]</span> {i18n.t("go.problem.item4")}
              </li>
            </ul>
          </section>

          <section data-component="how">
            <div data-slot="section-title">
              <h3>{i18n.t("go.how.title")}</h3>
              <p>
                {i18n.t("go.how.body")} {i18n.t("go.plans.plus.description")}
              </p>
            </div>
            <ul>
              <li>
                <span>[1]</span>
                <div>
                  <strong>{i18n.t("go.how.step1.title")}</strong> - {i18n.t("go.how.step1.beforeLink")}{" "}
                  <a href={language.route("/docs/go/#how-it-works")} title={i18n.t("go.how.step1.link")}>
                    {i18n.t("go.how.step1.link")}
                  </a>
                </div>
              </li>
              <li>
                <span>[2]</span>
                <div>
                  <strong>{i18n.t("go.how.step2.title")}</strong> -{" "}
                  <a href={language.route("/docs/go/#pricing")}>{i18n.t("go.how.step2.link")}</a>{" "}
                  {i18n.t("go.how.step2.afterLink")} · {i18n.t("go.plans.plus.description")}
                </div>
              </li>
              <li>
                <span>[3]</span>
                <div>
                  <strong>{i18n.t("go.how.step3.title")}</strong> - {i18n.t("go.how.step3.body")}
                </div>
              </li>
            </ul>
          </section>

          <section data-component="faq">
            <div data-slot="section-title">
              <h3>{i18n.t("common.faq")}</h3>
            </div>
            <ul>
              <li>
                <Faq question={i18n.t("go.faq.q1")}>{i18n.t("go.faq.a1")}</Faq>
              </li>
              <li>
                <Faq question={i18n.t("go.faq.q2")}>
                  {i18n.t("go.faq.a2")}
                  <ul data-slot="faq-models">
                    <For each={models}>{(model) => <li>{model.name}</li>}</For>
                  </ul>
                </Faq>
              </li>
              <li>
                <Faq question={i18n.t("go.faq.q9")}>{i18n.t("go.faq.a9")}</Faq>
              </li>
              <li>
                <Faq question={i18n.t("go.faq.q3")}>
                  {i18n.t("go.faq.a3")} {i18n.t("go.plans.plus.description")}
                </Faq>
              </li>
              <li>
                <Faq question={i18n.t("go.faq.q4")}>
                  {i18n.t("go.faq.a4.p1.beforePricing")}{" "}
                  <a href={language.route("/docs/go/#pricing")}>{i18n.t("go.faq.a4.p1.pricingLink")}</a>{" "}
                  {i18n.t("go.faq.a4.p1.afterPricing")} {i18n.t("go.plans.plus.description")}{" "}
                  {i18n.t("go.faq.a4.p2.beforeAccount")} <a href={subscribeUrl}>{i18n.t("go.faq.a4.p2.accountLink")}</a>
                  . {i18n.t("go.faq.a4.p3")}
                </Faq>
              </li>
              <li>
                <Faq question={i18n.t("go.faq.q5")}>
                  <div data-slot="faq-model-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{i18n.t("go.faq.a5.model")}</th>
                          <th>{i18n.t("go.faq.a5.training")}</th>
                          <th>{i18n.t("go.faq.a5.retention")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={models}>
                          {(model) => (
                            <tr>
                              <td>{model.name}</td>
                              <td>{i18n.t(model.training)}</td>
                              <td>{i18n.t(model.retention)}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                  <div data-slot="faq-retention-notes">
                    <p>
                      <strong>Grok 4.7/4.6:</strong> {i18n.t("go.faq.a5.grokRetention")}{" "}
                      <a href="https://docs.x.ai/developers/faq/security#what-is-zero-data-retention-zdr">
                        {i18n.t("go.faq.a5.learnMore")}
                      </a>
                      .
                    </p>
                    <p>
                      <strong>GPT 6 Luna / GPT 5.6 Luna:</strong> {i18n.t("go.faq.a5.gptRetention")}{" "}
                      <a href="https://developers.openai.com/api/docs/guides/your-data#data-retention-controls-for-abuse-monitoring">
                        {i18n.t("go.faq.a5.learnMore")}
                      </a>
                      .
                    </p>
                    <p>
                      <strong>Claude Haiku 5.5:</strong> {i18n.t("go.faq.a5.retention")}:{" "}
                      {i18n.t("go.faq.a5.retention30")}.{" "}
                      <a href="https://docs.anthropic.com/en/docs/claude-code/data-usage">
                        {i18n.t("go.faq.a5.learnMore")}
                      </a>
                      .
                    </p>
                    <p>
                      <strong>Muse Spark 1.3 Contributor:</strong> {i18n.t("go.faq.a5.museRetention")}{" "}
                      <a href="https://dev.meta.ai/docs/pricing-rate-limits#contributor-tier">
                        {i18n.t("go.faq.a5.learnMore")}
                      </a>
                      .
                    </p>
                    <p>
                      <strong>Muse Spark 1.2 Contributor:</strong> {i18n.t("go.faq.a5.museRetention")}{" "}
                      <a href="https://dev.meta.ai/docs/pricing-rate-limits#contributor-tier">
                        {i18n.t("go.faq.a5.learnMore")}
                      </a>
                      .
                    </p>
                    <p>
                      <strong>DeepSeek V4 Flash:</strong> {i18n.t("go.faq.a5.deepseekRetention")}
                    </p>
                  </div>
                </Faq>
              </li>
              <li>
                <Faq question={i18n.t("go.faq.q6")}>{i18n.t("go.faq.a6")}</Faq>
              </li>
              <li>
                <Faq question={i18n.t("go.faq.q7")}>{i18n.t("go.faq.a7")}</Faq>
              </li>
              <li>
                <Faq question={i18n.t("go.faq.q8")}>{i18n.t("go.faq.a8")}</Faq>
              </li>
              <li>
                <Faq question={i18n.t("go.faq.q10")}>
                  <For each={i18n.t("go.faq.a10").split(/(\{\{contact\}\})/g)}>
                    {(part) =>
                      part === "{{contact}}" ? <a href="mailto:help@anoma.ly">{i18n.t("common.contactUs")}</a> : part
                    }
                  </For>
                </Faq>
              </li>
            </ul>
          </section>

          <EmailSignup />

          <Footer />
        </div>
      </div>

      <Legal />
    </main>
  )
}
