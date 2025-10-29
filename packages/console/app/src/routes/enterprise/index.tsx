import "./index.css"
import { Title, Meta } from "@solidjs/meta"
import { createSignal } from "solid-js"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { Faq } from "~/component/faq"

export default function Enterprise() {
  const [formData, setFormData] = createSignal({
    name: "",
    role: "",
    email: "",
    message: "",
  })
  const [isSubmitting, setIsSubmitting] = createSignal(false)
  const [showSuccess, setShowSuccess] = createSignal(false)

  const handleInputChange = (field: string) => (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement
    setFormData((prev) => ({ ...prev, [field]: target.value }))
  }

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const response = await fetch("/api/enterprise", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData()),
      })

      if (response.ok) {
        setShowSuccess(true)
        setFormData({
          name: "",
          role: "",
          email: "",
          message: "",
        })
        setTimeout(() => setShowSuccess(false), 5000)
      }
    } catch (error) {
      console.error("Failed to submit form:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main data-page="enterprise">
      <Title>OpenCode | Enterprise solutions for your organisation</Title>
      <Meta name="description" content="Contact OpenCode for enterprise solutions" />
      <div data-component="container">
        <Header />

        <div data-component="content">
          <section data-component="enterprise-content">
            <div data-component="enterprise-columns">
              <div data-component="enterprise-column-1">
                <h2>Your code is yours</h2>
                <p>
                  OpenCode operates securely inside your organization with no data or context stored and no licensing restrictions or ownership claims. Start a trial with your team today, then scale confidently with enterprise-grade features including SSO, private registries, and self-hosting.
                </p>
                <p>
                  Let us know and how we can help.
                </p>
              </div>

              <div data-component="enterprise-column-2">
                <div data-component="enterprise-form">
                  <form onSubmit={handleSubmit}>
                    <div data-component="form-group">
                      <label for="name">Full name</label>
                      <input
                        id="name"
                        type="text"
                        required
                        value={formData().name}
                        onInput={handleInputChange("name")}
                        placeholder="Jeff Bezos"
                      />
                    </div>

                    <div data-component="form-group">
                      <label for="role">Role</label>
                      <input
                        id="role"
                        type="text"
                        required
                        value={formData().role}
                        onInput={handleInputChange("role")}
                        placeholder="Executive Chairman"
                      />
                    </div>

                    <div data-component="form-group">
                      <label for="email">Company email</label>
                      <input
                        id="email"
                        type="email"
                        required
                        value={formData().email}
                        onInput={handleInputChange("email")}
                        placeholder="jeff@amazon.com"
                      />
                    </div>

                    <div data-component="form-group">
                      <label for="message">What problem are you trying to solve?</label>
                      <textarea
                        id="message"
                        required
                        rows={5}
                        value={formData().message}
                        onInput={handleInputChange("message")}
                        placeholder="We need help with"
                      />
                    </div>

                    <button type="submit" disabled={isSubmitting()} data-component="submit-button">
                      {isSubmitting() ? "Sending..." : "Send"}
                    </button>
                  </form>

                  {showSuccess() && (
                    <div data-component="success-message">
                      Message sent, we'll be in touch soon.
                    </div>
                  )}
                </div>
              </div>
            </div>
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
                  Absolutely. You can fully self-host OpenCode, including the share feature, ensuring that data and pages are accessible only after authentication.
                </Faq>
              </li>
              <li>
                <Faq question="How do we get started with enterprise deployment?">
                  Contact us to discuss pricing, implementation, and enterprise options like SSO, private registries, and self-hosting.
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
