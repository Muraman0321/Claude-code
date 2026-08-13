# 引き継ぎガイド — Glider Flight Analyzer

> **このドキュメントの対象**: このアプリを次に運用・改修する人
> **最終更新**: 2026-08-13

グライダーの IGC ログを解析して、フライトマップ・上昇率・滑空比・サーマル・選手/機体比較を見るウェブアプリ。
機能そのものの説明は [USER_GUIDE.md](USER_GUIDE.md)、技術仕様は [COMPREHENSIVE_SPEC.md](COMPREHENSIVE_SPEC.md) にある。
ここには **「引き継いで自分の環境で動かすまで」** だけを書く。

---

## 1. まず現状（2026-08-13 時点）

| 対象 | 状態 |
|---|---|
| `https://glider-analyzer-frontend.onrender.com`（現行の静的サイト） | 稼働中。ただし**アプリとしては使えない**（下記） |
| `https://glider-analyzer.onrender.com`（旧 FastAPI 版） | 稼働中だが**旧実装**。無料プランのスリープで初回応答に約45秒かかる |
| Supabase プロジェクト（DB・認証・ファイル保存） | **消滅**。無料プランの長期未使用により削除された |
| `glider.jbb2026sg.com`（カスタムドメイン） | DNS の CNAME は残っているが証明書が無く**アクセス不可** |
| 保存済みフライトデータ | **失われた**。復元しない前提で進める |

**要するに**: 画面は開くが、サインインもデータ保存もできない。開くと「サインインを準備しています…」で止まる。
引き継ぐ人は、**自分の Supabase と Render を新しく作る**。作業は 30 分程度、費用はゼロ（両方とも無料プランで足りる）。

元の IGC ファイルさえ手元にあれば、再アップロードすれば解析結果はそのまま再現される
（解析は全部ブラウザ側で毎回計算しているので、サーバーに解析結果を溜め込んでいるわけではない）。

---

## 2. 構成

```
ブラウザ（ここで全部計算する）
 ├─ IGC パース / 上昇率・滑空比・サーマル検出
 ├─ 統計集計・地図描画
 ├─ Open-Meteo API（気象、直接呼び出し）
 └─ Supabase
       ├─ Auth      … 匿名サインイン ＋ Magic Link
       ├─ Postgres  … flights / thermals テーブル
       └─ Storage   … fixes バケット（GPS点列 JSON）

Render Static Site … frontend/dist/ を配信するだけ（サーバー計算なし）
```

- `frontend/` … 実体。React + TypeScript + Vite
- `supabase/schema.sql` … DB とセキュリティポリシーの定義
- `backend/` … **旧 FastAPI 実装。現行構成では使っていない**（履歴として残置）

サーバー側で重い計算をしないので、Render の無料プランでもスリープ・タイムアウトの影響を受けない。
これは以前 FastAPI 版がメモリ超過と 502 を頻発させた反省から、解析をブラウザ側へ移した結果。

---

## 3. セットアップ手順

### Step 1. リポジトリ

<https://github.com/Muraman0321/Claude-code> （public）
ブランチは `claude/glider-flight-analyzer-a5J8M` の1本のみ。**自分のアカウントに Fork する**のが一番楽。

### Step 2. Supabase プロジェクトを作る

1. <https://supabase.com> → GitHub でサインイン → **New Project**
2. Name: 任意 / Region: **Tokyo（Northeast Asia）** / Database Password は控えておく
3. 起動まで数分待つ

### Step 3. スキーマを流す

**SQL Editor** → New Query → `supabase/schema.sql` を全文貼り付け → **Run**
（何度実行しても壊れない書き方になっている）

### Step 4. Storage バケットを作る

**Storage** → **New Bucket** → 名前 `fixes` / **Private**（公開しない）

> 名前は `fixes` でなければならない。schema.sql のセキュリティポリシーがこの名前を見ている。

### Step 5. 匿名サインインを有効にする ★つまずきポイント

**Authentication** → **Sign In / Providers** → **Anonymous sign-ins** を **ON**。

アプリは開いた瞬間に匿名ユーザーを作ってゲストモードで使わせる設計なので、
ここが OFF だと**何をしても「サインインを準備しています…」から先へ進まない**。
Supabase の初期値は OFF なので、必ず自分で入れること。

### Step 6. Site URL を設定する ★つまずきポイント

**Authentication** → **URL Configuration**

- **Site URL**: 自分の Render の URL（例 `https://<自分のサービス名>.onrender.com`）
- **Redirect URLs**: 同じ URL を追加。ローカル開発するなら `http://localhost:5173` も追加

「別端末と同期する」の Magic Link が、ここを設定しないと古い URL や localhost に飛ぶ。

### Step 7. API キーを控える

**Project Settings** → **API** から2つコピー。

```
VITE_SUPABASE_URL      = https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY = eyJhbGci...（anon public キー）
```

> `anon` キーはブラウザに埋め込まれる公開前提のキーなので、漏れても問題ない設計
> （テーブルは Row Level Security で「自分の行しか読み書きできない」ようになっている）。
> **`service_role` キーは絶対にフロントに置かない**。

### Step 8. Render にデプロイ

1. <https://render.com> → GitHub でサインイン → **New** → **Blueprint**
2. Fork したリポジトリを選ぶ（`render.yaml` が読まれて Static Site として作られる）
3. **Environment** に3つ設定
   ```
   VITE_SUPABASE_URL      = Step 7 の URL
   VITE_SUPABASE_ANON_KEY = Step 7 のキー
   VITE_APP_URL           = 払い出された自分のサイト URL
   ```
4. Deploy（数分）

> `VITE_APP_URL` について ★つまずきポイント
> `frontend/.env.production` に**前任者の URL がハードコードされている**。
> Render の環境変数のほうが優先されるので上記3つ目を入れれば直るが、
> 混乱を避けるなら `.env.production` を自分の URL に書き換えて commit するほうが確実。

### Step 9. 動作確認

1. サイトを開く → 数秒で自動的にゲストモードになり、ダッシュボードが出る
   （「サインインを準備しています…」で止まるなら **Step 5** を疑う）
2. IGC を1本アップロード → 一覧に出る → 地図に軌跡が描かれる
3. リロードしてもデータが残っている（＝Supabase に保存できている）
4. 「別端末と同期する」でメールを入れ、届いたリンクが**自分のサイト**に戻る
   （古い URL に飛ぶなら **Step 6** と **Step 8** を疑う）

### ローカルで開発する場合

```bash
cd frontend
npm install
npm run dev
```

`frontend/.env.local` を作り、`VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を書く。
このファイルは `.gitignore` 済みなので commit されない。`http://localhost:5173` で開く。

---

## 4. 運用上の注意

### Supabase の無料プランは放置すると消える ← 今回これで死んだ

無料プランは **7日間アクセスが無いと一時停止**し、そのまま放置されるとプロジェクトごと削除される。
シーズンオフに数か月触らないと、次の合宿シーズンに開いたときには**データごと消えている**。対策は3つ。

1. 月1回でいいのでサイトを開く（アクセスがあれば止まらない）
2. シーズン終わりに **Table Editor から CSV エクスポート**して保存しておく
3. 継続的に使うなら Supabase Pro（$25/月）に上げる

**IGC の元ファイルは必ず別途保管しておくこと。** それさえあれば何度でも作り直せる。

### Render の無料プランについて

Static Site（現行構成）は**スリープしない**。無料のまま常時アクセス可能。
15分でスリープするのは Web Service（旧 FastAPI 版）のほうなので、現行構成では気にしなくてよい。

### データは「ユーザー単位」で分かれている

各フライトは作成したユーザーのものとして保存され、他人からは見えない（Row Level Security）。
匿名ユーザーはブラウザのセッションに紐づくだけなので、**ブラウザのデータを消すとフライトに二度と辿り着けない**。
継続的に使うなら、最初に「別端末と同期する」から Magic Link でメールアドレスを紐付けておくこと。
部内で共有したい場合は、**共有用のメールアドレス1つで全員がサインインする**のが最も簡単。

### ファイル名フォーマット

```
yy.mm.dd_<機体番号>_<選手名>_<備考>.igc
例: 26.04.11_JA04KH_shin_27*3.igc
```

この形式でないファイルはアップロード時に弾かれる。備考は省略可。

---

## 5. 前任者側に残っている後始末

引き継ぎ先には関係ないが、記録として。

- 旧 Render サービス `glider-analyzer`（FastAPI 版）— 削除してよい
- 旧 Render Static Site `glider-analyzer-frontend` — 引き継ぎ完了後に削除
- DNS の `glider.jbb2026sg.com` CNAME — 削除する（現在も旧サービスを指したまま）

---

## 6. ドキュメント一覧

| ファイル | 内容 |
|---|---|
| `HANDOVER.md` | このファイル。引き継ぎ手順 |
| `USER_GUIDE.md` | 使い方（操作方法・画面説明） |
| `COMPREHENSIVE_SPEC.md` | 技術仕様の全体像（アーキテクチャ・DB・API・アルゴリズム） |
| `README.md` | 概要とセットアップの要約 |
| `SPEC.md` | 初期の仕様書 |
| `DEPLOY_iPad.md` | iPad だけでデプロイする手順 |
| `DEPLOY_SUBDOMAIN.md` | 独自ドメインを割り当てる手順（※旧構成向け） |

`USER_GUIDE.md` と `COMPREHENSIVE_SPEC.md` に書かれている URL は前任者の環境のものなので、
自分でデプロイした後は自分の URL に読み替えること。
