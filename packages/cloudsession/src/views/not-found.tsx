import type { FC } from "hono/jsx"
import Layout from "./layout.tsx"

const NotFound: FC = () => (
  <Layout title="Not Found">
    <h1 style="font-size: 20px;">404 - Not Found</h1>
    <p class="meta" style="margin-top: 0.5rem;">The session you're looking for doesn't exist.</p>
    <a href="/sessions" style="display: inline-block; margin-top: 1rem;">Back to sessions</a>
  </Layout>
)

export default NotFound
