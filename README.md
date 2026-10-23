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


## Preview 環境

Cloudflare Workers Builds の **Worker Previews** を利用し、ブランチごとに独立した Preview URL を発行します。Preview は `miharu-status-preview` D1 を共有します。本番 D1 は使用しません。

ローカルから Preview をデプロイする場合:

```sh
pnpm preview:deploy
```

既存の `miharu-preview` Worker は Preview 用 D1 にデータを収集するための **15分間隔の Cron 専用 Worker** として残します。Worker Previews 自体は Cron Trigger に対応していません。必要なときに `pnpm preview:collector:deploy` で収集 Worker を更新します。D1 のマイグレーションは `pnpm db:migrate:preview` で、共有 DB に対して一度だけ実行します。

### Workers Builds の切り替え（初回のみ）

1. Cloudflare ダッシュボードの `miharu` Worker → **Settings → Builds** で **Set up Worker Previews** を選択します（元に戻せない変更です）。
2. Preview の変数・D1・Assets を `wrangler.jsonc` の `previews` に合わせます。
3. Preview command を `pnpm preview:deploy`（Build command を別途実行する構成なら `pnpm wrangler preview`）に設定します。既存の Build command との二重ビルドを避けてください。
4. Preview builds を有効にし、PR の Cloudflare コメントにブランチ固有 URL が表示されることを確認します。
5. Cloudflare Access で Preview URL を保護する場合は、新しい Worker Previews の URL にもポリシーを適用します。

ブランチ固有 Preview のデプロイ成功後、別のブランチを更新しても URL とコードが上書きされないことを確認してください。共有 D1 のスキーマ変更には注意が必要です。

## ライセンス

[MIT License](LICENSE)を適用しています。
