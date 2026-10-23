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

ブランチごとの Worker Previews を利用しています。Preview 用 D1 のマイグレーションは以下で実行できます。

```sh
pnpm db:migrate:preview
```

## ライセンス

[MIT License](LICENSE)を適用しています。
