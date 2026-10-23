# Agent Rules

このルールに記載の内容は必ず守ること。

## 基本方針

## プロジェクト概要

Slack、Notion、GitHubなど複数サービスの公式ステータスを集約する。画面はReact、APIと収集処理はHono on Cloudflare Workers、最新状態とインシデント履歴はCloudflare D1で管理する。

## アーキテクチャとデータ保持

- Workers Static AssetsがReactの静的ファイルを配信し、`/api/*` はHonoに渡す。APIは読み取り専用の `GET /api/status`。
- `src/web/` はReact画面とHonoの読み取りAPI、`src/cron/` は定期収集とProvider、`src/domain/` は状態モデル・正規化・インシデント差分、`src/shared/` はWebとCronが共用するサービス設定とD1ストア、`src/index.ts` はCloudflare Workerの入口。`db/` はD1の型と `db/migrations/` のSQLをまとめる。

```text
src/
├── index.ts                    # Worker entry: HTTP と scheduled() を接続
├── web/                        # React UI と Hono API
│   └── routes/api/status.ts
├── cron/                       # 定期収集と取得Provider
│   ├── collect-status.ts
│   └── providers/
├── domain/                     # 状態モデル・正規化・インシデント差分
└── shared/                     # Web/Cron共通の設定とD1ストア
    └── config/services.ts
db/
├── schema.ts                   # D1 row types
└── migrations/                 # SQL migrations
```

WebとCronは共通設定・D1ストアを利用する。ドメイン層はWorker、Hono、D1に依存しない。Providerのレスポンス解析はCron側に置き、正規化後の値をドメインモデルに渡す。

- Cron Triggerは毎分実行し、各サービスを並列・サービス単位のタイムアウト付きで取得する。1サービスの失敗は他サービスの保存に影響しない。
- 公式取得の失敗は対象サービスの障害状態に変換しない。最後に成功した状態を残し、取得失敗と最終成功から3分を超えた古い情報を画面に示す。
- `service_status` は各サービスの最新状態と取得時刻、`incidents` はインシデントの最新状態、`incident_events` は検知した変更を保存する。正常ポーリング結果は履歴に追加しない。
- 履歴の保持期間は `src/shared/config/services.ts` の `INCIDENT_HISTORY_RETENTION_DAYS` で変更できる。15分ごとのCronで期限切れイベントと復旧済みインシデントを削除する。
- 公式インシデントIDがない場合は、発生時刻とURLが取れればその組み合わせ、どちらもなければタイトルを使って安定IDを作成する。変更イベントはインシデントのrevisionを含むIDで重複を防ぐ。

## サービス設定とProvider

サービス一覧は `src/shared/config/services.ts` にある。取得方式を選んで既存の共通処理を使う。

- Atlassian Statuspage互換JSON: `provider: "statuspage"` を指定する。NotionとGitHubもこの実装を使う。
- 独自API: `src/cron/providers/` にパーサーを追加し、`ServiceConfig` のprovider種別と `fetchServiceSnapshot` に登録する。Slackはこの方式。
- RSS/Atomなど: 共通化が必要になった時点でフィード用パーサーを追加し、取得元ごとの日時や状態を元データのまま保持する。

Providerの出力は `ProviderSnapshot` と `NormalizedIncident` に正規化する。公式の全体ステータスと個別インシデントの重要度は別々に保存する。取得URLはコード上の設定に限定し、インシデント本文やURLは長さ・形式・許可ホストを検証してから利用する。

Providerを追加・変更する際は `src/cron/providers/providers.test.ts` のテーブル駆動テストに実レスポンス例を追加する。新しい外部APIに認証情報が必要な場合はコードに置かず、Cloudflare Secretsを使う。

| サービス | 公式取得元                                                              | 形式               | 主な取得項目                                          |
| -------- | ----------------------------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| Slack    | [公式API](https://slack-status.com/api/v2.0.0/current)                  | Slack独自JSON      | 全体status、active incidents、notes、services         |
| Notion   | [公式Statuspage API](https://www.notion-status.com/api/v2/summary.json) | Statuspage互換JSON | status、components、incidents                         |
| GitHub   | [公式Statuspage API](https://www.githubstatus.com/api/v2/summary.json)  | Statuspage互換JSON | status、components、incidents、scheduled maintenances |

Notionの公開ステータスページは `notion-status.com` に移行している。画面から開くリンクは現行の [Notion公式ステータスページ](https://www.notion-status.com/) を使う。APIが返さない時刻、重要度、コンポーネントなどは `null` または空のまま保持する。Slackの `active` はインシデントの進行状態で、サービス全体の状態とは区別する。

## ローカルでの動作確認

ローカルのWorker、D1、React画面を使って、公式APIの取得から画面表示まで確認できる。ローカルD1は本番D1から分離され、データは `.wrangler/state` に保存される。

1. ローカルD1にスキーマを適用する。

   ```sh
   pnpm db:migrate:local
   ```

2. 開発サーバーを起動する。

   ```sh
   pnpm dev
   ```

3. Cronを手動実行する。ローカルでは自動実行されない。開発サーバーが表示したURLとポートを使う。

   ```sh
   curl "http://localhost:5173/cdn-cgi/local/scheduled?format=json"
   ```

   レスポンスは収集処理の完了を待たないため、完了後にAPIとD1を確認する。Cronは公式APIへ実際にアクセスし、取得結果をローカルD1に保存する。

4. APIレスポンスとD1の保存結果を確認する。

   ```sh
   curl "http://localhost:5173/api/status"
   pnpm exec wrangler d1 execute miharu-status --local --command "SELECT service_id, status, last_success_at FROM service_status ORDER BY service_id"
   pnpm exec wrangler d1 execute miharu-status --local --command "SELECT service_id, id, title, state, active FROM incidents ORDER BY service_id, official_created_at"
   ```

   履歴は `incident_events` テーブルで確認できる。2回目以降のCron実行では、新しいインシデントや内容の変更があった場合だけイベントが追加される。ローカルデータを消して最初から確認する場合は、`pnpm db:migrate:local` の前に `.wrangler/state` 内のD1状態を削除する。

## Cloudflare Free枠の目安

2026-10-23時点で、Workers FreeはHTTPリクエスト10万回/日、HTTPとCronのCPU時間はそれぞれ1回10ms、Cron Triggerはアカウントあたり5個。D1 Freeは行読み取り500万回/日、行書き込み10万回/日、合計5GB。上限を超えると、Free枠ではその日のD1クエリが失敗することがある。

画面を開き続けた場合、1クライアントあたり約1,440回/日のAPIポーリングになる。HTTP枠をすべて画面更新に使う単純計算では、24時間連続表示がおよそ69クライアント分に相当する（他のHTTPリクエストを除く）。実際のアクセス数とCloudflareの使用量を確認する。50サービス程度なら取得先あたりのCron実行数は増やさず、D1書き込み量はサービス数に応じて増加する。

## D1スキーマ変更

- 既存のmigration SQLは編集せず、`db/migrations/` に新しい連番SQLを追加する。
- まずローカルでmigrationを適用し、アプリの動作を確認する。
- スキーマ変更は旧Workerでも動くよう段階的に行う。列の追加とアプリ側の切り替えを分け、不要な列の削除は後続のmigrationにする。
