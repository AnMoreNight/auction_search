# オークション相場データベース検索システム

Google Sheets + GAS の代替として構築した、高速なオークション相場検索Webシステムです。

> **English setup guide:** for step-by-step ConoHa VPS provisioning, install, and data migration instructions in English, see [DEPLOY.md](DEPLOY.md).

## 構成

```
PC / スマートフォン
      ↓ HTTPS
    Nginx
      ↓
Node.js (Express) Webアプリ
      ↓
PostgreSQL (pg_trgm 全文検索インデックス)
```

- バックエンド: Node.js + Express
- DB: PostgreSQL（`pg_trgm` による高速部分一致検索）
- 認証: 共通パスワードによるセッションログイン
- フロント: 素のHTML/CSS/JS（ビルド不要、レスポンシブ対応）

## セットアップ（開発環境）

### 1. 前提

- Node.js 18以上
- PostgreSQL 14以上（`pg_trgm` 拡張が使えること）

### 2. データベース作成

```bash
sudo -u postgres psql
CREATE DATABASE auction_db;
CREATE USER auction_user WITH PASSWORD 'change_me';
GRANT ALL PRIVILEGES ON DATABASE auction_db TO auction_user;
\c auction_db
GRANT ALL ON SCHEMA public TO auction_user;
\q
```

### 3. 環境変数

```bash
cp .env.example .env
# .env を編集: DATABASE_URL, SESSION_SECRET, APP_PASSWORD を設定
```

### 4. 依存関係インストール & スキーマ適用

```bash
npm install
npm run migrate
```

これで `auction_items` テーブルと検索用インデックス（`大会` 用のB-treeインデックス、
`商品詳細` 用の `pg_trgm` GINインデックス）が作成されます。

### 5. 起動

```bash
npm start
# 開発時は npm run dev (nodemon)
```

`http://localhost:3000` にアクセスするとログイン画面が表示されます。

## 初回データ移行（既存 約10万件）

Google Sheetsから既存データをCSVエクスポートし、CLIツールで一括投入します
（`COPY` を使うため、Web画面からのアップロードより高速です）。

```bash
npm run import:bulk -- /path/to/existing_data.csv
```

CSVは以下のヘッダー（1行目）を含む必要があります:

```
大会,箱番号,枝番号,商品詳細,ランク,金額
```

- 文字コードは **UTF-8** と **Shift_JIS（CP932）** の両方に自動対応しています。
  Google Sheetsからの書き出しは通常UTF-8、Excelで作成・保存したCSVはShift_JISになることが多いですが、
  どちらも自動判定してアップロードできます。
- 列の順序は自由です（ヘッダー名で判定するため）。上記以外の列（`ID` や `メーカー` など）が含まれていても無視されます。
- `ID` 列は一意なキーとして使用しません。重複判定は `大会` + `箱番号` + `枝番号` の組み合わせで行われ、
  同じ組み合わせのレコードが再アップロードされた場合は内容が上書き更新されます（重複登録は発生しません）。

## 毎週のデータ更新（約3,000件/週）

管理画面のログイン後、「CSVアップロード（DB更新）」からCSVファイルを選択してアップロードします。

```
CSVファイル
   ↓
管理画面からアップロード
   ↓
データチェック（必須列・型チェック、不正行はスキップしてレポート）
   ↓
Web用DBへ登録（大会+箱番号+枝番号が重複する場合は自動的に上書き更新）
   ↓
検索画面ですぐ利用可能
```

アップロード後、追加件数・更新件数・スキップ件数と、不正行のエラー内容（先頭50件）が画面に表示されます。

## 検索の仕様

- `商品詳細` フィールドに対する複数キーワードのAND部分一致検索です。
  半角・全角スペース区切りで複数キーワードを入力できます。
  例: `Nikon Ai-S 50mm f1.4` → 4つの語をすべて含むレコードのみヒット。
- 大文字小文字は区別しません（ILIKE）。
- 大会範囲は「全大会」「直近10/20/30大会」「カスタム（任意の大会数）」から選択できます。
- 検索結果一覧では `大会` `箱番号` `枝番号` `商品詳細` `ランク` `金額` を表示します。
- 画面には検索にかかった時間（ms）が表示されます。

## 認証・パスワード変更

- ログイン用パスワード（`APP_PASSWORD`）は複数人で共有される想定です。
- パスワードの変更は管理者のみに制限されています。ヘッダーの「パスワード変更」を開くと、
  「ログインパスワード」「管理者パスワード」の2つのタブが表示されます。
  - **ログインパスワードタブ**: 全員が使う共有ログインパスワードを変更します。
    管理者パスワードの入力が必要です（ログインパスワードを知っているだけでは変更できません）。
  - **管理者パスワードタブ**: 管理者パスワード自体を変更します。現在の管理者パスワードの入力が必要です。
- `.env` の `APP_PASSWORD` / `ADMIN_PASSWORD` は、サーバーを**初めて起動したとき**にDBへ登録する
  初期パスワードとしてのみ使われます。一度DBに登録された後は `.env` の値は無視されるため、
  パスワードを変更したい場合は `.env` を編集するのではなく、必ずアプリ内の「パスワード変更」機能を使ってください。
- 管理者パスワードを忘れた場合の復旧手段はアプリ内にはありません（DBを直接操作する必要があります）。
  管理者以外には教えないでください。

## 本番デプロイ（ConoHa VPS / Ubuntu 24.04 を想定）

1. Node.js, PostgreSQL, Nginx をインストール
2. リポジトリを `/opt/auction-search` に配置し `npm install --production`
3. `.env` を配置し、`npm run migrate` でスキーマ適用
4. `deploy/auction-search.service` を `/etc/systemd/system/` にコピーし:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now auction-search
   ```
5. `deploy/nginx.conf` を `/etc/nginx/sites-available/auction-search` に配置し、
   `server_name` を実際のドメインに変更してから有効化:
   ```bash
   sudo ln -s /etc/nginx/sites-available/auction-search /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d your-domain.example.com
   ```

## パフォーマンス

- `商品詳細` に `pg_trgm` の GIN インデックスを使うことで、`ILIKE '%keyword%'` の複数条件AND検索でも
  インデックススキャンが効きます（フルスキャンになりません）。
- `大会` にB-treeインデックスを張っているため、「直近N大会」フィルタも高速です。
- 検索結果の総件数は `COUNT(*) OVER()` ウィンドウ関数で同一クエリ内で取得し、クエリを2回実行しない設計にしています。
- 約10万件・週3,000件追加のデータ規模であれば、通常のキーワード検索は1秒未満〜数秒以内で返る想定です。

## ディレクトリ構成

```
src/
  server.js          Expressアプリのエントリポイント
  db.js              PostgreSQL接続プール
  importUtils.js     CSVヘッダーマッピング・行バリデーション（Web/CLI共通）
  middleware/
    requireAuth.js   セッション認証ミドルウェア
  routes/
    auth.js          ログイン/ログアウト/セッション確認
    search.js         検索API
    upload.js          CSVアップロードAPI
public/
  index.html / login.html
  css/style.css
  js/app.js / login.js
db/
  schema.sql         テーブル・インデックス定義
scripts/
  migrate.js         schema.sql適用
  bulk-import.js     初回一括移行用CLI（COPY使用）
deploy/
  nginx.conf
  auction-search.service
```
