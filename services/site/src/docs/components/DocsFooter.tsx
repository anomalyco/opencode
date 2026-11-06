// The status comes in through client.ts.
export function DocsFooter() {
  return (
    <footer class="site-footer">
      <div class="footer-inner">
        <a class="system-status" href="/status" data-status="unknown">
          System status
        </a>
      </div>
    </footer>
  )
}
