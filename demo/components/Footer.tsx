export function Footer() {
  return (
    <footer className="relative border-t border-sc-border bg-sc-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="font-mono text-xs tracking-widest text-sc-text-mid">
            Acompanyセキュアコード
          </div>
          <p className="mt-2 max-w-md text-xs leading-relaxed text-sc-text-dim">
            Confidential AI Suite の第 2 弾製品として、機密ソースコードを
            漏洩させずに AI コーディング支援を実現します。第 1 弾製品は{" "}
            <a
              href="https://service.acompany.tech/cas/secure-chat/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sc-text-mid underline underline-offset-2 hover:text-sc-ember"
            >
              Acompanyセキュアチャット
            </a>
            。
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-12 gap-y-2 font-mono text-xs text-sc-text-mid">
          <a href="#problem" className="hover:text-sc-text">課題</a>
          <a href="#tee" className="hover:text-sc-text">TEE 保護</a>
          <a href="#harness" className="hover:text-sc-text">ハーネス</a>
          <a href="#coding" className="hover:text-sc-text">AI 開発</a>
          <a href="#compare" className="hover:text-sc-text">比較</a>
          <a href="#top" className="hover:text-sc-text">トップへ</a>
        </nav>
      </div>

      <div className="border-t border-sc-border/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-6 text-[11px] text-sc-text-dim md:flex-row md:items-center md:justify-between">
          <p className="font-mono">
            ※ このページは Acompanyセキュアコード を紹介するための{" "}
            <span className="text-sc-ember">架空のデモ</span> であり、
            表示しているレスポンス・指標値・図版はすべてモックです。
          </p>
          <p className="font-mono">© Acompany Co., Ltd. demo build</p>
        </div>
      </div>
    </footer>
  )
}
