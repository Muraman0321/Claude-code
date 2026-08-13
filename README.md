# Glider Flight Analyzer

> **このアプリを引き継ぐ人へ**: まず [HANDOVER.md](HANDOVER.md) を読んでください。
> 前任者の Supabase は既に失効しているため、自分の環境を作り直す必要があります（無料・30分程度）。

グライダー飛行のIGCファイルを一括解析し、選手・機体・気象条件・時間・位置などで飛行効率（速度、上昇率、滑空比）を可視化するウェブアプリ。

**全ての解析処理はブラウザ上で実行されます。** サーバはデータの保存（Supabase）と静的ファイル配信（Render Static Site）だけで、計算用のサーバープロセスはありません。スマホ Safari からも URL を踏むだけで動きます。

## 機能

- **IGCファイル一括アップロード** — ドラッグ&ドロップで複数ファイル投入
- **ファイル名解析** — `yy.mm.dd_<機体>_<選手>_<備考>.igc` 形式から自動でメタデータ抽出
- **フライトマップ** — GPS軌跡を地図表示（高度・上昇率・速度で色分け）、サーマル位置マーカー
- **上昇率・滑空比分析** — 高度プロファイル、上昇率推移、対地速度、ヒストグラム
- **サーマル自動検出** — 連続上昇区間を抽出して位置・効率を可視化
- **選手・機体比較** — 最大4フライトの並列比較・軌跡重ね合わせ
- **統計・トレンド** — 選手ランキング、機体パフォーマンス、月別推移
- **気象データ統合** — Open-Meteo Historical Forecast を直接ブラウザから取得
- **複数端末同期** — Supabase 認証で同じアカウントの端末間でデータ共有

## 構成

```
frontend/   # React + TypeScript + Vite — 解析・描画・統計を全てここで実行
supabase/   # クラウド DB / Storage 用の SQL スキーマ
backend/    # （旧 FastAPI 実装。新構成では使用しないが履歴・テスト参照用に残置）
```

## 初期セットアップ

### 1. Supabase プロジェクト作成

1. [supabase.com](https://supabase.com/) で新規プロジェクト作成（Free プラン）
2. SQL Editor で `supabase/schema.sql` を全て貼り付けて Run
3. Storage で `fixes` という名前の Private バケットを作成
4. Project Settings → API から `URL` と `anon public` キーをコピー

### 2. Render Static Site デプロイ

1. [render.com](https://render.com/) で Blueprint 連携（リポジトリを選択）
2. Service Settings → Environment に下記を追加
   - `VITE_SUPABASE_URL` = 上で控えた Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = 上で控えた anon キー
3. Deploy → 数分待つと `https://glider-analyzer-xxxx.onrender.com` が払い出される

スマホで上記 URL を開けば、ゲストモード（匿名サインイン）で即使い始められます。複数端末でデータ共有したい場合は、UI 上部の「別端末と同期する」からメールで Magic Link を受信して紐付けてください。

## ローカル開発

```bash
cd frontend
npm install
# .env.local に VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を記述
npm run dev
```

`http://localhost:5173` でアプリにアクセス。サーバープロセスは不要です。

## ファイル名フォーマット

```
yy.mm.dd_<機体番号>_<選手名>_<備考>.igc
```

例: `26.04.11_JA04KH_shin_27*3.igc` → 2026/04/11、JA04KH、shin、27*3

備考は省略可能。フォーマットが合わないファイルはアップロード時にエラーで返ります。

## アーキテクチャ

```
ブラウザ
 ├─ IGCパース / メトリクス / サーマル検出 (frontend/src/utils/)
 ├─ 統計集計 (frontend/src/lib/stats/)
 ├─ Open-Meteo API 呼び出し (frontend/src/lib/weather/)
 └─ Supabase JS SDK
       ├─ Postgres (flights / thermals)
       └─ Storage (fixes/{owner}/{flight_id}.json)
Render Static Site — frontend/dist/ を配信するだけ
```

## 解析アルゴリズム

- **対地速度**: Haversine距離 / Δ時間（5サンプル移動平均）
- **上昇率**: ΔGPS高度 / Δ時間（7サンプル移動平均）
- **サーマル検出**: 連続して上昇率 > 0.1 m/s が20秒以上 + 平均上昇率 > 0.3 m/s + 高度獲得 > 5m
- **最大滑空比 (L/D)**: 全60秒ウィンドウから「非上昇区間」を抽出し、水平距離/高度損失の最大値（< 100）

## 拡張アイデア

- 気象データ（METAR、再解析）との突合
- 競技課題（Cレコード）の自動評価
- チーム単位の集計（Supabase RLS をチームメンバー間で共有に拡張）
- IGCのリアルタイムアップロード（ロガー直結）
