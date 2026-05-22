# keyvisual — 広告クリエイティブ用 SVG アセット

Acompany Secure Code の広告クリエイティブを Figma 上で量産するための
ベクター素材集。すべて `demo/scripts/build-keyvisuals.ts` から生成されている。

## 含まれるファイル

| ファイル | 用途 | サイズ |
| --- | --- | --- |
| `square.svg` | SNS feed (1:1) テンプレート | 1200 × 1200 |
| `wide.svg` | Display banner (16:9) テンプレート | 1920 × 1080 |
| `library.svg` | Figma 取り込み用ステッカーシート (全 atom + 配色) | 1600 × 2620 |
| `atoms/wordmark.svg` | SECURE CODE ピクセルロゴ | 個別 |
| `atoms/palette.svg` | 14 色のカラースウォッチ + hex | 個別 |
| `atoms/terminal.svg` | macOS 風ターミナル枠モック | 個別 |
| `atoms/tee-diagram.svg` | Dev → AES → TEE → OK のフロー図 | 個別 |
| `atoms/value-pills.svg` | 3 値訴求カード (TEE / HARNESS / 開発加速) | 個別 |
| `atoms/stamp.svg` | "CONFIDENTIAL AI SUITE / 第2弾製品" スタンプ | 個別 |
| `atoms/footer.svg` | ACOMPANY ブランドフッター行 | 個別 |
| `*.png` | プレビュー用ラスタライズ (rsvg-convert 出力) | 確認用 |

## Figma での使い方

1. Figma で新規ファイル → `library.svg` をキャンバスにドラッグ&ドロップ
2. レイヤーパネルで `01 WORDMARK` / `02 PALETTE` などのグループを選択
3. 右クリック → **Create Component** (⌘+⌥+K) で Component 化
4. `square.svg` / `wide.svg` を別ページに開き、Component インスタンスを差し替えて量産

SVG 内のテキストは Inter / Noto Sans JP / JetBrains Mono を指定しているので、
Figma 側で同名フォントが有効化されていれば編集可能なテキストレイヤーとして
扱える。

## 再生成

`scripts/build-keyvisuals.ts` の定数 (PAL, FLOW テキスト, 値訴求のラベル等)
を編集して再実行する:

```bash
cd demo
bun scripts/build-keyvisuals.ts                              # SVG 出力
rsvg-convert -w 1200 -h 1200 public/keyvisual/square.svg \   # 任意で PNG 化
  -o public/keyvisual/square.png
rsvg-convert -w 1920 -h 1080 public/keyvisual/wide.svg \
  -o public/keyvisual/wide.png
rsvg-convert -w 1600 -h 2620 public/keyvisual/library.svg \
  -o public/keyvisual/library.png
```

`rsvg-convert` は `brew install librsvg` で入る。

## 配色 / 文字サイズ / 寸法はどこから来ているか

- 配色: `demo/app/globals.css` の `--color-sc-*` トークン (本体 packages/ui の
  Radix スケール由来)
- wordmark: `demo/components/Wordmark.tsx` と同じ 5×7 ピクセルビットマップ定義
- フォント: 本体と同じ Inter / Noto Sans JP / JetBrains Mono
