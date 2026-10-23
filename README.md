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

Cloudflare Workers Builds の Worker Previews を利用して、ブランチごとに独立した URL を発行します。Preview は専用の共有 D1 `miharu-status-preview` を使用し、本番 D1 は使用しません。

```sh
pnpm preview:deploy
```

共有 D1 のスキーマ変更は、必要な場合に明示的に一度だけ実行してください。

```sh
pnpm db:migrate:preview
```

Worker Previews には Cron Trigger がなく、Preview D1 は自動更新されません。検証用データの投入・更新方法は別途用意する必要があります。旧 `miharu-preview` Worker へのデプロイ設定は撤去しましたが、**Cloudflare 上に既存の Worker が存在する場合は、動作確認後にダッシュボードから削除してください**。旧 Worker を残したままにすると Cron が引き続き稼働する可能性があります。

### Workers Builds の設定

- ビルド コマンド: `pnpm run build`
- プレビュー コマンド: `pnpm wrangler preview`
- Preview ブランチのビルド: 有効

以前の `pnpm run db:migrate:preview && pnpm run preview:deploy` は使わないでください。プレビュー URL を確認し、異なる2ブランチが互いを上書きしないことを確認してください。新しい Preview URL の Cloudflare Access 保護も確認してください。

## ライセンス

[MIT License](LICENSE)を適用しています。
