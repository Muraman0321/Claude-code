# iPadからセットアップする手順 (Render.com 無料デプロイ)

Render.com に無料デプロイすれば、iPadのSafariからURLでアクセスできます。
全てブラウザだけで完結します（クレジットカード不要）。

---

## 必要なもの

- iPad の Safari (or Chrome)
- GitHub アカウント（このリポジトリのオーナー）
- Render.com アカウント（GitHubでサインインできます）

---

## 手順

### 1. Render にサインアップ

1. Safari で <https://render.com> を開く
2. 右上「**Get Started**」→「**GitHub**」でサインイン
3. 自分の GitHub アカウントを認証

### 2. リポジトリを Render に接続

1. Render ダッシュボードで「**+ New**」→「**Blueprint**」を選択
2. 「**Connect a repository**」で `muraman0321/claude-code` を選択
   - 初回は GitHub のリポジトリアクセス許可ダイアログが出るので、
     `claude-code` リポジトリのアクセスを許可
3. 「**Branch**」で `claude/glider-flight-analyzer-a5J8M` を選択
4. Render が自動でリポジトリ内の `render.yaml` を読み込みます
5. 「**Apply**」をタップ

### 3. ビルド完了を待つ

- 初回ビルドは 5〜10 分かかります（Python + Node のインストール、React ビルド）
- 「**Logs**」タブでビルド進捗が見られます
- 「Build successful 🎉」→「Deploy live 🚀」が出れば完了

### 4. アクセス

- ダッシュボードに表示される URL（例: `https://glider-analyzer-xxxx.onrender.com`）を
  iPad の Safari で開く
- 「**IGCファイルをアップロード**」エリアに iPad の「ファイル」アプリから IGC を
  ドラッグ&ドロップ、またはタップして選択

---

## 無料プランの注意点

| 項目 | 内容 |
|-----|------|
| **スリープ** | 15分間アクセスが無いとサービスがスリープし、次回アクセス時に30秒ほど起動待ち |
| **データベース** | SQLite は `/tmp` に置かれているため、サービス再起動 (≒ スリープ復帰やデプロイ) でアップロード履歴がリセットされます |
| **ビルド時間** | 月750時間まで無料（実質常時稼働OK） |

→ **長期保存したい場合**は、Render の有料プラン (Persistent Disk) か、
   Supabase などの外部 PostgreSQL に切り替えてください。

---

## トラブルシューティング

### ビルドが失敗する

- Logs の `npm install` や `pip install` のエラーを確認
- `frontend/package.json` の `dependencies` が正しいか確認

### 起動はするがUIが真っ白

- ブラウザの開発者ツールで `/assets/*.js` が 200 で返るか確認
- 直す場合は手元で `cd frontend && npm run build` を実行し、`dist/` が生成されることを確認

### アップロードが失敗する

- ファイル名が `yy.mm.dd_<機体>_<選手>[_<備考>].igc` 形式か確認
  - 日付の区切りは `.` または `_` どちらでもOK
  - 例: `26.04.11_JA04KH_shin_27_2.igc`、`26_04_12_JA04KH_Tajima.igc`

---

## 別の選択肢

### A. PC/Mac でローカル起動 (同じWiFi内のiPadからアクセス)

PC/Mac で以下を実行：

```bash
# 一度だけ
cd backend && pip install -r requirements.txt
cd frontend && npm install && npm run build

# 起動 (PC/Macが起きている間アクセス可能)
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
```

iPad の Safari で `http://<PC/MacのローカルIP>:8000` にアクセス
（PC/Mac の IP は「システム設定 → ネットワーク」で確認）

### B. Fly.io / Railway.app

- いずれも GitHub 連携でデプロイ可
- Render と同様、ブラウザ完結

---

## アップデート方法

このブランチ (`claude/glider-flight-analyzer-a5J8M`) に新しい commit が push されると、
Render は自動で再ビルド・再デプロイします。何もする必要はありません。
