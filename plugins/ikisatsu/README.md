# ikisatsu プラグイン(Claude Code)

Claude Code のセッションの**発言とツール名だけ**をクラウドで要約し、次のセッションの開始時に「チームの作業状況」として注入します。

- **Stop**(非同期): 会話を発言(あなたと AI)とツール名(どのファイルを編集したか)に削って送る。**ツールの実行結果・system prompt・Bash のコマンド文字列・思考は送らない**
- **SessionEnd**: 要約の合図を送る
- **SessionStart**: チームの短期の記憶を `additionalContext` として注入する
- どのフックも失敗してもセッションを止めない(fail-open)

## 導入

1. マーケットプレイスを追加する

   ```
   /plugin marketplace add AI-Eng-Dojo/ikisatsu-plugins
   ```

2. プラグインを入れる

   ```
   /plugin install ikisatsu@ikisatsu-plugins
   ```

3. ログインする。Claude Code で「**ikisatsu にログインして**」と頼む(`/ikisatsu:login` でも可)。ブラウザが開くので Google でログインする。トークンは `~/.ikisatsu/token`(0600)に保存される。どのチームにも入っていない人が初めてログインすると、その人を管理者として新しいチームができる。**既存のチームに入るなら、初めてログインする前に、そのチームの管理者に追加してもらう**(先にログインすると自分のチームができ、後から別のチームには移れない)

4. 使いたいリポジトリのルートに `.ikisatsu.json` をコミットする

   ```json
   { "projectId": "your-project" }
   ```

   `projectId` は `[A-Za-z0-9._-]` の 100 文字まで。`.ikisatsu.json` が無いリポジトリでは何も送らない。

## MCP(記憶を引く)

0.5.0 から、記憶を引く MCP サーバ `ikisatsu` が入っています。プラグインを更新したら `/reload-plugins`(または Claude Code の再起動)で使えるようになります。`/mcp` に `plugin:ikisatsu:ikisatsu` が出ていれば繋がっています。

| ツール | 返すもの |
|---|---|
| `list_digests` | 短期の記憶(チームの各メンバーの、このプロジェクトでの直近の作業の要約) |
| `get_domain` | 長期の記憶(概念・ルール・決定)。`query` で名前と本文の部分一致に絞る |
| `list_my_sessions` | 自分が送った会話の一覧(本人の分だけ) |
| `read_my_session` | 自分が送った会話 1 件の中身(本人の分だけ) |

- 中身は手元の中継(`bin/mcp.mjs`)が `https://api.ikisatsu.dev/mcp` に送ります。トークンはフックと同じもの(`IKISATSU_TOKEN` → `~/.ikisatsu/token`)を毎回読むので、ログインし直せばそのまま効きます
- `projectId` を渡さなければ、作業ディレクトリから辿った `.ikisatsu.json` の値を使います
- ログインしていなければ、ツールは「ログインし直してください」というエラーを返します

## 環境変数

| 名前 | 既定 | 用途 |
|---|---|---|
| `IKISATSU_TOKEN` | (なし) | トークン。指定すると `~/.ikisatsu/token` より優先 |
| `IKISATSU_API_URL` | `https://api.ikisatsu.dev` | API の URL |
| `IKISATSU_APP_URL` | `https://app.ikisatsu.dev` | ログインで開く Web の URL |

## 送られていないと思ったら

送信に失敗すると(HTTP の 4xx / 5xx、接続できない、タイムアウト)、手がかりが `~/.ikisatsu/logs/http-errors.log` に 1 行ずつ(JSON Lines)残ります。成功したときは何も書きません。512KB を超えると `http-errors.log.1` に退避します(1 世代)。

ログに入るのは、時刻・フック名・メソッド・パス・トークンの出どころ(`tokenSource`: 環境変数 `IKISATSU_TOKEN` なら `env`、`~/.ikisatsu/token` なら `file`。値は入らない)・状態コード・応答ヘッダ(`cf-ray` / `server` / `cf-mitigated` / `content-type`)・応答本文の先頭 300 字だけです。会話の本文・トークン・Authorization・リクエスト本文は入りません。

403 の出どころは、この行で見分けられます。

- `bodyHead` が `error code: 1010` で `server` が `cloudflare`: Cloudflare の Browser Integrity Check
- `cfMitigated` が `challenge`: Cloudflare のチャレンジ
- `cfRay` 付きのブロックページ(HTML): Cloudflare の WAF。Ray ID を Security → Events で検索する
- `cfRay` が無い、または `server` が `cloudflare` 以外: 手元のネットワーク(社内プロキシなど)で止まっている

401 で `tokenSource` が `env` なら、環境変数 `IKISATSU_TOKEN` に古いトークンが残っています。フックは `~/.ikisatsu/token` より環境変数を優先するので、ログインし直してファイルを新しくしても直りません。フックを起動したプロセスは、起動した時点の環境変数を持ち続けます(Codex のバックグラウンドのデーモン、IDE、tmux など)。`IKISATSU_TOKEN` を消すか新しい値にしてから、**そのプロセスごと再起動**してください。Codex なら、すべてのウィンドウを閉じて `codex app-server` のプロセスを止めてから開き直します。

その行を共有してもらえれば調べられます。

## 開発

`hooks/*.mjs` と `bin/login.mjs` は `apps/agent-hooks/src` から生成したファイルです(手で編集しない)。

```
npm run build --workspace=apps/agent-hooks
```

生成物の差分もコミットします(CI が鮮度を確認します)。
