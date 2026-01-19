import { A } from "@solidjs/router"

export function Legal() {
  return (
    <div data-component="legal">
      <span>
        ©{new Date().getFullYear()} <a href="https://anoma.ly">Anomaly</a>
      </span>
      <span>
        <A href="/brand">Brand</A>
      </span>
      <span>
        <A href="/legal/privacy-policy">Privacy</A>
      </span>
      <span>
        <A href="/legal/terms-of-service">Terms</A>
      </span>
    </div>
  )
}
