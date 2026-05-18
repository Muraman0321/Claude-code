# Glider Flight Analyzer

グライダー飛行のIGCファイルを一括解析し、選手・機体・気象条件・時間・位置などで飛行効率（速度、上昇率、滑空比）を可視化するウェブアプリ。

## 機能

- **IGCファイル一括アップロード** — ドラッグ&ドロップで複数ファイル投入
- **ファイル名解析** — `yy.mm.dd_<機体>_<選手>_<備考>.igc` 形式から自動でメタデータ抽出
- **フライトマップ** — GPS軌跡を地図表示（高度・上昇率・速度で色分け）、サーマル位置マーカー
- **上昇率・滑空比分析** — 高度プロファイル、上昇率推移、対地速度、ヒストグラム
- **サーマル自動検出** — 連続上昇区間を抽出して位置・効率を可視化
- **選手・機体比較** — 最大4フライトの並列比較・軌跡重ね合わせ
- **統計・トレンド** — 選手ランキング、機体パフォーマンス、月別推移

## 構成

```
backend/   # Python + FastAPI + SQLAlchemy + SQLite
frontend/  # React + TypeScript + Vite + Leaflet + Recharts
```

## セットアップ

### バックエンド

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`http://localhost:8000` で API、`http://localhost:8000/docs` で OpenAPI ドキュメント。

### フロントエンド

```bash
cd frontend
npm install
npm run dev
```

`http://localhost:5173` でアプリにアクセス。`/api/*` は自動で backend にプロキシされます。

## ファイル名フォーマット

```
yy.mm.dd_<機体番号>_<選手名>_<備考>.igc
```

例: `26.04.11_JA04KH_shin_27*3.igc` → 2026/04/11、JA04KH、shin、27*3

備考は省略可能。フォーマットが合わないファイルはアップロード時にエラーで返ります。

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/upload` | IGCファイルを複数アップロード |
| GET | `/api/flights` | フライト一覧 (pilot, aircraft, date_from, date_to で絞込) |
| GET | `/api/flights/{id}` | フライト詳細 (fixes・thermals含む) |
| DELETE | `/api/flights/{id}` | フライト削除 |
| GET | `/api/pilots` | 選手一覧 |
| GET | `/api/aircraft` | 機体一覧 |
| GET | `/api/stats/pilots` | 選手別集計 |
| GET | `/api/stats/aircraft` | 機体別集計 |

## テスト

```bash
cd backend
python3 tests/test_parsers.py
```

## 解析アルゴリズム

- **対地速度**: Haversine距離 / Δ時間（5サンプル移動平均）
- **上昇率**: ΔGPS高度 / Δ時間（5サンプル移動平均）
- **サーマル検出**: 連続して上昇率 > 0.2 m/s が30秒以上 + 平均上昇率 > 0.5 m/s + 高度獲得 > 10m
- **最大滑空比 (L/D)**: 全60秒ウィンドウから「非上昇区間」を抽出し、水平距離/高度損失の最大値

## 拡張アイデア

- 気象データ（METAR、再解析）との突合
- 競技課題（Cレコード）の自動評価
- マルチユーザー認証・チーム集計
- IGCのリアルタイムアップロード（ロガー直結）
