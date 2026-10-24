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

## 収集エラー通知

本番では、3回連続したサービス別の収集失敗と復旧をDiscord Webhookへ通知します。Webhook URLはCloudflare Secret `DISCORD_WEBHOOK_URL` に設定します。

```sh
pnpm exec wrangler secret put DISCORD_WEBHOOK_URL
```

Previewでは通知を無効にし、ローカル開発でもWebhookへ送信しません。

## ライセンス

[MIT License](LICENSE)を適用しています。
