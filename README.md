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

## カスタムOxlintルール

`pnpm lint` では、テーブル駆動化を検討できるVitestテストを警告する `miharu/prefer-table-driven-tests` ルールも実行します。検出条件と制限は[ルールのドキュメント](docs/lint-rules/prefer-table-driven-tests.md)を参照してください。

## ライセンス

[MIT License](LICENSE)を適用しています。
