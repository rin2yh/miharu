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

本番では、3回連続したサービス別の収集失敗と復旧をDiscord Webhookへ通知します。Webhook URLはCloudflare Secret `DISCORD_WEBHOOK_URL` に設定します。

```sh
pnpm exec wrangler secret put DISCORD_WEBHOOK_URL
```

Previewでは通知を無効にし、ローカル開発でもWebhookへ送信しません。

サービス別の連続失敗回数と通知済み状態はWorkers KVに保存します。失敗が3回に達した後は、追加の失敗ごとにKVを書き換えません。復旧時に状態を削除します。

分類不明のインシデントは、3回の閾値を待たずに通知します。環境、サービス、インシデントID・タイトル、公式の種別・影響度・進行状態、URL、検出時刻を通知し、Discordメンションを無効化します。同じインシデントの同じ分類根拠は再通知せず、根拠が変わっても分類不明なら再通知します。

通知済み状態はWebhook送信の成功後に保存します。送信失敗は構造化ログに残し、次回の収集で再試行します。分類不明や通知失敗は収集失敗として扱わず、D1保存を継続します。分類通知の状態は収集失敗回数と別のKVキーで管理します。

Workers KV Free枠は書き込み・削除が各1,000回/日です。連続失敗中は通知まで最大3回書き込み、通知後は復旧まで書き込みません。KVは結果整合性のため、競合時は失敗回数や通知タイミングがずれる可能性があります（[利用上限](https://developers.cloudflare.com/kv/platform/limits/)、[整合性と同時更新](https://developers.cloudflare.com/kv/concepts/how-kv-works/)）。

## ライセンス

[MIT License](LICENSE)を適用しています。
