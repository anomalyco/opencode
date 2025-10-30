import "./index.css"
import { Title, Meta } from "@solidjs/meta"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { Faq } from "~/component/faq"
import brand from "../../asset/lander/brand.png"


export default function Brand() {

  return (
    <main data-page="enterprise">
      <Title>OpenCode | Brand</Title>
      <Meta name="description" content="OpenCode brand guidelines" />
      <div data-component="container">
        <Header />

        <div data-component="content">
          <section data-component="brand-content">
            <h2>Brand guidelines</h2>
            <p>
              Resources and assets to help you work with the OpenCode brand.
            </p>
            <a data-component="download-button" href="#">Download brand assets<svg
              width="24" height="24" viewBox="0 0 24 24" fill="none"
              xmlns="http://www.w3.org/2000/svg">
              <path d="M12 6.5L12 17M7.5 13L12 17.5L16.5 13" stroke="currentColor"
                    stroke-width="1.5" stroke-linecap="square"/>
            </svg>
            </a>
            <img src={brand} alt=""/>

            <p>If you need any help with anything brand related <a href="mailto:david@anoma.ly">contact us</a>.</p>
          </section>

          <section data-component="faq">
            <div data-slot="section-title">
              <h3>FAQ</h3>
            </div>
            <ul>
              <li>
                <Faq question="Does Opencode store our code or context data?">
                  No. OpenCode never stores your code or context data. All
                  processing happens locally or directly with your AI provider.
                </Faq>
              </li>
              <li>
                <Faq question="Who owns the code generated with OpenCode?">
                  You do. All code produced is yours, with no licensing
                  restrictions or ownership claims.
                </Faq>
              </li>
              <li>
                <Faq
                  question="How can we trial OpenCode inside our organization?">
                  Simply install and run an internal trial with your team. Since
                  OpenCode doesn’t store any data, your developers can get
                  started right away.
                </Faq>
              </li>
              <li>
                <Faq
                  question="What happens if someone uses the `/share` feature?">
                  By default, sharing is disabled. If enabled, conversations are
                  sent to our share service and cached through our CDN. For
                  enterprise use, we recommend disabling or self-hosting this
                  feature.
                </Faq>
              </li>
              <li>
                <Faq question="Can OpenCode integrate with our company’s SSO?">
                  Yes. Enterprise deployments can include SSO integration so all
                  sessions and shared conversations are protected by your
                  authentication system.
                </Faq>
              </li>
              <li>
                <Faq question="Can OpenCode be self-hosted?">
                  Absolutely. You can fully self-host OpenCode, including the
                  share feature, ensuring that data and pages are accessible
                  only after authentication.
                </Faq>
              </li>
              <li>
                <Faq
                  question="How do we get started with enterprise deployment?">
                  Contact us to discuss pricing, implementation, and enterprise
                  options like SSO, private registries, and self-hosting.
                </Faq>
              </li>
            </ul>
          </section>
        </div>
        <Footer />
      </div>
      <Legal />
    </main>
  )
}
