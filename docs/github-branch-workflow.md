# GitHub Branch Workflow

## 現行方針

- `dev` を開発本線とする
- `main` への merge は当面行わない
- 新規 PR はすべて `dev` に対して切る
- 作業 branch は `dev` から切る
- `main` の扱いは release の節目で再検討する

## 理由

`main` と `dev` は現在 unrelated histories の状態である。`dev` を本線として扱うことで、通常開発における履歴統合のリスクを回避する。

## 5 ステップ運用

1. `dev` を開発の基準 branch とする
2. GitHub の default branch を `dev` に切り替える（可能であれば）
3. `dev` から作業 branch を切る。命名は `feat/...` `fix/...` `docs/...` など
4. PR の base branch は `dev` にする
5. `main` は凍結して触らない。将来の release 判断で `dev` から再作成、廃止、または `dev` を正式本線とするかを決定する

## 実運用ルール

- 開発: `dev`
- PR base: `dev`
- `main`: 保留
