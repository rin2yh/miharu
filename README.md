# miharu

Slack、Notion、GitHubなど、複数サービスの公式ステータスをまとめて確認するダッシュボードです。

## 開発環境

- [mise](https://mise.jdx.dev/)で固定したNode.jsとpnpm
- Node.js `26.12.1`
- pnpm `11.5.1`

```sh
mise install
pnpm install --frozen-lockfile
```

## ローカルで動かす

```sh
pnpm db:migrate:local
pnpm dev
```

## インシデントの表示分類

公式APIの掲載形式と進行状態を分け、構造化された影響度・種別から「障害」「メンテナンス」「お知らせ」「分類不明」を表示します。影響なしの告知は「お知らせ」、根拠が足りない場合は「分類不明」とし、サービス全体の公式ステータスは変更しません。

## Discord通知

本番環境では、以下をDiscord Webhookへ通知します。

- サービスの収集失敗が3回連続した場合と、その復旧時
- 分類不明のインシデントを検出した場合

Webhook URLはCloudflare Secret `DISCORD_WEBHOOK_URL` に設定します。Preview環境では通知しません。

通知状態はWorkers KVで管理し、重複通知を可能な範囲で抑止します。分類不明の通知は送信失敗時に再試行するため、重複する場合があります。

## ライセンス

[MIT License](LICENSE)を適用しています。
