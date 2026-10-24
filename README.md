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

サービス別の連続失敗回数と通知済み状態はWorkers KVに保存します。失敗が3回に達した後は、追加の失敗ごとにKVを書き換えません。復旧時に状態を削除します。

通知済み状態を保存してからWebhookへ1回送信します。Webhook送信に失敗しても自動再送しません。失敗は構造化ログに記録します。

Workers KV Free枠は書き込み・削除が各1,000回/日です。連続失敗中は通知まで最大3回書き込み、通知後は復旧まで書き込みません。KVは結果整合性のため、競合時は失敗回数や通知タイミングがずれる可能性があります（[利用上限](https://developers.cloudflare.com/kv/platform/limits/)、[整合性と同時更新](https://developers.cloudflare.com/kv/concepts/how-kv-works/)）。

## ライセンス

[MIT License](LICENSE)を適用しています。
