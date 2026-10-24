# prefer-table-driven-tests

`miharu/prefer-table-driven-tests` は、Vitest の同じ `describe` ブロック内に、テスト本体のAST構造が一致し、プリミティブなリテラル値だけが異なる個別テストがある場合に警告します。入力値と期待値をテーブルにまとめ、`it.each()` または `test.each()` を使える候補を知らせます。

## 検出条件

- `vitest` から名前付きで import した `describe` と `it` / `test` を使う
- 同じ `describe` コールバック直下にあるテストを比較する
- テスト名が文字列リテラルで、テスト本体がインラインの同期関数である
- テスト本体が1つの式だけで、`expect()` を含む
- テスト本体のAST構造が一致し、文字列・数値・真偽値・`null` の値が少なくとも1か所異なる
- 複数候補が見つかったとき、グループごとに2件目のテストへ1つ警告する

AST構造は厳密に比較します。文字列類似度やテスト名の類似度は使いません。関数名、メンバー名、変数名、引数の数、式の並びが異なる場合は検出しません。

## 対象外と制限

- すでに `it.each()` / `test.each()` を使うテスト、`describe.each()`、動的なテスト名は対象外です。
- ブロック本体に複数の文があるテスト、非同期関数、ネストした関数、代入・更新・削除・`new`・`await`・`yield`・`throw` を含むテストは対象外です。
- 任意の関数呼び出しが副作用を持つかどうかは判定しません。1つの `expect()` 式内で呼び出す関数の純粋性は開発者が判断してください。
- 自動修正はありません。どの値をテーブルの列にするかは、警告を見て手動で決めます。

## 例

```ts
describe("status normalization", () => {
  it("maps healthy", () => expect(normalize("ok")).toBe("operational"));
  it("maps broken", () => expect(normalize("major")).toBe("outage"));
});
```

この例では2つのテスト本体の構造が一致し、入力と期待値のリテラルが異なるため警告します。テストをまとめる場合は次の形を検討してください。

```ts
it.each([
  ["ok", "operational"],
  ["major", "outage"],
])("maps %s", (input, expected) => {
  expect(normalize(input)).toBe(expected);
});
```
