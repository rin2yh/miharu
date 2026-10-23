# miharu

Slack、Notion、GitHubなど、複数サービスの公式ステータスをまとめて確認するダッシュボードです。画面はReact、APIと収集処理はHono on Cloudflare Workers、最新状態とインシデント履歴はCloudflare D1で管理します。

## 開発環境

- [mise](https://mise.jdx.dev/)で固定したNode.jsとpnpm
- Node.js `26.12.1`
- pnpm `11.5.1`

```sh
mise install
pnpm install --frozen-lockfile
```

pnpmは公開から7日未満のパッケージをインストールしない設定です。ロックファイルを更新するときも、このルールが適用されます。Cloudflare CLI beta版と実行に必要な固定版だけ例外にしています。

## ローカルで動かす

ローカルのWorker、D1、React画面を使って、公式APIの取得から画面表示まで確認できます。ローカルD1は本番D1から分離され、データは`.cloudflare/state`に保存されます。

1. ローカルD1にスキーマを適用します。

   ```sh
   pnpm db:migrate:local
   ```

2. 開発サーバーを起動します。

   ```sh
   pnpm dev
   ```

   表示されたURL（通常は `http://localhost:5173`）をブラウザーで開きます。

3. 別のターミナルからCronを手動で実行します。

   ```sh
   curl "http://localhost:5173/cdn-cgi/local/scheduled?format=json"
   ```

   開発サーバーが別のポートを表示した場合は、URLのポートを合わせてください。Cronはローカルでは自動実行されないため、必要なときにこのリクエストを送ります。レスポンスは収集処理の完了を待たないので、完了後にAPIとD1を確認してください。収集は各サービスの公式APIへ実際にアクセスし、結果をローカルD1に保存します。

4. APIレスポンスとD1の保存結果を確認します。

   ```sh
   curl "http://localhost:5173/api/status"
   local_d1_file=$(find .cloudflare/state/v3/d1/miniflare-D1DatabaseObject -name 'db*.sqlite' -print -quit)
   sqlite3 "$local_d1_file" "SELECT service_id, status, last_success_at FROM service_status ORDER BY service_id; SELECT service_id, id, title, state, active FROM incidents ORDER BY service_id, official_created_at;"
   ```

   履歴は `incident_events` テーブルで確認できます。2回目以降のCron実行では、新しいインシデントや内容の変更があった場合だけイベントが追加されます。`cf d1 query`はローカルD1に対応していないため、上の例ではSQLite CLIを使います。ローカルデータを消して最初から確認する場合は、`pnpm db:migrate:local`の前に`.cloudflare/state`内のD1状態を削除してください。

## 開発コマンド

```sh
pnpm dev                 # Cloudflare Vite Pluginでローカル実行
pnpm lint                # OxlintとOxfmt
pnpm test                # Vitestと60%以上のカバレッジ確認
pnpm typecheck           # TypeScriptの型確認
pnpm build               # 型確認とWorker/Reactの本番ビルド
pnpm cf-typegen          # cloudflare.config.tsからWorker型を更新
```

テストはプロバイダーのレスポンス正規化、収集失敗時の状態保持、インシデントの追加・更新・復旧・重複排除、APIレスポンス、画面表示と手動更新を確認します。テスト中に外部SaaSへリクエストは送りません。

## サービスを追加する

サービス一覧は [`src/shared/config/services.ts`](src/shared/config/services.ts) にあり、設定の変更はデプロイ後に反映されます。取得方式を選んで、既存の共通処理を使います。

- Atlassian Statuspage互換JSON: `provider: "statuspage"` を指定します。Slack以外の初期サービス（NotionとGitHub）もこの実装を使います。
- 独自API: `src/cron/providers/` にサービス用パーサーを追加し、`ServiceConfig`の判別可能なprovider種別と `fetchServiceSnapshot` に登録します。Slackはこの方式です。
- RSS/Atomなど: 共通化が必要になった時点でフィード用パーサーを追加し、取得元ごとの日時や状態を元データのまま保持します。

プロバイダーは `ProviderSnapshot` と `NormalizedIncident` に正規化します。公式の全体ステータスと、個別インシデントの重要度は別々に保存します。取得URLはコード上の設定に限定し、インシデント本文やURLは長さ・形式・許可ホストを検証してから利用します。

プロバイダーを追加・変更する際は、`src/cron/providers/providers.test.ts` のテーブル駆動テストに実レスポンス例を追加してください。新しい外部APIを使う場合、認証情報はコードやREADMEに置かず、必要性を確認してからCloudflareのSecretsを使います。

### 初期サービスの取得元

| サービス | 公式取得元                                                              | 形式               | 主な取得項目                                          |
| -------- | ----------------------------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| Slack    | [公式API](https://slack-status.com/api/v2.0.0/current)                  | Slack独自JSON      | 全体status、active incidents、notes、services         |
| Notion   | [公式Statuspage API](https://www.notion-status.com/api/v2/summary.json) | Statuspage互換JSON | status、components、incidents                         |
| GitHub   | [公式Statuspage API](https://www.githubstatus.com/api/v2/summary.json)  | Statuspage互換JSON | status、components、incidents、scheduled maintenances |

Notionの公開ステータスページは `notion-status.com` に移行しています。画面から開くリンクは現行の [Notion公式ステータスページ](https://www.notion-status.com/) を使います。APIが返さない時刻、重要度、コンポーネントなどは `null` または空のまま保持します。Slackの `active` はインシデントの進行状態で、サービス全体の状態とは区別します。

## アーキテクチャとデータ保持

- Workers Static AssetsがReactの静的ファイルを配信し、`/api/*` はHonoに渡します。APIは読み取り専用の `GET /api/status` です。
- `src/web/` はReact画面とHonoの読み取りAPI、`src/cron/` は定期収集とProvider、`src/domain/` は状態モデル・正規化・インシデント差分、`src/shared/` はWebとCronが共用するサービス設定とD1ストア、`src/index.ts` はCloudflare Workerの入口です。`db/` はD1の型と `db/migrations/` のSQLをまとめています。

```text
src/
├── index.ts                    # Worker entry: HTTP と scheduled() を接続
├── web/                        # React UI と Hono API
│   └── routes/api/status.ts
├── cron/                       # 定期収集と取得Provider
│   ├── collect-status.ts
│   └── providers/
├── domain/                     # 状態モデル・識別子・障害履歴の差分
└── shared/                     # Web/Cron共通の設定とD1ストア
    └── config/services.ts
db/
├── schema.ts                   # D1 row types
└── migrations/                 # SQL migrations
```

WebとCronは共通設定・D1ストアを利用します。ドメイン層はWorker、Hono、D1に依存しません。Providerのレスポンス解析はCron側に置き、正規化後の値をドメインモデルに渡します。

- Cron Triggerは毎分実行し、各サービスを並列・サービス単位のタイムアウト付きで取得します。1サービスの失敗は他サービスの保存に影響しません。
- 公式取得の失敗は対象サービスの障害状態に変換しません。最後に成功した状態を残し、取得失敗と最終成功から3分を超えた古い情報を画面に示します。
- `service_status` は各サービスの最新状態と取得時刻、`incidents` はインシデントの最新状態、`incident_events` は検知した変更を保存します。正常ポーリング結果は履歴に追加しません。
- 履歴の保持期間は [`src/shared/config/services.ts`](src/shared/config/services.ts) の `INCIDENT_HISTORY_RETENTION_DAYS` で変更できます。15分ごとのCronで期限切れイベントと復旧済みインシデントを削除します。
- 公式インシデントIDがない場合は、発生時刻とURLが取れればその組み合わせ、どちらもなければタイトルを使って安定IDを作成します。変更イベントはインシデントのrevisionを含むIDで重複を防ぎます。

## Cloudflare Free枠の目安

2026-10-23時点で、Workers FreeはHTTPリクエスト10万回/日、HTTPとCronのCPU時間はそれぞれ1回10ms、Cron Triggerはアカウントあたり5個です。D1 Freeは行読み取り500万回/日、行書き込み10万回/日、合計5GBです。上限を超えると、Free枠ではその日のD1クエリが失敗することがあります。

画面を開き続けた場合、1クライアントあたり約1,440回/日のAPIポーリングです。HTTP枠をすべて画面更新に使う単純計算では、24時間連続表示がおよそ69クライアント分に相当します（他のHTTPリクエストを除く）。実際のアクセス数とCloudflareの使用量を確認してください。50サービス程度なら取得先あたりのCron実行数は増やさず、D1書き込み量はサービス数に応じて増加します。

## デプロイとD1スキーマ変更

Workers Buildsは`main`へのpushで本番へデプロイし、Pull Requestごとにプレビューを作成します。Workerの設定は[`cloudflare.config.ts`](cloudflare.config.ts)で管理します。プレビューは専用D1を使い、Cron Triggerは登録しません。本番D1および定期収集処理から分離しています。ローカルから手動でデプロイするときは、ビルド後に対象D1のmigrationを適用してからdeployします。

D1のスキーマを変更する場合は既存のmigration SQLを編集せず、`db/migrations/`に新しい連番SQLを追加します。まずローカルで確認してください。Workers Buildsは本番デプロイ前に本番D1へ、プレビューのデプロイ前にプレビューD1へ未適用のmigrationを適用します。適用済みmigrationは再実行されません。

```sh
pnpm db:migrate:local
pnpm build && pnpm db:migrate:remote && pnpm deploy
pnpm db:migrate:preview && pnpm preview:deploy
```

通常のアプリ更新でmigrationがなければ、Workers Buildsのmigration適用は何も変更しません。スキーマ変更は旧Workerでも動くように段階的に行い、列の追加とアプリ側の切り替えを分け、不要な列の削除は後続のmigrationにしてください。

## ライセンス

未設定です。
