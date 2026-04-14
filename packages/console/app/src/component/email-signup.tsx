import { action, useSubmission } from "@solidjs/router"
import dock from "../asset/lander/dock.png"
import { Resource } from "@opencode-ai/console-resource"
import { Show } from "solid-js"

const emailSignup = action(async (formData: FormData) => {
  "use server"
  const emailAddress = formData.get("email")!
  const listId = "8b9bb82c-9d5f-11f0-975f-0df6fd1e4945"
  const response = await fetch(`https://api.emailoctopus.com/lists/${listId}/contacts`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${Resource.EMAILOCTOPUS_API_KEY.value}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: emailAddress,
    }),
  })
  console.log(response)
  return true
})

export function EmailSignup() {
  const submission = useSubmission(emailSignup)
  return (
    <section data-component="email">
      <div data-slot="section-title">
        <h3>Be the first to know when we release new products</h3>
        <p>Join the waitlist for early access.</p>
      </div>
      <form data-slot="form" action={emailSignup} method="post">
        <input type="email" name="email" placeholder="Email address" required />
        <button type="submit" disabled={submission.pending}>
          Subscribe
        </button>
      </form>
      <Show when={submission.result}>
        <div style="color: #03B000; margin-top: 24px;">
          Almost done, check your inbox and confirm your email address
        </div>
      </Show>
      <Show when={submission.error}>
        <div style="color: #FF408F; margin-top: 24px;">{submission.error}</div>
      </Show>
    </section>
  )
}
