import type { FC } from "hono/jsx"
import { raw } from "hono/html"
import type { SessionIndex } from "../types.ts"
import Layout from "./layout.tsx"

const formatTime = (ts: number) =>
  new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

const SessionList: FC<{ sessions: SessionIndex[] }> = ({ sessions }) => (
  <Layout title="Sessions">
    <h1 style="margin-bottom: 1rem; font-size: 20px;">Sessions</h1>
    <input type="text" class="search-box" placeholder="Search sessions..." id="search" />
    <div id="session-list">
      {sessions.map((s) => (
        <a href={`/share/${s.id}`} class="session-card" data-title={(s.title || "").toLowerCase()}>
          <div class="session-title">{s.title || "Untitled"}</div>
          <div class="meta">
            {s.directory ? <span>{s.directory} · </span> : null}
            <span>{s.messageCount} messages · </span>
            <span>{s.syncCount} syncs · </span>
            <span>{formatTime(s.lastUpdated)}</span>
          </div>
        </a>
      ))}
    </div>
    <script>
      {raw(`
      document.getElementById('search').addEventListener('input', function(e) {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.session-card').forEach(function(card) {
          card.style.display = card.getAttribute('data-title').includes(q) ? '' : 'none';
        });
      });
    `)}
    </script>
  </Layout>
)

export default SessionList
