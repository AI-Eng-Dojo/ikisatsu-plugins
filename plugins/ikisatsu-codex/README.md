# ikisatsu プラグイン(Codex)

Claude Code のプラグイン(`plugins/ikisatsu`)と同じことを Codex で行います(0.3.0〜。グリル `docs/grilling/2026-10-06-codex-parity.md`)。

- **SessionStart**: 同じプロジェクトの直近の作業の要約(チームの短期の記憶)を `additionalContext` として注入する。0 件・`.ikisatsu.json` なし・トークンなし・サーバ失敗のときは何も注入しない。注入は 4000 字以内
- **Stop**(1 ターンごと): 会話ログ(`~/.codex/sessions/**/rollout-*.jsonl`)を**発言・返答・ツール名だけ**に削ってクラウドへ送る。Codex は async のフックも同期で動かすので、送信を待つ(最大 5 秒)
- **SessionEnd**: 最後の会話を送り直してから、要約の合図を送る
- **login スキル**: 「ikisatsu にログインして」でトークンを `~/.ikisatsu/token` に保存する(Claude Code と共通)

どれも fail-open(失敗してもセッションは止めない)。

## 送るもの・送らないもの

Codex の会話ログは公式に安定した仕様ではないので、知っている形の行の、決めたフィールドだけを読みます(`apps/agent-hooks/src/codex/filter-transcript.ts`)。

| 送る | 送らない |
|---|---|
| ユーザーの発言(画面に出たものだけ) | Codex が差し込む文(AGENTS.md の中身、`<environment_context>` など。画面に出ないので落ちる) |
| Codex の返答 | system prompt・developer の指示・推論 |
| ツールの名前(`exec` / `js` など) | コマンドの文字列・ツールの引数・実行結果・ファイルのパス |

サブエージェントの会話は送りません。Codex の更新で形式が変わり、ユーザーの発言が 1 件も読めなかったときは、読めた分(返答とツール名)だけを送り、`~/.ikisatsu/logs/transcript.log` に 1 行残します(本文は残しません)。

## 導入

1. マーケットプレイスを追加する

   ```
   codex plugin marketplace add AI-Eng-Dojo/ikisatsu-plugins
   ```

2. プラグインを入れる(`codex plugin add ikisatsu-codex`、または Codex 内の `/plugins` から `ikisatsu-codex` を有効化)

3. 使いたいリポジトリを Codex の **trusted プロジェクト**にする(未信頼のプロジェクトではフックは動かない)

4. Codex で `/hooks` を開き、ikisatsu のフック(SessionStart / Stop / SessionEnd)を**確認して承認**する(新規・変更されたフックは承認するまで実行されない)。**0.2.x から 0.3.0 に上げたときも、Stop と SessionEnd が増えたので承認し直しが要る**。承認しないと、会話は黙って送られない

5. ログインする。Codex で「**ikisatsu にログインして**」と頼む(サンドボックスの外で実行する承認を求められるので許可する)。うまくいかないときは、端末で `node ~/.codex/plugins/cache/ikisatsu-plugins/ikisatsu-codex/<版>/bin/login.mjs` を実行する。トークンは Claude Code と共通の `~/.ikisatsu/token`。`IKISATSU_TOKEN` 環境変数でも指定できる。どのチームにも入っていない人が初めてログインすると、その人を管理者として新しいチームができる。**既存のチームに入るなら、初めてログインする前に、そのチームの管理者に追加してもらう**

6. 使いたいリポジトリのルートに `.ikisatsu.json` をコミットする

   ```json
   { "projectId": "your-project" }
   ```

## MCP(記憶を引く)

0.5.0 から、記憶を引く MCP サーバ `ikisatsu` が入っています。プラグインを更新したら、Codex を開き直すと使えるようになります(常駐プロセスがあれば止めてから)。フックの定義(`hooks.json`)は変えていないので、`/hooks` での承認し直しは要りません。

| ツール | 返すもの |
|---|---|
| `list_digests` | 短期の記憶(チームの各メンバーの、このプロジェクトでの直近の作業の要約) |
| `get_domain` | 長期の記憶(概念・ルール・決定)。`query` で名前と本文の部分一致に絞る |
| `list_my_sessions` | 自分が送った会話の一覧(本人の分だけ) |
| `read_my_session` | 自分が送った会話 1 件の中身(本人の分だけ) |

- 中身は手元の中継(`bin/mcp.mjs`)が `https://api.ikisatsu.dev/mcp` に送ります。トークンはフックと同じもの(`IKISATSU_TOKEN` → `~/.ikisatsu/token`)を毎回読むので、ログインし直せばそのまま効きます
- Codex は MCP の定義の `${PLUGIN_ROOT}` を展開しないので、中継はプラグインのディレクトリを作業ディレクトリにして起動します(0.5.0 はこのため起動に失敗していました。0.5.1 で直しました)。そのため、作業ディレクトリの `.ikisatsu.json` から `projectId` を補えません。`projectId` はリポジトリの `.ikisatsu.json` の値を渡してください
- ログインしていなければ、ツールは「ログインし直してください」というエラーを返します

## 注入の上限を変えたい場合

Codex はフックの出力(`additionalContext`)の既定上限が約 2,500 トークンで、超えると全文を一時ファイルへ退避し、先頭と末尾のプレビューだけをモデルに渡します。このプラグインの `hooks/hooks.json` は `additionalContextLimit: 5000` を指定済みです。変えたい場合は、その値を編集するのではなく(定義が変わると `/hooks` の承認が取り消される)、リポジトリの `.codex/config.toml` などに同じフックを自分で定義して調整してください。

## 環境変数

| 名前 | 既定 | 用途 |
|---|---|---|
| `IKISATSU_TOKEN` | (なし) | トークン。指定すると `~/.ikisatsu/token` より優先 |
| `IKISATSU_API_URL` | `https://api.ikisatsu.dev` | API の URL |

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

`hooks/*.mjs` と `bin/login.mjs` は `apps/agent-hooks/src` から生成したファイルです(手で編集しない)。処理を変えるときは `.mjs` だけが変わり、`hooks/hooks.json`(承認対象の定義)は動かさないこと。

```
npm run build --workspace=apps/agent-hooks
```

生成物の差分もコミットします(CI が鮮度を確認します)。
