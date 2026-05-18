# jbb2026sg.com/glider 配下にアプリを乗せる手順

このアプリは Render 上で動かしたまま、`https://jbb2026sg.com/glider` から
アクセスできるようリバースプロキシで合流させる構成です。

```
ブラウザ
   │  GET https://jbb2026sg.com/glider/...
   ▼
[ jbb2026sg.com (WordPress) ]
   │  /glider/* だけを Render に転送（プレフィックス保持）
   ▼
[ Render: glider-analyzer.onrender.com/glider/* ]
   - FastAPI が /glider に sub-app マウント
   - フロントエンドも /glider/ をベースにビルド済み
```

---

## 1. Render 側の確認

`render.yaml` で次の環境変数が設定されていれば OK:

```yaml
envVars:
  - key: BASE_PATH
    value: /glider
```

ビルドコマンドにも `VITE_BASE_PATH=/glider/` が指定されている。

Render ダッシュボードで「Manual Deploy」を実行すると、
`https://glider-analyzer-xxxx.onrender.com/glider/` で動作確認できる。

---

## 2. WordPress 側のリバースプロキシ設定

### 重要: `/glider` プレフィックスを **保持したまま** 転送すること

| ブラウザのリクエスト | Render に転送するパス | 結果 |
|---|---|---|
| `/glider/api/flights` | `/glider/api/flights` ✓ | 200 OK |
| `/glider/api/flights` | `/api/flights` ✗ | 404 |

WordPress 側でプレフィックスを剥がしてはいけない。

### A. レンタルサーバー（Apache + .htaccess）の場合

`mod_proxy` が有効か確認してから、サイトのルート `.htaccess` に追記:

```apache
<IfModule mod_proxy.c>
  RewriteEngine On
  # /glider と /glider/* を Render に転送（プレフィックス保持）
  RewriteRule ^glider$ https://glider-analyzer-xxxx.onrender.com/glider/ [P,L]
  RewriteRule ^glider/(.*)$ https://glider-analyzer-xxxx.onrender.com/glider/$1 [P,L]
</IfModule>
```

`mod_proxy` `mod_proxy_http` `mod_rewrite` が必要。
さくら・ロリポップ等の共有サーバーでは利用不可なケース多。

### B. ConoHa / Xserver VPS（Nginx）の場合

サイトの nginx config に追記:

```nginx
location /glider {
    proxy_pass https://glider-analyzer-xxxx.onrender.com;
    proxy_set_header Host glider-analyzer-xxxx.onrender.com;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 120s;     # アップロード時の長時間レスポンス対策
    proxy_send_timeout 120s;
    proxy_buffering off;
}
```

`proxy_read_timeout` は 120s 以上推奨（大量アップロード対応）。

### C. Cloudflare 経由の場合（ドメインが CF プロキシ下）

Cloudflare ダッシュボード → Workers & Pages → Workers で:

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/glider")) {
      const target = new URL(
        url.pathname + url.search,
        "https://glider-analyzer-xxxx.onrender.com"
      );
      return fetch(target, request);
    }
    return fetch(request);  // それ以外は WordPress へ
  },
};
```

Worker Route を `jbb2026sg.com/glider*` に設定。
無料プラン: 100,000 req/日 まで（個人利用なら十分）。

### D. WordPress プラグインで済ませる場合

「**Reverse Proxy**」や「**Redirection (Pro)**」のリバースプロキシ機能を使うと、
管理画面から `/glider/* → https://glider-analyzer-xxxx.onrender.com/glider/*` の
マッピングを設定可能（プラグインによって機能差あり、要事前検証）。

WordPress.com（自前ホスティングではない）はプロキシ機能を提供していないため、
**WordPress.com を使っている場合は Cloudflare Worker 方式**を選ぶこと。

---

## 3. 動作確認

1. `https://jbb2026sg.com/glider/` を開く → ダッシュボードが表示される
2. 開発者ツールで `/glider/assets/index-*.js` が 200 で取得できているか確認
3. `/glider/api/health` を直接開いて `{"status":"ok"}` が返るか確認

---

## 4. 502 が出るときの対策

| 症状 | 原因と対策 |
|---|---|
| アップロード中に 502 | クライアント側で5件ずつバッチ送信するよう既に修正済み。それでも502が出る場合は Render の有料プラン化（$7/月）でタイムアウト30s→100sに |
| Drive取込みで 502 | サーバー1リクエストでフォルダ全件処理しているため。`max_files` を初期200→50程度に下げる、または Worker 経由でタイムアウト180sにする |
| フライト 70件超の比較で 502 | `/api/tracks` は合計1500点に間引き済み、`/api/thermals` も1500件上限。これでも出る場合はリバースプロキシのタイムアウトを延長 |
| 15分放置後の初回 502 | Render 無料プランのスリープ復帰中。30秒待って再読み込み |

---

## 5. ロールバック方法

Render の env から `BASE_PATH` を消し、ビルドコマンドから `VITE_BASE_PATH=/glider/` を
外して再デプロイすれば、元の `https://glider-analyzer-xxxx.onrender.com/` ルート配信に戻る。
