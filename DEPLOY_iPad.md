# iPad / スマホから使う

URL を踏むだけでアプリが動きます（解析はブラウザ側で完結するため、サーバが寝ていても影響しません）。初回セットアップだけ PC で 5-10 分必要です。

---

## 必要なもの

- iPad / iPhone / Android の Safari または Chrome
- GitHub アカウント（このリポジトリのオーナー、または fork オーナー）
- Render.com アカウント（GitHub ログイン可、クレジットカード不要）
- Supabase アカウント（GitHub ログイン可、無料プラン、クレジットカード不要）

---

## セットアップ手順（PC で 1 回だけ）

### Step 1: Supabase プロジェクト作成

1. <https://supabase.com> → **Start your project** → GitHub サインイン
2. **New project** → 名前任意、Region は東京推奨、Database password を設定
3. プロジェクト起動後、左メニュー **SQL Editor** → **New query**
4. リポジトリの `supabase/schema.sql` の中身を**全て**コピペして **Run**
5. 左メニュー **Storage** → **New bucket** → 名前 `fixes`、Public off → **Save**
6. 左メニュー **Project Settings** → **API** で下記をメモ
   - **Project URL** （`https://xxxxx.supabase.co`）
   - **anon public** key（公開用 JWT。ブラウザに露出する想定で OK）

### Step 2: Render に Static Site をデプロイ

1. <https://render.com> → **Get Started** → GitHub サインイン
2. **+ New** → **Blueprint** → リポジトリ `muraman0321/Claude-code` を選択
3. **Branch** は `claude/glider-flight-analyzer-a5J8M` を選択
4. `render.yaml` が自動で読み込まれ、`glider-analyzer` という **Static Site** が作成される
5. Service が作成されたら **Environment** タブで下記を入力 → **Save Changes**
   - `VITE_SUPABASE_URL` = Step 1 でメモした URL
   - `VITE_SUPABASE_ANON_KEY` = Step 1 でメモした anon key
6. **Manual Deploy** → **Clear build cache & deploy** で再ビルド
7. 数分後に `https://glider-analyzer-xxxx.onrender.com` が払い出される

### Step 3: スマホで開く

1. 上記 URL を Safari / Chrome で開く
2. 自動で「ゲストモード」（匿名サインイン）が始まり、すぐ使える
3. 「**IGCファイルをアップロード**」エリアをタップ → iCloud / Files / カメラロールから `.igc` を選択
4. 解析はブラウザ内で実行 → Supabase に保存される

### 別端末と同期する

画面上部の **「別端末と同期する」** をタップ → メールアドレス入力 → 受信したログインリンクを開く。別端末でも同じメールでサインインすれば同じデータが見えます。

---

## 無料プラン上限

| サービス | 上限 | 影響 |
|---|---|---|
| Render Static Site | 帯域 100GB/月 | 静的配信なので**スリープ無し・メモリ制限無し**（旧 Web Service 構成での 502 は解消） |
| Supabase Postgres Free | DB 500MB | flights/thermals の行データ用。数千フライト規模なら十分 |
| Supabase Storage Free | 1GB | 1 フライト ≈ 100KB として約 10,000 フライト保存可 |
| Supabase 月間アクティブユーザー | 50,000 | 個人利用なら無関係 |

---

## トラブルシューティング

| 症状 | 対応 |
|---|---|
| 画面が真っ白、コンソールに `Supabase env vars are missing` | Render の Environment に `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を設定して再デプロイ |
| アップロードで `not signed in` | ページをリロードして匿名サインインを走らせ直す |
| 別端末で同じデータが見えない | 双方の端末で**同じメールアドレス**の Magic Link でサインインしているか確認 |
| `.igc` がエラーで弾かれる | ファイル名が `yy.mm.dd_<機体>_<選手>_<備考>.igc` 形式か確認（日付区切りは `.` / `_` どちらも可） |
| Render の Build が `npm run build` で失敗 | ローカルで `cd frontend && npm install && npm run build` を試して TypeScript エラーを修正 |

---

## アップデート方法

このブランチに新しい commit を push すれば、Render が自動で再ビルド・再デプロイします。Supabase スキーマを変更した場合のみ、Supabase SQL Editor で再度 `schema.sql` を流してください（idempotent な作りになっています）。

---

## 旧構成（FastAPI + SQLite on Render Web Service）から移行する場合

旧サーバ側 SQLite のデータは Render 再起動時にどのみち消えるため、新システムへの「データ移行」は基本的に不要です。手元に `.igc` ファイルが残っていれば、新 URL で再アップロードすれば同じ解析結果が得られます。
