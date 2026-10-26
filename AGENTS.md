# Agent Rules

このルールに記載の内容は必ず守ること。

## 基本方針

## ドキュメントの記載先

- READMEにはプロジェクト概要と、利用者や開発参加者が理解・導入・起動・利用するために必要な情報を書く。
- エージェント向けの作業指示、個別テストの実行方法、CIやGit hooksの運用ルールは `AGENTS.md` に記載する。READMEにも載せるのは、一般の利用者にも必要な情報に限る。
  - 理由: READMEをプロジェクトの入口として保ち、利用案内と作業ルールの重複を避ける。

## ソースファイルの命名

- 手書きのソースコードとテストのファイル名は kebab-case にする。設定ファイルと生成物は各ツールが要求する名称に従う。Reactコンポーネントのファイル名もPascalCaseにせず、export名はPascalCaseのままにする。
  - 大文字小文字を区別する環境でimportの食い違いが起きるのを防ぎ、命名を統一する。

## プロジェクト概要

Slack、Notion、GitHubなど複数サービスの公式ステータスを集約する。画面はReact、APIと収集処理はHono on Cloudflare Workers、最新状態とインシデント履歴はCloudflare D1で管理する。

## アーキテクチャとデータ保持

- Workers Static AssetsがReactの静的ファイルを配信し、`/api/*` はHonoに渡す。APIは読み取り専用の `GET /api/status`。
- `src/web/` はReact画面とHonoの読み取りAPI、`src/cron/` は定期収集とProvider、`src/domain/` は状態モデル・正規化・インシデント差分、`src/shared/` はWebとCronが共用するサービス設定とD1ストア、`src/index.ts` はCloudflare Workerの入口。`db/` はD1の型と `db/migrations/` のSQLをまとめる。

```text
src/
├── index.ts                    # Worker entry: HTTP と scheduled() を接続
├── web/                        # React UI と Hono API
│   ├── components/              # React表示コンポーネントとテスト
│   ├── filters/                 # URLサービスフィルターとテスト
│   ├── presentation/            # 状態表示・日時フォーマット
│   └── routes/api/status.ts
├── cron/                       # 定期収集と通知
│   └── collect-status.ts
├── adapter/                    # 外部APIアクセスと解析
│   └── statuspage.ts
├── domain/                     # 状態モデル・正規化・インシデント差分
└── shared/                     # Web/Cron共通の設定とD1ストア
    └── config/services.ts
db/
├── schema.ts                   # D1 row types
└── migrations/                 # SQL migrations
```

WebとCronは共通設定・D1ストアを利用する。ドメイン層はWorker、Hono、D1に依存しない。AdapterはCronに依存せず、外部レスポンスを正規化してドメインモデルに渡す。

- Cron Triggerは毎分実行し、各サービスを並列・サービス単位のタイムアウト付きで取得する。1サービスの失敗は他サービスの保存に影響しない。
- 公式取得の失敗は対象サービスの障害状態に変換しない。最後に成功した状態を残し、取得失敗と最終成功から3分を超えた古い情報を画面に示す。
- `service_status` は各サービスの最新状態と取得時刻、`incidents` はインシデントの最新状態、`incident_events` は検知した変更を保存する。正常ポーリング結果は履歴に追加しない。
- 履歴の保持期間は `src/shared/config/services.ts` の `INCIDENT_HISTORY_RETENTION_DAYS` で変更できる。15分ごとのCronで期限切れイベントと復旧済みインシデントを削除する。
- 公式インシデントIDがない場合は、発生時刻とURLが取れればその組み合わせ、どちらもなければタイトルを使って安定IDを作成する。変更イベントはインシデントのrevisionを含むIDで重複を防ぐ。

## サービス設定とProvider

サービス一覧は `src/shared/config/services.ts` にある。取得方式を選んで既存の共通処理を使う。

- Atlassian Statuspage互換JSON: `provider: "statuspage"` を指定する。NotionとGitHubもこの実装を使う。
- ChatGPT: `provider: "openai-chatgpt"` を指定する。OpenAIのsummaryにインシデントがないため別APIを取得し、公式ページのChatGPTセクションに属するコンポーネントと明示的にChatGPT関連と分かるインシデントだけを使う。別APIは直近25件のみ返すため、一覧にないことを復旧とは扱わない。
- 独自API: `src/adapter/` にパーサーを追加し、`ServiceConfig` のprovider種別と `fetchServiceSnapshot` に登録する。Slackはこの方式。
- RSS/Atomなど: 共通化が必要になった時点でフィード用パーサーを追加し、取得元ごとの日時や状態を元データのまま保持する。

Providerの出力は `ProviderSnapshot` と `NormalizedIncident` に正規化する。公式の全体ステータスと個別インシデントの重要度は別々に保存する。取得URLはコード上の設定に限定し、インシデント本文やURLは長さ・形式・許可ホストを検証してから利用する。

Providerを追加・変更する際は、対応する `*.test.ts` に実レスポンス例を追加する。新しい外部APIに認証情報が必要な場合はコードに置かず、Cloudflare Secretsを使う。

| サービス | 公式取得元                                                                                                                    | 形式               | 主な取得項目                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| Slack    | [公式API](https://slack-status.com/api/v2.0.0/current)                                                                        | Slack独自JSON      | 全体status、active incidents、notes、services         |
| Notion   | [公式Statuspage API](https://www.notion-status.com/api/v2/summary.json)                                                       | Statuspage互換JSON | status、components、incidents                         |
| GitHub   | [公式Statuspage API](https://www.githubstatus.com/api/v2/summary.json)                                                        | Statuspage互換JSON | status、components、incidents、scheduled maintenances |
| Claude   | [公式Statuspage API](https://status.claude.com/api/v2/summary.json)                                                           | Statuspage互換JSON | status、components、incidents                         |
| ChatGPT  | [summary API](https://status.openai.com/api/v2/summary.json)、[incident API](https://status.openai.com/api/v2/incidents.json) | OpenAI独自JSON     | ChatGPTセクションのcomponents、関連incidents          |

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

D1ストアの実DB結合テストは `pnpm test` に含まれる。D1用projectだけを実行するときは `pnpm exec vitest run --project d1` を使う。各ケースでテスト用DBを初期化し、`db/migrations/` のマイグレーションを適用する。

## テスト方針

- 単体テストは、状態変換、差分計算、フィルター、日時表示、Providerレスポンスの解析など、外部I/Oを伴わないロジックを入力と出力で確認する。テストデータはfixtureに置く。
- コンポーネントテストは、Reactコンポーネントの表示状態、利用者操作、キーボード操作をTesting Libraryで確認する。スタイルクラスやピクセル単位の配置ではなく、アクセシブルな操作と画面上の結果を検証する。
- 結合テストは、複数レイヤーをつなぐ境界を確認する。D1のSQL・保存・読み出しはWorkers runtimeのD1を使い、既存のD1用projectで実行する。
- E2Eテストは、ブラウザー上の利用者操作から画面/APIの結果までを通す必要がある主要フローを確認する。Playwrightで固定fixtureを使い、単体・コンポーネント・結合テストで十分に確認できる内容は重複させない。
- レイアウト、余白、サイズ、整列、ブレークポイント、色など見た目の品質は、ローカル画面を対象の幅・テーマで表示して確認する。見た目の寸法を測るだけのE2Eは作らない。自動の視覚回帰が必要なら、差分を継続してレビューできる専用の仕組みを使う。
- テストは、変更で壊れうる利用者向けの振る舞いを最小の適切な層で保護する。検証手段ごとの詳細は `e2e/AGENTS.md` を参照する。

## PR本文とローカル動作確認

- PR本文に、型チェック・lint・単体テスト・E2EなどCIで確認できる検証結果を列挙しない。結果はCIのChecksで確認する。
- PR作成・更新前に、ローカル環境で変更した機能を起動し、利用者の操作またはAPIリクエストを実際に行って結果を確認する。自動テストだけでは代替しない。
- PR本文の動作確認には、実行したローカル操作と画面・APIで確認した結果を簡潔に記載する。ローカルで確認できない場合は、確認できる状態にしてからPRを作成・更新する。

## Cloudflare Free枠の目安

2026-10-23時点で、Workers FreeはHTTPリクエスト10万回/日、HTTPとCronのCPU時間はそれぞれ1回10ms、Cron Triggerはアカウントあたり5個。D1 Freeは行読み取り500万回/日、行書き込み10万回/日、合計5GB。上限を超えると、Free枠ではその日のD1クエリが失敗することがある。

画面を開き続けた場合、1クライアントあたり約1,440回/日のAPIポーリングになる。HTTP枠をすべて画面更新に使う単純計算では、24時間連続表示がおよそ69クライアント分に相当する（他のHTTPリクエストを除く）。実際のアクセス数とCloudflareの使用量を確認する。50サービス程度なら取得先あたりのCron実行数は増やさず、D1書き込み量はサービス数に応じて増加する。

## D1スキーマ変更

- 既存のmigration SQLは編集せず、`db/migrations/` に新しい連番SQLを追加する。
- まずローカルでmigrationを適用し、アプリの動作を確認する。
- スキーマ変更は旧Workerでも動くよう段階的に行う。列の追加とアプリ側の切り替えを分け、不要な列の削除は後続のmigrationにする。
- migrationの適用と履歴管理はWranglerに一本化する。Drizzle Kitでmigrationを生成・適用せず、migration適用後のテーブル定義を `db/schema.ts` に反映して型定義を同期する。
- `db/schema.ts` はアプリ実行時のDrizzleスキーマと行型の唯一の定義元にする。行型は `$inferSelect` から導出し、SQL migrationとDrizzle定義の両方を変更した場合は既存のD1結合テストで整合性を確認する。

## Git hooksと必須チェック

- `.githooks/pre-commit` と `.githooks/pre-push` は必ず有効にし、実行する。`--no-verify`、`core.hooksPath` の上書き、環境変数やラッパーなどによるhookの無効化・回避は禁止する。
- PR作成・更新前のcommitでは、pre-commitの型チェックと `pnpm test` を通す。pushではpre-pushの `pnpm e2e` を通す。
- hookが失敗した場合は原因を修正して再実行し、失敗したままpushしない。
- miseが `.mise.toml` の信頼を求めた場合は、内容を確認してから `mise trust .mise.toml` を実行する。信頼エラーをhook回避の理由にしない。
