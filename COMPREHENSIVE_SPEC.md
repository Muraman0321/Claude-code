# Glider Flight Analyzer — 統合仕様書

> **作成日**: 2026-05-20  
> **対象**: Render, Supabase, SendGrid, Git 統合 + クライアント使用ガイド

---

## 目次

1. [システム概要](#1-システム概要)
2. [技術スタック](#2-技術スタック)
3. [アーキテクチャ](#3-アーキテクチャ)
4. [Render デプロイ](#4-render-デプロイ)
5. [Supabase 設定](#5-supabase-設定)
6. [SendGrid 統合](#6-sendgrid-統合)
7. [Git ワークフロー](#7-git-ワークフロー)
8. [クライアント使用ガイド](#8-clider-analyzer-frontend-使用ガイド)

---

## 1. システム概要

### 目的

グライダー飛行の IGC ファイル（FAI 標準フライトレコーダ形式）を解析し、**ブラウザ上で**以下を実施:

- ファイル名から自動抽出したメタデータ（選手名・機体番号・備考）の整理
- GPS 軌跡の表示・高度プロファイル・上昇率の可視化
- サーマル（上昇気流）の自動検出と位置マーキング
- 複数フライトの統計比較・トレンド分析
- 気象データ（Open-Meteo）との相関分析

**重要**: すべての解析計算はブラウザ側で実行され、サーバは**データ保存（Supabase）と静的配信（Render）のみ**。

### ユーザーシナリオ

1. **PC ブラウザ**: Render Static Site にアクセス → IGC をドラッグ&ドロップ
2. **スマホ Safari/Chrome**: 同じ URL を開く → タップしてファイル選択
3. **別端末同期**: Magic Link（メール認証）で、複数端末間でデータ共有

---

## 2. 技術スタック

| 層 | 技術 | 備考 |
|---|---|---|
| **フロントエンド** | React 18 + TypeScript + Vite | ブラウザ上で解析・統計・描画 |
| **UI コンポーネント** | Recharts (グラフ), Leaflet (地図) | 依存は最小限 |
| **ファイル形式** | IGC (FAI 標準), JSON (GPS フィックス) | |
| **データベース** | Supabase PostgreSQL | 無料プラン 500MB まで |
| **ファイルストレージ** | Supabase Storage | GPS フィックス JSON (1GB まで無料) |
| **認証** | Supabase Auth (Magic Link / 匿名) | Firebase 不使用 |
| **気象 API** | Open-Meteo Historical Forecast | 無料・APIキー不要 |
| **デプロイ** | Render Static Site | GitHub Blueprint 連携 |

### 依存パッケージ

```json
{
  "@supabase/supabase-js": "^2.45.4",
  "idb-keyval": "^6.2.1",
  "leaflet": "^1.9.4",
  "react": "^18.3.1",
  "react-leaflet": "^4.2.1",
  "react-router-dom": "^6.27.0",
  "recharts": "^2.13.0"
}
```

---

## 3. アーキテクチャ

### 3-1. 実行フロー

```
┌─────────────────────┐
│  ブラウザ (React)   │
│                     │
│  ┌─────────────────┤
│  │ IGC パース       │
│  │ メトリクス計算   │
│  │ サーマル検出     │
│  │ 統計集計        │
│  │ Open-Meteo 呼び出し
│  └─────────────────┤
│                     │
│  ┌─────────────────┤
│  │ Supabase JS SDK │
│  │  ├─ Auth        │
│  │  ├─ PostgreSQL  │
│  │  └─ Storage     │
│  └─────────────────┤
│                     │
└─────────────────────┘
         ↕
┌─────────────────────┐
│  Render Static Site │  (frontend/dist)
│  - ビルド時のみ npm │
└─────────────────────┘
         ↕
┌─────────────────────┐
│   Supabase Cloud    │
│  ┌─────────────────┤
│  │ PostgreSQL      │
│  │ (flights,       │
│  │  thermals)      │
│  ├─────────────────┤
│  │ Storage Bucket  │
│  │ (fixes/...)     │
│  ├─────────────────┤
│  │ Auth Providers  │
│  │ (Magic Link等)  │
│  └─────────────────┤
└─────────────────────┘
```

### 3-2. データフロー図

```
[ユーザー]
  │
  ├─→ IGC ファイル選択
  │     ↓
  │   [ブラウザ解析]
  │     ├─ ファイル名パース
  │     ├─ IGC メタデータ抽出
  │     ├─ GPS フィックス抽出
  │     ├─ メトリクス計算（速度・上昇率など）
  │     ├─ サーマル検出
  │     ├─ 気象データ取得（Open-Meteo）
  │     ↓
  │   [Supabase 保存]
  │     ├─ flights テーブル (summary, weather JSON)
  │     ├─ thermals テーブル (各サーマルのメタデータ)
  │     └─ Storage (fixes/{owner_uuid}/{flight_id}.json)
  │
  └─→ 別端末アクセス
        ↓
      [Magic Link 認証]
        ↓
      [同じデータを表示]
```

### 3-3. ディレクトリ構成

```
Claude-code/
├── frontend/                    # ← メインアプリ
│   ├── src/
│   │   ├── App.tsx             # ルーティング
│   │   ├── main.tsx            # エントリポイント
│   │   ├── styles.css          # グローバルスタイル
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx   # フライト一覧・アップロード
│   │   │   ├── FlightDetail.tsx # 詳細表示
│   │   │   ├── Compare.tsx     # 複数フライト比較
│   │   │   ├── Statistics.tsx  # 統計ダッシュボード
│   │   │   ├── Area.tsx        # 地域別分析
│   │   │   └── Weather.tsx     # 気象相関分析
│   │   ├── components/         # UI コンポーネント
│   │   ├── lib/
│   │   │   ├── supabase.ts     # Supabase クライアント
│   │   │   ├── stats.ts        # 統計計算
│   │   │   └── weather.ts      # Open-Meteo API
│   │   └── utils/
│   │       ├── igc-parser.ts   # IGC ファイル解析
│   │       ├── filename-parser.ts
│   │       ├── analysis.ts     # メトリクス計算
│   │       └── thermals.ts     # サーマル検出
│   ├── public/
│   ├── dist/                   # Render が配信する静的ファイル
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── backend/                     # ← 旧 FastAPI (参考用に残置)
│   ├── main.py
│   ├── models.py
│   ├── igc_parser.py
│   ├── filename_parser.py
│   ├── analysis.py
│   ├── weather.py
│   └── requirements.txt
├── supabase/
│   └── schema.sql              # PostgreSQL スキーマ
├── render.yaml                 # Render Blueprint
├── SPEC.md                     # 機能仕様書（詳細）
├── README.md                   # ユーザーガイド
└── COMPREHENSIVE_SPEC.md       # このファイル
```

---

## 4. Render デプロイ

### 4-1. Render.com とは

Render は **Heroku の代替サービス** で、以下のホスティングを提供:

- **Static Site**: 静的ファイル配信（スリープなし）
- **Web Service**: Node/Python サーバ（無料プランは 15 分スリープ）

**このプロジェクト**: Static Site を使用（解析はブラウザ側のため、サーバプロセス不要）。

### 4-2. 初期デプロイ手順

#### Step 1: GitHub から Blueprint 連携

1. <https://render.com> → **New** → **Blueprint**
2. リポジトリ選択: `muraman0321/Claude-code` (または fork 元)
3. Branch: `claude/glider-flight-analyzer-a5J8M` 選択
4. `render.yaml` が自動読み込まれ、Static Site `glider-analyzer` が作成される

#### Step 2: Render に環境変数を設定

Render ダッシュボード → `glider-analyzer` サービス → **Environment** タブ:

```
VITE_SUPABASE_URL        = https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY   = eyJhbGci... (Supabase anon キー)
NODE_VERSION             = 20.18.0 (render.yaml に記載済み)
```

#### Step 3: 再ビルド

**Manual Deploy** → **Clear build cache & deploy**

数分で `https://glider-analyzer-xxxx.onrender.com` が払い出される。

### 4-3. render.yaml 設定解説

```yaml
services:
  - type: web
    runtime: static
    name: glider-analyzer
    plan: free
    region: singapore
    branch: claude/glider-flight-analyzer-a5J8M
    rootDir: frontend
    buildCommand: npm install && npm run build
    staticPublishPath: ./dist
    envVars:
      - key: NODE_VERSION
        value: 20.18.0
      - key: VITE_SUPABASE_URL
        sync: false
      - key: VITE_SUPABASE_ANON_KEY
        sync: false
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
    headers:
      - path: /assets/*
        name: Cache-Control
        value: public, max-age=31536000, immutable
```

| 項目 | 説明 |
|---|---|
| `type: static` | 静的ファイル配信 |
| `rootDir: frontend` | npm build の実行対象ディレクトリ |
| `buildCommand` | Render が実行するビルドコマンド |
| `staticPublishPath: ./dist` | ビルド結果を配信 |
| `routes` | SPA ルーティング: すべてのパス → `/index.html` リライト |
| `headers` | `/assets/*` は 1 年間キャッシュ |

### 4-4. カスタムドメイン（サブドメイン）設定

[DEPLOY_SUBDOMAIN.md 参照](DEPLOY_SUBDOMAIN.md)

#### 概要

```
ブラウザ
  ↓
DNS: glider.jbb2026sg.com → glider-analyzer-xxxx.onrender.com
  ↓
Render Static Site
  ↓
frontend/dist/
```

#### 必要な操作

1. **DNS**: ドメインレジストラ（お名前.com など）で CNAME レコード追加
   ```
   glider.jbb2026sg.com CNAME glider-analyzer-xxxx.onrender.com
   ```

2. **Render**: Settings → Custom Domains → Add
   ```
   glider.jbb2026sg.com
   ```

3. Render が自動で Let's Encrypt SSL 証明書を取得

---

## 5. Supabase 設定

### 5-1. Supabase.com とは

Supabase は **Firebase の PostgreSQL 版** で、以下を提供:

- PostgreSQL データベース
- リアルタイム Replication
- Authentication (Magic Link / OAuth など)
- Storage (S3 互換 ファイル保存)
- 無料プラン 500MB DB + 1GB Storage

### 5-2. 初期セットアップ

#### Step 1: Supabase プロジェクト作成

1. <https://supabase.com> → **Start your project** → GitHub ログイン
2. **New Project** → Project Settings:
   - **Organization**: (自動選択)
   - **Name**: `glider-analyzer` (任意)
   - **Database Password**: (複雑なパスワード)
   - **Region**: **Tokyo** 推奨（日本データセンター）
3. **Create Project** → 起動待ち（数分）

#### Step 2: スキーマ作成

Supabase ダッシュボード → **SQL Editor** → **New Query**

`supabase/schema.sql` の内容を全てコピペ → **Run**

```sql
create extension if not exists "pgcrypto";

create table if not exists flights (
  id          bigint generated by default as identity primary key,
  owner       uuid not null references auth.users(id) on delete cascade,
  filename    text not null,
  pilot       text not null,
  aircraft    text not null,
  remarks     text,
  flight_date date not null,
  started_at  timestamptz,
  ended_at    timestamptz,
  start_latitude  double precision,
  start_longitude double precision,
  summary     jsonb not null default '{}'::jsonb,
  weather     jsonb,
  raw_igc     text,
  created_at  timestamptz default now()
);

create unique index if not exists flights_owner_filename_pilot_uniq
  on flights (owner, lower(filename), lower(pilot));

create table if not exists thermals (
  id             bigint generated by default as identity primary key,
  flight_id      bigint not null references flights(id) on delete cascade,
  owner          uuid not null references auth.users(id) on delete cascade,
  start_time     timestamptz not null,
  end_time       timestamptz not null,
  duration_s     double precision not null,
  altitude_gain_m double precision not null,
  avg_climb_rate_ms double precision not null,
  center_lat     double precision not null,
  center_lon     double precision not null,
  start_lat      double precision,
  start_lon      double precision,
  end_lat        double precision,
  end_lon        double precision
);

-- Row-Level Security
alter table flights  enable row level security;
alter table thermals enable row level security;

create policy "flights_owner_all" on flights
  for all using (owner = auth.uid()) with check (owner = auth.uid());

create policy "thermals_owner_all" on thermals
  for all using (owner = auth.uid()) with check (owner = auth.uid());

-- Storage RLS
create policy "fixes_owner_read" on storage.objects
  for select using (
    bucket_id = 'fixes' and (storage.foldername(name))[1] = auth.uid()::text
  );
-- ... (他のポリシー)
```

#### Step 3: Storage Bucket 作成

**Storage** → **+ New Bucket**:
- **Name**: `fixes`
- **Private**: チェック (プライベートモード)
- **Create**

#### Step 4: API キー・URL を控える

**Settings** → **API** → コピーする:

```
VITE_SUPABASE_URL      = https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY = eyJhbGci... (anon public キー)
```

これを Render 環境変数に設定。

### 5-3. データベーススキーマ詳細

#### flights テーブル

| カラム | 型 | 説明 |
|---|---|---|
| `id` | bigint PK | 自動採番 |
| `owner` | uuid FK | ユーザー (auth.users.id) |
| `filename` | text | 正規化後のファイル名 |
| `pilot` | text | 選手名（大文字） |
| `aircraft` | text | 機体番号（大文字） |
| `remarks` | text | ファイル名の備考ブロック |
| `flight_date` | date | フライト日 |
| `started_at` | timestamptz | UTC 開始時刻 |
| `ended_at` | timestamptz | UTC 終了時刻 |
| `start_latitude` | float | 離陸地点緯度 |
| `start_longitude` | float | 離陸地点経度 |
| `summary` | jsonb | メトリクス JSON |
| `weather` | jsonb | 気象スナップショット |
| `raw_igc` | text | 元 IGC テキスト（再解析用） |
| `created_at` | timestamptz | 作成日時 |

**summary JSON 例:**

```json
{
  "duration_s": 3600.0,
  "total_distance_km": 150.5,
  "straight_distance_km": 80.0,
  "max_altitude_m": 2500,
  "min_altitude_m": 400,
  "altitude_gain_m": 1800.0,
  "max_climb_rate_ms": 2.5,
  "avg_climb_in_thermals_ms": 1.2,
  "avg_ground_speed_kmh": 42.0,
  "max_ground_speed_kmh": 65.0,
  "best_glide_ratio": 8.5,
  "thermal_count": 15,
  "thermal_time_s": 1800.0,
  "cruise_time_s": 1800.0
}
```

**weather JSON 例:**

```json
{
  "temperature_2m_c": 18.5,
  "wind_speed_10m_kmh": 12.0,
  "wind_direction_10m_deg": 180.0,
  "cloud_cover_percent": 30,
  "humidity_percent": 65,
  "pressure_hpa": 1013.0
}
```

#### thermals テーブル

| カラム | 型 | 説明 |
|---|---|---|
| `id` | bigint PK | 自動採番 |
| `flight_id` | bigint FK | フライト |
| `owner` | uuid FK | ユーザー |
| `start_time` | timestamptz | UTC 開始 |
| `end_time` | timestamptz | UTC 終了 |
| `duration_s` | float | 継続時間（秒） |
| `altitude_gain_m` | float | 高度獲得（m） |
| `avg_climb_rate_ms` | float | 平均上昇率（m/s） |
| `center_lat` | float | 重心緯度 |
| `center_lon` | float | 重心経度 |
| `start_lat` | float | 旋回開始緯度 |
| `start_lon` | float | 旋回開始経度 |
| `end_lat` | float | 旋回終了緯度 |
| `end_lon` | float | 旋回終了経度 |

### 5-4. Row-Level Security (RLS)

各テーブルは owner フィールドで**ユーザー分離**:

```sql
create policy "flights_owner_all" on flights
  for all using (owner = auth.uid()) with check (owner = auth.uid());
```

- SELECT / INSERT / UPDATE / DELETE すべて `owner = auth.uid()` で制限
- 他ユーザーのデータは絶対に見えない

### 5-5. Storage アクセス制御

GPS フィックス JSON は `fixes/{owner_uuid}/{flight_id}.json` パスに保存:

```sql
create policy "fixes_owner_read" on storage.objects
  for select using (
    bucket_id = 'fixes' and (storage.foldername(name))[1] = auth.uid()::text
  );
```

- パスの第 1 セグメント（フォルダ名）= `auth.uid()` のみアクセス可

---

## 6. SendGrid 統合

### 6-1. SendGrid とは

SendGrid は **メール送信 SaaS**。本プロジェクトでは以下の用途:

- **Magic Link メール**: ユーザー認証メール配信
- **フライトレポート**: 気象データ等をメール添付

> **現在**: Supabase Auth の Magic Link は Supabase のメール機能を使用。  
> SendGrid 統合は将来の拡張向け。

### 6-2. SendGrid セットアップ（オプション）

#### Step 1: SendGrid アカウント作成

1. <https://sendgrid.com> → **Sign Up** → メールアドレス・パスワード
2. メール認証 → ダッシュボードへ

#### Step 2: API キー生成

**Settings** → **API Keys** → **Create API Key**:
- **Key Name**: `glider-analyzer`
- **Full Access**: チェック
- **Create & Save**

API キーをメモ（再表示不可）。

#### Step 3: Sender Identity 認証

**Settings** → **Sender Authentication** → **Verify a Single Sender**:

- **From Name**: `Glider Analyzer`
- **From Email**: `noreply@glider.jbb2026sg.com` (または任意)
- メールで認証リンク受信 → クリック

#### Step 4: Render 環境変数に設定

```
SENDGRID_API_KEY = SG.xxxxxxxxxxxxx...
SENDGRID_FROM_EMAIL = noreply@glider.jbb2026sg.com
```

### 6-3. Frontend 側の実装例（フライトレポートメール送信）

```typescript
import sgMail from '@sendgrid/mail';

// バックエンド層（将来構築時）
async function sendFlightReport(flightId: string, recipientEmail: string) {
  const { data: flight } = await supabase
    .from('flights')
    .select('*, thermals(*)')
    .eq('id', flightId)
    .single();

  const msg = {
    to: recipientEmail,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: `フライトレポート: ${flight.flight_date} ${flight.pilot}`,
    html: `
      <h2>${flight.pilot} - ${flight.aircraft}</h2>
      <p>飛行時間: ${(flight.summary.duration_s / 3600).toFixed(1)}h</p>
      <p>距離: ${flight.summary.total_distance_km.toFixed(1)} km</p>
      <p>平均上昇率: ${flight.summary.avg_climb_in_thermals_ms.toFixed(2)} m/s</p>
    `,
  };

  await sgMail.send(msg);
}
```

### 6-4. 注意事項

- **開発環境**: Magic Link は Supabase 側のテストメール機能で十分
- **本番**: SendGrid / SendinBlue など商用メール API を使用
- **スパム対策**: SPF / DKIM / DMARC を DNS に設定推奨

---

## 7. Git ワークフロー

### 7-1. リポジトリ構成

```
Repository: muraman0321/Claude-code
│
├─ main branch
│   └─ 本番・安定版
│
└─ claude/glider-flight-analyzer-a5J8M (Render デプロイ対象)
    └─ 開発・ステージング
```

### 7-2. ブランチ戦略

| ブランチ | 用途 | Render デプロイ |
|---|---|---|
| `main` | 本番 | × |
| `claude/glider-flight-analyzer-a5J8M` | ステージング | ✓ (自動デプロイ) |
| `feature/*` | 機能開発 | × |

### 7-3. 開発フロー

#### ローカル開発

```bash
# リポジトリクローン
git clone https://github.com/muraman0321/Claude-code.git
cd Claude-code

# 開発ブランチをチェックアウト
git checkout claude/glider-flight-analyzer-a5J8M

# 新機能ブランチを作成
git checkout -b feature/add-export-csv

# ローカル開発サーバ起動
cd frontend
npm install
npm run dev
# ブラウザで http://localhost:5173 を開く

# コード編集・テスト

# ステージング環境で動作確認
git add .
git commit -m "feat: add CSV export to statistics page"
git push origin feature/add-export-csv

# GitHub から Pull Request を作成
# → レビュー → claude/glider-flight-analyzer-a5J8M にマージ
# → Render が自動デプロイ
```

#### ホットフィックス（本番バグ）

```bash
# main からホットフィックスブランチを作成
git checkout main
git checkout -b hotfix/fix-supabase-auth-issue

# 修正実施・テスト
git add .
git commit -m "fix: handle Supabase auth timeout gracefully"

# main に PR → レビュー → マージ
# → claude/... ブランチに cherry-pick (手動)
git checkout claude/glider-flight-analyzer-a5J8M
git cherry-pick <commit-hash>
git push origin claude/glider-flight-analyzer-a5J8M
```

### 7-4. Commit メッセージ形式

```
<type>: <subject>

<body>

<footer>
```

**type**:
- `feat`: 新機能
- `fix`: バグ修正
- `refactor`: リファクタリング
- `perf`: パフォーマンス改善
- `test`: テスト追加
- `docs`: ドキュメント更新
- `chore`: 依存更新など

**例**:

```
feat: implement thermal overlay with rounded rectangle shapes

- Add thermal renderer with configurable border radius
- Update thermal detection algorithm to include start/end coordinates
- Implement time slider filter on compare page

Closes #123
```

### 7-5. デプロイフロー（自動化）

```
[Developer]
  │
  ├─→ git push origin feature/...
  │     ↓
  │   [GitHub]
  │     └─ PR 作成・レビュー
  │           ↓
  │       マージ → claude/glider-flight-analyzer-a5J8M へ
  │             ↓
  │           [GitHub Webhook]
  │             ↓
  │           [Render]
  │             └─ 自動ビルド・デプロイ開始
  │                   ├─ npm install
  │                   ├─ npm run build
  │                   └─ frontend/dist/ を配信
  │                         ↓
  │           [https://glider-analyzer-xxxx.onrender.com]
  │             リアルタイムで更新
  │
  └─→ ユーザーが新機能を使用可能
```

### 7-6. .gitignore 例

```
# IDE
.vscode/
*.swp
*.swo

# Node
node_modules/
npm-debug.log*
yarn-debug.log*

# Build
dist/
build/

# Env
.env
.env.local
.env.*.local

# OS
.DS_Store
Thumbs.db

# Logs
*.log

# Python (backend)
__pycache__/
*.pyc
.pytest_cache/
venv/
```

---

## 8. Glider Analyzer Frontend 使用ガイド

### 8-1. アクセス方法

#### オンライン（推奨）

```
https://glider-analyzer-frontend.onrender.com/
```

ブラウザで開く。初回は **ゲストモード**（匿名サインイン）で自動開始。

#### ローカル開発

```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

Supabase 環境変数（`.env.local`）を設定:
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

### 8-2. 画面構成

```
┌─────────────────────────────────────────┐
│  Glider Flight Analyzer  [別端末と同期] │  ← ヘッダー
├─────────────────────────────────────────┤
│                                         │
│  ┌─ Dashboard (/)                      │
│  │  ├─ フライト一覧テーブル              │
│  │  ├─ フィルター（選手・機体・日付）    │
│  │  ├─ IGC ドラッグ&ドロップアップロード  │
│  │  └─ Google Drive フォルダ一括取込み   │
│  │                                     │
│  ├─ Flight Detail (/flights/:id)      │
│  │  ├─ フライトサマリーカード            │
│  │  ├─ 高度プロファイルチャート          │
│  │  ├─ 速度・上昇率チャート              │
│  │  ├─ Leaflet マップ                  │
│  │  ├─ サーマル一覧                     │
│  │  └─ 気象情報                       │
│  │                                     │
│  ├─ Compare (/compare)               │
│  │  ├─ フライト選択（最大 100 件）       │
│  │  ├─ 比較サマリーバーチャート          │
│  │  ├─ 軌跡重ね合わせマップ              │
│  │  └─ サーマルオーバーレイ              │
│  │                                     │
│  ├─ Statistics (/statistics)         │
│  │  ├─ 選手別統計                      │
│  │  ├─ 機体別統計                      │
│  │  ├─ 時間帯別サーマル                 │
│  │  └─ 季節別チャート                   │
│  │                                     │
│  ├─ Area (/area)                    │
│  │  ├─ セクターモード                   │
│  │  ├─ グリッドモード                   │
│  │  └─ ブロック詳細パネル               │
│  │                                     │
│  └─ Weather (/weather)              │
│     ├─ 散布図（気象 vs 飛行指標）       │
│     ├─ ビン集計バーチャート              │
│     └─ 相関マトリクス                   │
│                                         │
└─────────────────────────────────────────┘
```

### 8-3. ダッシュボード（/）

#### 機能

1. **フライト一覧テーブル**

| 列 | 内容 |
|---|---|
| 日付 | フライト日（YYYY-MM-DD） |
| 選手 | パイロット名 |
| 機体 | 機体番号 |
| 時間 | 飛行時間（h:mm:ss） |
| 距離 | 総飛行距離（km） |
| 最高高度 | GPS 最高高度（m） |
| 平均上昇率 | サーマル内平均上昇率（m/s） |
| 最高速度 | 対地最高速度（km/h） |
| 削除 | 削除ボタン |

2. **フィルター**

- **選手**: ドロップダウン（抽出済み選手名から選択）
- **機体**: ドロップダウン（抽出済み機体番号から選択）
- **日付範囲**: From/To（年-月-日）

3. **IGC アップロード**

```
┌─────────────────────────────────┐
│  ドラッグ&ドロップでアップロード   │
│     または                      │
│  [ファイルを選択] (複数可)        │
└─────────────────────────────────┘
```

- 複数ファイル同時アップロード対応
- 正規化内容をメッセージ表示
- エラーは赤色ハイライト

4. **Google Drive 一括取込み**

```
フォルダ共有 URL を貼り付け:
[https://drive.google.com/drive/folders/xxxxx]
[インポート]
```

### 8-4. フライト詳細（/flights/:id）

#### セクション

1. **サマリーカード**

```
┌─────────────────────────────────┐
│ 2026-04-11 SHIN / JA04KH        │
├─────────────────────────────────┤
│ 飛行時間: 3h 42m 15s            │
│ 総距離: 248.5 km  |直線距離: 85.2 km
│ 最高高度: 2,450 m              │
│ 累積上昇高度: 1,890 m           │
│ 最大瞬間上昇率: 2.8 m/s         │
│ 平均上昇率（サーマル内）: 1.25 m/s │
│ 平均速度: 67.2 km/h             │
│ 最高速度: 98.5 km/h             │
│ 最大滑空比: 9.2                 │
│ サーマル数: 18 個               │
│ サーマル時間: 1h 52m            │
│ クルーズ時間: 1h 50m            │
└─────────────────────────────────┘
```

2. **高度プロファイルチャート**

- X 軸: 時刻（UTC）
- Y 軸: 高度（m）
- 折れ線グラフ（Recharts）
- マウスホバーで詳細表示

3. **速度・上昇率チャート**

- X 軸: 時刻
- Y1 軸: 対地速度（km/h）（青）
- Y2 軸: 上昇率（m/s）（赤）
- デュアルスケール表示

4. **Leaflet マップ**

- GPS 軌跡を Polyline で描画
- 高度色分け: 青（低）→ 赤（高）
- サーマル区間をハイライト（黄色背景）
- ズーム・パン可能

5. **サーマル一覧テーブル**

| 列 | 内容 |
|---|---|
| # | サーマル通し番号 |
| 開始時刻 | UTC 時刻 |
| 終了時刻 | UTC 時刻 |
| 継続時間 | 秒 |
| 高度獲得 | m |
| 平均上昇率 | m/s |

6. **気象情報カード**

```
┌─────────────────────────────────┐
│ フライト時の気象（スナップショット）│
├─────────────────────────────────┤
│ 気温（2m）: 18.5 °C             │
│ 地上風速（10m）: 12.0 km/h       │
│ 風向（10m）: 南東（135°）        │
│ 気圧: 1013.2 hPa               │
│ 雲量: 30%                       │
│ 湿度: 65%                       │
└─────────────────────────────────┘
```

### 8-5. フライト比較（/compare）

#### セクション 1: フライト選択

```
┌─────────────────────────────┐
│ 選手: [━━━▼] 機体: [━━━▼]     │
│ [ 絞り込み結果を全選択 ]       │
├─────────────────────────────┤
│ ☑ 2026-04-11  SHIN / JA04KH  │
│ ☑ 2026-04-10  SHIN / JA2408  │
│ ☐ 2026-04-09 TAJIMA / JA04KH │
│ ...                         │
└─────────────────────────────┘
```

- 最大 100 フライト選択可能
- ソート: ヘッダークリックで昇順/降順トグル

#### セクション 2: 比較サマリーバーチャート

```
        ▓▓▓
        ▓▓▓  ░░░
    ▓▓▓ ▓▓▓  ░░░
▓▓▓ ▓▓▓ ▓▓▓  ░░░
─────────────────────
SHIN-1  SHIN-2  TAJIMA-1
(2026-04-11) (2026-04-10) (2026-04-09)

■ 平均上昇率 (m/s)
■ 最大 L/D
■ 距離 (km)
■ サーマル密度 (件/h)
```

#### セクション 3: 軌跡重ね合わせマップ

```
[地図]
  赤線 (SHIN-1)
  青線 (SHIN-2)
  緑線 (TAJIMA-1)
  オレンジ線 (...)

[ サーマルオーバーレイ ☑ ]
[  円 / 角丸長方形 ]
[ 時刻フィルタ ±1h: [━━━━━] ]
```

- チェックボックスで各フライトの表示/非表示を切り替え
- サーマル表示 ON/OFF
- サーマル形状: 円 / 角丸長方形
- 時刻フィルタで特定時間帯のサーマルのみ表示

### 8-6. 統計ダッシュボード（/statistics）

#### セクション

1. **選手別統計テーブル**

| 列 | 内容 |
|---|---|
| 選手 | パイロット名 |
| フライト数 | 件数 |
| 総飛行時間 | 時間:分:秒 |
| 平均上昇率 | m/s |
| 平均速度 | km/h |
| 最大 L/D | 無単位 |
| 総距離 | km |

2. **機体別統計テーブル**

| 列 | 内容 |
|---|---|
| 機体 | 機体番号 |
| フライト数 | 件数 |
| 平均上昇率 | m/s |
| 平均速度 | km/h |
| 最大 L/D | 無単位 |

3. **時間帯別サーマルチャート**

```
X: ローカル時刻 (0-23 時)
Y: サーマル数 (棒)、平均上昇率 (折れ線)
```

午前（6-12h）にサーマルが多い傾向を可視化。

4. **季節別チャート**

```
春 | 夏 | 秋 | 冬
───┼───┼───┼───
    ▓▓     ▓▓
▓▓  ▓▓  ▓▓  ▓▓
▓▓  ▓▓  ▓▓  ▓▓
```

- フライト数（棒）
- 平均気温（折れ線）
- 平均風速（折れ線）

5. **地上風速別チャート**

```
風速 0-3 | 3-6 | 6-10 | 10+
────────┼────┼─────┼───
  ▓▓    │ ▓▓ │ ▓▓  │▓▓
```

- 平均上昇率
- 平均速度
- 平均 L/D

### 8-7. エリア分析（/area）

中心: 妻沼グライダー滑空場 (36.2114°N, 139.4189°E)

#### セクターモード

```
[セクター数: 8] [半径 5-15 km: ────○───]

     0 (N)
   7   1
 6   C   2
   5   3
     4 (S)

各セクターをクリック → 時間帯別チャート + ヒストグラム
```

#### グリッドモード

```
[グリッドサイズ: 3×3] [セルサイズ 1-5 km: ─○──]

NW   N   NE
W    C   E
SW   S   SE

各セルをクリック → 時間帯別チャート + ヒストグラム
```

#### マップ表示

- ポリゴン: 平均上昇率で色付け（薄黄→橙→赤）
- CircleMarker: サーマル数に比例したサイズ
- ツールチップ: ブロック名、平均上昇率、サーマル数

### 8-8. 気象分析（/weather）

#### フィルター

- **選手**: ドロップダウン
- **機体**: ドロップダウン

#### 散布図

```
X 軸選択:
  • 気温 (°C)
  • 地上風速 (km/h)
  • 雲量 (%)
  • 湿度 (%)
  • 気圧 (hPa)
  • 風向 (°)

Y 軸選択:
  • 平均上昇率
  • 最大 L/D
  • 総距離
  • サーマル数
  • 最高高度
  • 平均速度
  • 最高速度
  • 累積上昇高度
  • 飛行時間

Pearson 相関係数: r = 0.75 (強い正相関)
```

#### ビン集計バーチャート

気象変数を固定間隔で分割し、各ビンの飛行指標平均を棒グラフ表示。

#### 相関マトリクス

全気象変数 × 全飛行指標の Pearson r を色付きグリッドで表示。

```
         温度  風速  雲量  湿度  気圧  風向
上昇率   0.3   -0.1  0.5   0.2   0.1   0.0
L/D      0.2   0.4   0.1   0.3  -0.2   0.1
距離     0.1   0.5  -0.1   0.2   0.0   0.3
...
```

### 8-9. 認証フロー

#### ゲストモード（デフォルト）

1. URL 開く
2. 自動で匿名ユーザーでサインイン
3. データ保存 = Supabase（個人用 owner）

#### 別端末同期

1. **別端末と同期する** をタップ
2. メールアドレス入力 → Magic Link を受信
3. メール内リンク → サインイン
4. **すべての端末でログイン** → 同じデータ表示

#### ログアウト

1. 画面上部 **[ログアウト]** ボタン
2. 匿名ユーザーに戻る（ローカルデータは保持）

### 8-10. ファイル名フォーマット

```
yy.mm.dd_<機体>_<選手>[_<備考>].igc
```

#### 必須ブロック

| ブロック | 形式 | 例 |
|---|---|---|
| 日付 | `yy.mm.dd` | `26.04.11` |
| 機体 | `JA` で始まる英数字 | `JA04KH`, `JA2408` |
| 選手 | 英字のみ | `SHIN`, `TAJIMA` |

#### 備考（オプション）

機体・選手以外のブロック。コース識別子など。

#### 例

| ファイル名 | 日付 | 機体 | 選手 | 備考 |
|---|---|---|---|---|
| `26.04.11_JA04KH_SHIN_27*3.igc` | 2026/04/11 | JA04KH | SHIN | 27*3 |
| `26.04.11_TAJIMA_JA04KH.igc` | 2026/04/11 | JA04KH | TAJIMA | (なし) |

#### 自動正規化

アップロード時に以下を自動修正：

- 前後の空白除去
- 拡張子を `.igc` に統一（大文字は小文字に）
- ファイル名本体をすべて大文字に
- 日付区切り（`-`, `/`, `_` など）を `.` に統一
- 4 桁年 → 2 桁年（`2026` → `26`）
- ハイフン・スペースを `_` に統一

**例**:
```
入力:  "26/04/11-SHIN JA04KH-27*3.IGC"
出力:  "26.04.11_SHIN_JA04KH_27*3.igc"
```

### 8-11. ショートカット・Tips

| 操作 | 効果 |
|---|---|
| フライト一覧で **日付** クリック | フライト詳細へ遷移 |
| テーブルヘッダークリック | ソート（昇順/降順トグル） |
| マップで **Leaflet コントロール** | ズーム・パン・レイヤー切り替え |
| **タッチデバイス** (iPad/スマホ) | ドラッグ&ドロップ対応 |
| 別ウィンドウで詳細ページ開く | PC ⌘+クリック / Windows Ctrl+クリック |

### 8-12. パフォーマンス最適化

#### ローカルストレージ

- IGC ファイル解析結果をキャッシュ（IndexedDB）
- `idb-keyval` で簡潔なキャッシュ管理

#### API 呼び出し最適化

- GPS フィックス: 最大 1500 点まで間引き
- サーマル一覧: 最大 1500 件（超過時ランダムサンプリング）
- 重複インジェスト防止: 同一 `(filename, pilot)` は自動スキップ

#### ブラウザ計算

- メトリクス計算 → ブラウザで実行
- API 待機なし、高速レスポンス
- オフラインでもデータ表示可能（Supabase から取得済み）

---

## 9. トラブルシューティング

### 画面が真っ白

**原因**: Supabase 環境変数未設定

**対応**:
1. Render ダッシュボード → Environment
2. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を確認
3. **Manual Deploy** → **Clear build cache & deploy**

### アップロードで `not signed in` エラー

**原因**: 認証セッション期限切れ

**対応**:
1. ページをリロード
2. 匿名ユーザーで再サインイン

### `.igc` が弾かれる

**原因**: ファイル名形式不正

**対応**:
1. ファイル名が `yy.mm.dd_機体_選手[_備考].igc` か確認
2. 機体が `JA` で始まっているか確認
3. 選手が英字のみか確認

### Render で `502 Bad Gateway`

**原因**: 無料プランのメモリ/CPU 制限（Static Site では通常発生しない）

**対応**:
1. ページをリロード
2. 依然ダメ → Starter Plan ($7/月) にアップグレード

### 別端末でデータが見えない

**原因**: サインイン時のメールアドレス不一致

**対応**:
1. 双方の端末で **同じメールアドレス** でサインイン
2. Magic Link でも同じメール使用

---

## 10. 依存関係・バージョン

### Node.js

```
v20.18.0 (Render, render.yaml で指定)
```

### npm パッケージ

```json
{
  "@supabase/supabase-js": "^2.45.4",
  "idb-keyval": "^6.2.1",
  "leaflet": "^1.9.4",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-leaflet": "^4.2.1",
  "react-router-dom": "^6.27.0",
  "recharts": "^2.13.0"
}
```

### TypeScript

```
^5.6.3
```

---

## 11. セキュリティ考慮事項

### Row-Level Security (RLS)

すべてのテーブルで `owner = auth.uid()` ポリシーを実装。ユーザー間のデータ漏洩なし。

### API キー管理

- `VITE_SUPABASE_ANON_KEY`: ブラウザに露出想定
- RLS ポリシーで保護
- **本番**: 追加の認証層（JWT 署名など）を検討

### CORS

Supabase は自動で CORS 対応。Render → Supabase は同一オリジンまたは許可ドメイン。

### 外部 API

- **Open-Meteo**: 認証なし・無料・CORS 有効
- **SendGrid** (将来): API キー は server-side 環境変数に保存

---

## 12. 今後の拡張予定

### 優先度高

1. **リアルタイムアップロード**: GPS ロガーからの直接送信
2. **フライト検索**: タグ・コメント機能
3. **競技課題評価**: Cレコード解析
4. **チーム共有**: RLS をチームメンバー間に拡張

### 優先度中

5. **キネマティック GPS**: 気圧高度の精密補正
6. **METAR 統合**: 公開気象データとの突合
7. **モバイルアプリ**: Flutter / React Native（本体から分離）
8. **オフラインモード**: Service Worker キャッシュ

### 優先度低

9. **3D ビューア**: バラエティに富んだ可視化
10. **マルチランゲージ**: 日本語・英語・中国語対応

---

## 13. ドキュメント参考先

| ドキュメント | 用途 |
|---|---|
| [SPEC.md](SPEC.md) | 機能・API 詳細仕様 |
| [README.md](README.md) | ユーザー向けクイックスタート |
| [DEPLOY_SUBDOMAIN.md](DEPLOY_SUBDOMAIN.md) | 独自ドメイン設定 |
| [DEPLOY_iPad.md](DEPLOY_iPad.md) | スマートフォン利用ガイド |
| [render.yaml](render.yaml) | Render Blueprint 定義 |
| [supabase/schema.sql](supabase/schema.sql) | DB スキーマ |

---

## 附録 A: よくある質問

### Q1. ローカルデータを全削除したい

```typescript
// ブラウザコンソール
const { data } = await supabase.from('flights').select('id').eq('owner', auth.user().id);
data.forEach(f => supabase.from('flights').delete().eq('id', f.id));
await supabase.auth.signOut();
```

### Q2. CSV / PDF エクスポートしたい

> **現状**: 実装なし  
> **今後**: `jsPDF`, `papaparse` ライブラリで実装予定

### Q3. 別の Supabase プロジェクトに移行したい

1. 新規 Supabase プロジェクト作成
2. `schema.sql` を実行
3. 旧プロジェクトから flights / thermals / fixes を CSV エクスポート
4. 新プロジェクトにインポート（owner UUID は変換が必要）

---

## 附録 B: API リファレンス（フロントエンド使用）

### Supabase JS SDK 基本例

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// フライト取得
const { data, error } = await supabase
  .from('flights')
  .select('*, thermals(*)')
  .eq('owner', user.id)
  .order('flight_date', { ascending: false });

// フライト保存
const { data: newFlight, error } = await supabase
  .from('flights')
  .insert({
    owner: user.id,
    filename: 'normalized.igc',
    pilot: 'SHIN',
    aircraft: 'JA04KH',
    flight_date: '2026-04-11',
    summary: { duration_s: 3600, ... },
  });

// GPS フィックス保存（Storage）
const { error } = await supabase.storage
  .from('fixes')
  .upload(`${user.id}/${flight.id}.json`, fixesJson);
```

### Open-Meteo API 例

```typescript
const response = await fetch(
  'https://archive-api.open-meteo.com/v1/archive?' +
  `latitude=${lat}&longitude=${lon}` +
  `&start_date=${dateStr}&hourly=temperature_2m,wind_speed_10m` +
  `&timezone=Japan`
);
const weather = await response.json();
```

---

**作成日**: 2026-05-20  
**最終更新**: 2026-05-20  
**著者**: Glider Analyzer Development Team
