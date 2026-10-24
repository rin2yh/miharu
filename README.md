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

## D1の実DB結合テスト

`pnpm test`には、Cloudflare Workersのローカルランタイム上で既存のD1マイグレーションを適用するストアの結合テストも含まれます。テスト用DBは各ケースの前に初期化されます。

```sh
pnpm test
```

D1結合テストだけを実行する場合は、Vitestのproject指定を使います。

```sh
pnpm exec vitest run --project d1
```

## ライセンス

[MIT License](LICENSE)を適用しています。
