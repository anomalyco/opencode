# OpenCode-Trading Roadmap

このリポジトリの運用上の優先計画は以下の分離ドキュメントに分割されています。

- [STRATEGY_ADOPTION_PLAN.md](./STRATEGY_ADOPTION_PLAN.md): 戦略採択の方針と判断基準
- [EA_TRADING_PLAN.md](./EA_TRADING_PLAN.md): 取引実装・リリースの基底計画
- [SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md](./SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md): sentinel work の実装順序
- [FINAL_IMPLEMENTATION_PLAN.md](./FINAL_IMPLEMENTATION_PLAN.md): 開発上の最終制約・進行条件
- [PHASE1_MEMORY_ORACLE.md](./PHASE1_MEMORY_ORACLE.md): memory handoffの基盤設計
- [docs/ea-lab-memory-foundations.md](./docs/ea-lab-memory-foundations.md): trade memory foundation の実装詳細

運用ルール:

- Phase の開始・終了や新規制約の追加はまず `EA_TRADING_PLAN.md` を更新し、必要に応じて各実装計画へ反映する。
- 2週間単位の進捗管理は `SPRINT.md` を更新し、リポジトリ横断で実行証跡が追える状態を保つ。
