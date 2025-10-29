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

                <div data-component="testimonial">
                  <div data-component="quotation">
                    <svg width="20" height="17" viewBox="0 0 20 17" fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M19.4118 0L16.5882 9.20833H20V17H12.2353V10.0938L16 0H19.4118ZM7.17647 0L4.35294 9.20833H7.76471V17H0V10.0938L3.76471 0H7.17647Z"
                        fill="currentColor" />
                    </svg>

                  </div>

                  The OpenCode team have been super helpful and responsive to
                  our needs.

                  <div data-component="testimonial-logo">
                    <svg width="102" height="34" viewBox="0 0 102 34"
                         fill="none"
                         xmlns="http://www.w3.org/2000/svg">
                      <g clip-path="url(#clip0_263_28663)">
                        <path
                          d="M94.6984 10.6004L89.0984 9.30039L88.0984 8.90039L62.3984 9.10039V21.5004L94.6984 21.6004V10.6004Z"
                          fill="white" />
                        <path
                          d="M84.2001 20.4C84.361 19.9741 84.4177 19.5159 84.3656 19.0636C84.3134 18.6113 84.1538 18.1781 83.9001 17.8C83.6396 17.4876 83.32 17.2297 82.9597 17.0409C82.5993 16.8522 82.2053 16.7363 81.8001 16.7L64.4001 16.5C64.3001 16.5 64.2001 16.4 64.1001 16.4C64.0768 16.3825 64.0579 16.3599 64.0449 16.3339C64.0319 16.3078 64.0251 16.2791 64.0251 16.25C64.0251 16.2209 64.0319 16.1922 64.0449 16.1662C64.0579 16.1401 64.0768 16.1175 64.1001 16.1C64.2001 15.9 64.3001 15.8 64.5001 15.8L82.0001 15.6C83.1111 15.4767 84.1692 15.0597 85.0656 14.3918C85.9619 13.7239 86.6642 12.8293 87.1001 11.8L88.1001 9.20002C88.1001 9.10001 88.2001 9.00002 88.1001 8.90001C87.5565 6.47843 86.2372 4.30052 84.3427 2.69721C82.4482 1.09391 80.0821 0.152865 77.604 0.0170769C75.1259 -0.118712 72.6711 0.558179 70.6128 1.94489C68.5545 3.33161 67.0051 5.35233 66.2001 7.70002C65.1551 6.95365 63.8804 6.59957 62.6001 6.70002C61.4252 6.83102 60.3298 7.35777 59.4938 8.19372C58.6579 9.02966 58.1311 10.1251 58.0001 11.3C57.9335 11.9014 57.9673 12.5097 58.1001 13.1C56.1991 13.1526 54.3935 13.9448 53.0676 15.3081C51.7416 16.6714 50.9999 18.4982 51.0001 20.4C50.9837 20.7695 51.0174 21.1395 51.1001 21.5C51.1047 21.5781 51.1378 21.6517 51.1931 21.707C51.2484 21.7623 51.3221 21.7954 51.4001 21.8H83.5001C83.7001 21.8 83.9001 21.7 83.9001 21.5L84.2001 20.4Z"
                          fill="#F48120" />
                        <path
                          d="M89.7017 9.2002H89.2017C89.1017 9.2002 89.0017 9.3002 88.9017 9.4002L88.2017 11.8002C88.0408 12.2261 87.9841 12.6843 88.0363 13.1366C88.0885 13.5889 88.2481 14.0221 88.5017 14.4002C88.7623 14.7126 89.0819 14.9705 89.4422 15.1593C89.8025 15.348 90.1966 15.4639 90.6017 15.5002L94.3017 15.7002C94.4017 15.7002 94.5017 15.8002 94.6017 15.8002C94.625 15.8177 94.6439 15.8403 94.6569 15.8663C94.67 15.8924 94.6767 15.9211 94.6767 15.9502C94.6767 15.9793 94.67 16.008 94.6569 16.034C94.6439 16.0601 94.625 16.0827 94.6017 16.1002C94.5017 16.3002 94.4017 16.4002 94.2017 16.4002L90.4017 16.6002C89.2907 16.7235 88.2326 17.1405 87.3363 17.8084C86.4399 18.4763 85.7377 19.3709 85.3017 20.4002L85.1017 21.3002C85.0017 21.4002 85.1017 21.6002 85.3017 21.6002H98.5017C98.5425 21.606 98.584 21.6023 98.6231 21.5893C98.6621 21.5762 98.6976 21.5543 98.7267 21.5252C98.7558 21.4961 98.7778 21.4606 98.7908 21.4215C98.8038 21.3825 98.8076 21.3409 98.8017 21.3002C99.0398 20.4529 99.1741 19.5799 99.2017 18.7002C99.1859 16.1855 98.1799 13.7784 96.4017 12.0002C94.6236 10.222 92.2164 9.21605 89.7017 9.2002Z"
                          fill="#FAAD3F" />
                        <path
                          d="M100.5 27.2C100.322 27.2 100.148 27.1472 100 27.0483C99.852 26.9494 99.7367 26.8088 99.6686 26.6444C99.6005 26.4799 99.5826 26.299 99.6174 26.1244C99.6521 25.9498 99.7378 25.7894 99.8637 25.6636C99.9895 25.5377 100.15 25.452 100.324 25.4172C100.499 25.3825 100.68 25.4003 100.844 25.4685C101.009 25.5366 101.149 25.6519 101.248 25.7999C101.347 25.9479 101.4 26.1219 101.4 26.2999C101.401 26.4183 101.378 26.5355 101.333 26.645C101.288 26.7544 101.221 26.8538 101.138 26.9375C101.054 27.0211 100.954 27.0874 100.845 27.1325C100.736 27.1775 100.618 27.2004 100.5 27.2ZM100.5 25.6C100.362 25.6 100.226 25.641 100.111 25.7179C99.996 25.7948 99.9063 25.9042 99.8533 26.0321C99.8004 26.16 99.7865 26.3007 99.8135 26.4365C99.8405 26.5723 99.9072 26.697 100.005 26.7949C100.103 26.8928 100.228 26.9595 100.363 26.9865C100.499 27.0135 100.64 26.9996 100.768 26.9467C100.896 26.8937 101.005 26.804 101.082 26.6889C101.159 26.5737 101.2 26.4384 101.2 26.2999C101.202 26.2074 101.186 26.1154 101.151 26.0294C101.117 25.9435 101.066 25.8654 101 25.8C100.935 25.7345 100.857 25.683 100.771 25.6486C100.685 25.6143 100.593 25.5977 100.5 25.6ZM100.9 26.7999H100.7L100.5 26.5H100.3V26.7999H100.1V25.9H100.6C100.641 25.8941 100.682 25.8979 100.721 25.9109C100.76 25.9239 100.796 25.9458 100.825 25.975C100.854 26.0041 100.876 26.0395 100.889 26.0786C100.902 26.1177 100.906 26.1592 100.9 26.2C100.9 26.3 100.8 26.4 100.7 26.5L100.9 26.7999ZM100.6 26.2999C100.7 26.2999 100.7 26.3 100.7 26.2C100.7 26.1867 100.698 26.1736 100.693 26.1614C100.688 26.1491 100.681 26.138 100.671 26.1286C100.662 26.1193 100.651 26.1119 100.639 26.107C100.626 26.1021 100.613 26.0997 100.6 26.1H100.3V26.4H100.6V26.2999ZM10.9001 25.4H13.1001V31.4H16.9001V33.2999H10.9001V25.4ZM19.2001 29.2999C19.2001 28.7445 19.3129 28.1948 19.5316 27.6842C19.7502 27.1736 20.0703 26.7127 20.4723 26.3293C20.8743 25.946 21.3499 25.6483 21.8704 25.4542C22.3908 25.26 22.9452 25.1736 23.5001 25.2C24.0497 25.1752 24.5986 25.2635 25.1128 25.4595C25.6269 25.6555 26.0953 25.9549 26.4891 26.3393C26.8828 26.7236 27.1934 27.1847 27.4017 27.694C27.61 28.2032 27.7116 28.7498 27.7001 29.2999C27.7 29.8554 27.5873 30.4051 27.3686 30.9157C27.1499 31.4263 26.8299 31.8872 26.4279 32.2706C26.0258 32.6539 25.5502 32.9516 25.0298 33.1457C24.5093 33.3399 23.9549 33.4264 23.4001 33.4C22.8525 33.4162 22.3073 33.322 21.797 33.123C21.2866 32.924 20.8216 32.6243 20.4296 32.2416C20.0377 31.859 19.7268 31.4013 19.5155 30.8959C19.3043 30.3905 19.197 29.8477 19.2001 29.2999ZM25.5001 29.2999C25.5197 29.0227 25.4828 28.7444 25.3918 28.4818C25.3008 28.2192 25.1575 27.9778 24.9706 27.7722C24.7836 27.5666 24.557 27.401 24.3042 27.2854C24.0514 27.1699 23.7779 27.1068 23.5001 27.1C22.9608 27.1263 22.4524 27.359 22.0801 27.75C21.7077 28.1409 21.5001 28.6601 21.5001 29.2C21.5001 29.7398 21.7077 30.259 22.0801 30.65C22.4524 31.0409 22.9608 31.2736 23.5001 31.2999C24.7001 31.4999 25.5001 30.4999 25.5001 29.2999ZM30.4001 29.7999V25.4H32.6001V29.7999C32.6001 30.8999 33.2001 31.5 34.1001 31.5C34.3103 31.5174 34.5217 31.4872 34.7185 31.4114C34.9154 31.3357 35.0925 31.2164 35.2368 31.0625C35.3811 30.9086 35.4887 30.7241 35.5516 30.5228C35.6145 30.3215 35.631 30.1086 35.6001 29.9V25.4H37.8001V29.7999C37.8001 32.3999 36.3001 33.5 34.1001 33.5C31.8001 33.4 30.4001 32.2999 30.4001 29.7999ZM41.1001 25.4H44.2001C47.0001 25.4 48.7001 26.9999 48.7001 29.2999C48.7001 31.5999 47.0001 33.2999 44.2001 33.2999H41.2001V25.4H41.1001ZM44.2001 31.2999C44.4787 31.3265 44.7599 31.2946 45.0255 31.2062C45.2911 31.1178 45.5353 30.9749 45.7424 30.7866C45.9496 30.5982 46.1151 30.3687 46.2283 30.1127C46.3416 29.8567 46.4001 29.5799 46.4001 29.2999C46.4001 29.02 46.3416 28.7432 46.2283 28.4872C46.1151 28.2312 45.9496 28.0017 45.7424 27.8133C45.5353 27.625 45.2911 27.4821 45.0255 27.3937C44.7599 27.3053 44.4787 27.2734 44.2001 27.2999H43.3001V31.2999H44.2001ZM51.8001 25.4H58.1001V27.2999H54.0001V28.6H57.7001V30.4H54.0001V33.2999H51.8001V25.4ZM61.2001 25.4H63.4001V31.4H67.2001V33.2999H61.2001V25.4ZM72.9001 25.2999H75.1001L78.5001 33.2999H76.1001L75.5001 31.9H72.4001L71.8001 33.2999H69.5001L72.9001 25.2999ZM74.9001 30.2L74.0001 28L73.1001 30.2H74.9001ZM81.3001 25.4H85.0001C85.4721 25.3616 85.947 25.4219 86.3946 25.5768C86.8422 25.7317 87.2527 25.978 87.6001 26.2999C87.8866 26.6089 88.0945 26.9822 88.2062 27.3885C88.3179 27.7947 88.3301 28.2219 88.2419 28.6339C88.1536 29.0459 87.9674 29.4306 87.699 29.7554C87.4306 30.0802 87.088 30.3356 86.7001 30.5L88.6001 33.2999H86.1001L84.5001 30.9H83.5001V33.2999H81.3001V25.4ZM84.9001 29.2C85.6001 29.2 86.1001 28.7999 86.1001 28.2999C86.1001 27.6999 85.6001 27.4 84.9001 27.4H83.5001V29.2999H84.9001V29.2ZM91.4001 25.4H97.8001V27.2H93.6001V28.4H97.4001V30.2H93.6001V31.4H97.9001V33.2999H91.4001V25.4ZM6.10006 30.2999C5.94924 30.6534 5.69863 30.9551 5.37893 31.1682C5.05922 31.3814 4.68429 31.4967 4.30006 31.5C3.76083 31.4736 3.25239 31.2409 2.88006 30.85C2.50774 30.459 2.30006 29.9398 2.30006 29.4C2.30006 28.8601 2.50774 28.3409 2.88006 27.95C3.25239 27.559 3.76083 27.3263 4.30006 27.2999C4.70902 27.3078 5.10676 27.435 5.44433 27.666C5.78191 27.897 6.0446 28.2216 6.20006 28.6H8.50006C8.30331 27.642 7.7734 26.7849 7.00446 26.1807C6.23552 25.5765 5.27732 25.2645 4.30006 25.2999C3.74729 25.282 3.19647 25.3743 2.67974 25.5715C2.16301 25.7686 1.69073 26.0668 1.29046 26.4484C0.89018 26.8301 0.569922 27.2876 0.348372 27.7944C0.126822 28.3011 0.00841661 28.8469 6.44058e-05 29.4C-0.00301373 29.9477 0.104273 30.4905 0.315523 30.9959C0.526773 31.5013 0.837658 31.959 1.22963 32.3416C1.62161 32.7243 2.08664 33.024 2.59698 33.223C3.10733 33.422 3.65253 33.5162 4.20006 33.5C5.15552 33.5064 6.08614 33.1958 6.84616 32.6167C7.60618 32.0376 8.15268 31.2228 8.40006 30.2999H6.10006Z"
                          fill="currentColor" />
                      </g>
                      <defs>
                        <clipPath id="clip0_263_28663">
                          <rect width="101.4" height="33.5" fill="white" />
                        </clipPath>
                      </defs>
                    </svg>
                  </div>

                </div>
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
                      <label for="message">What problem are you trying to
                        solve?</label>
                      <textarea
                        id="message"
                        required
                        rows={5}
                        value={formData().message}
                        onInput={handleInputChange("message")}
                        placeholder="We need help with"
                      />
                    </div>

                    <button type="submit" disabled={isSubmitting()}
                            data-component="submit-button">
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
