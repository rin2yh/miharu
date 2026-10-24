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

Cloudflare Workersのローカルランタイム上で、既存のD1マイグレーションを適用した実DBに対してストアの結合テストを実行します。テスト用DBは実行ごとに初期化されます。

```sh
pnpm test:d1
```

CIでも通常の単体テストに続けて実行します。

## ライセンス

[MIT License](LICENSE)を適用しています。
