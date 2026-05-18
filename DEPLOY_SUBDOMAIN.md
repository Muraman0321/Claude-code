# glider.jbb2026sg.com からアクセスできるようにする手順

サブドメイン方式なので、設定は **DNS 1 行 + Render 1 操作** だけで済みます。
WordPress 本体側の設定変更は **不要**です。

```
ブラウザ
   │  GET https://glider.jbb2026sg.com/...
   ▼
[ DNS: glider.jbb2026sg.com → glider-analyzer-xxxx.onrender.com ]
   ▼
[ Render: glider-analyzer.onrender.com ]
   - FastAPI がルート配信（サブパスなし）
   - SSL 証明書は Render が自動取得
```

WordPress 本体（jbb2026sg.com）は今まで通りそのまま動き続けます。

---

## 必要なもの

| 項目 | 確認方法 |
|---|---|
| **DNS 管理画面へのログイン** | jbb2026sg.com を購入した先（お名前.com / ムームー / GoDaddy / Cloudflare 等） |
| **Render のダッシュボード** | https://dashboard.render.com にログイン |

---

## 手順 1: Render に現在の URL を控える

1. Render ダッシュボードを開く
2. `glider-analyzer` サービスをクリック
3. 画面上部の URL（例: `https://glider-analyzer-xxxx.onrender.com`）の
   **ホスト名部分**だけメモする  
   → `glider-analyzer-xxxx.onrender.com`

---

## 手順 2: DNS にレコードを追加

DNS 管理画面の「DNS設定」「DNSレコード」などの項目を開き、以下を追加:

| 種別 | ホスト名 | 値 (Value) | TTL |
|---|---|---|---|
| **CNAME** | `glider` | `glider-analyzer-xxxx.onrender.com` | 3600（自動でOK） |

> ホスト名欄に `glider.jbb2026sg.com` ではなく `glider` だけ入れる
> プロバイダもあれば、フル `glider.jbb2026sg.com` を要求するプロバイダもある。
> 表示例に合わせる。

### 主要DNSサービスでの操作場所

| サービス | パス |
|---|---|
| お名前.com | ドメインNavi → DNS関連機能 → DNSレコード設定 |
| ムームードメイン | コントロールパネル → ドメイン操作 → ムームーDNS |
| Cloudflare | ダッシュボード → ドメイン選択 → DNS → Records → Add record |
| GoDaddy | My Products → DNS → Add record |
| Google Domains | ドメイン → DNS → カスタムレコード |

設定後、反映には数分〜30分かかる（プロバイダによる）。

---

## 手順 3: Render に Custom Domain を登録

1. Render ダッシュボード → `glider-analyzer` サービス
2. 左メニュー「**Settings**」をクリック
3. 「**Custom Domains**」セクションの「**+ Add Custom Domain**」
4. 入力欄に `glider.jbb2026sg.com` を入力 → 「Save」
5. 数十秒〜数分待つ
6. ステータスが「**Verified**」「**Certificate Issued**」になれば完了
   - 「Pending」のまま長いときは、DNS 反映待ち or レコードの綴り間違い

Render は **自動で Let's Encrypt の SSL 証明書を取得**するので、
HTTPS でアクセスできるようになる。

---

## 手順 4: 動作確認

ブラウザで以下を順に開く:

1. `https://glider.jbb2026sg.com/api/health`  
   → `{"status":"ok"}` が表示される
2. `https://glider.jbb2026sg.com/`  
   → ダッシュボードが表示される
3. 鍵マークが緑（SSL 有効）になっている

---

## 502 が出るときの対策

| 症状 | 原因と対策 |
|---|---|
| 大量アップロード時の 502 | 既に 5 件ずつバッチ送信に修正済み |
| Drive 取込みで 502 | Drive側を `max_files` を小さく（50程度）にして試す |
| 70件超のフライト比較で 502 | API は 1500点/1500件に間引き済み。それでも出る場合は Render を Starter プラン（$7/月）にアップグレード |
| 15 分放置後の初回 502 | Render 無料プランのスリープ復帰中。30 秒待って再読み込み |

Render 無料プランの本質的な制約（30秒タイムアウト、15分スリープ）を
完全に避けたい場合は Starter プラン（$7/月）への変更が手っ取り早い。

---

## ロールバック

DNS の CNAME レコードを削除すれば、サブドメインは無効になる。
Render 側の Custom Domain も「Remove」で外せる。
本サイト（jbb2026sg.com）には一切影響しない。
