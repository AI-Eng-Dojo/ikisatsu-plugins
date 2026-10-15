# ikisatsu プラグイン(配布用)

[ikisatsu(経緯)](https://ikisatsu.dev) のクライアント側ソースです。Claude Code / Codex のプラグインと、手元のフック、共有の純関数(`packages/core`)を公開しています。サーバ(要約・プロンプト・Worker)はこのリポジトリには含まれません。

ライセンスは [Apache-2.0](./LICENSE) です。

## 何を送り、何を送らないか

フックは会話を**発言とツール名だけ**に削ってからクラウドへ送ります。後から足しても、いったん漏れたものは戻せないので、手元で落とします。

| 送る | 送らない |
|---|---|
| あなたと AI の発言 | ツールの実行結果 |
| ツールの名前(どのファイルを編集したか、など) | system prompt / developer の指示 |
| | Bash などのコマンド文字列・ツールの引数 |
| | 思考・推論の本文 |
| | Codex が差し込む文(画面に出ないもの) |

生の会話を読めるのは本人だけです。チームの短期の記憶(要約)は同じプロジェクトのメンバーが読みます。

削り込みの実装とテストは `apps/agent-hooks` にあります。公開しているソースで、何が落ちるかを自分で確かめられます。

## インストール

### Claude Code

```
/plugin marketplace add AI-Eng-Dojo/ikisatsu-plugins
/plugin install ikisatsu@ikisatsu-plugins
```

そのあと「**ikisatsu にログインして**」と頼む(または `/ikisatsu:login`)。ブラウザで Google ログインし、トークンが `~/.ikisatsu/token` に保存されます。

どのチームにも入っていない人が初めてログインすると、その人を管理者として新しいチームができます。メンバーは https://app.ikisatsu.dev/admin/members で追加します。**既存のチームに入る人は、初めてログインする前に、そのチームの管理者に追加してもらってください**(先にログインすると自分のチームができ、後から別のチームには移れません)。

### Codex

```
codex plugin marketplace add AI-Eng-Dojo/ikisatsu-plugins
codex plugin add ikisatsu-codex@ikisatsu-plugins
```

リポジトリを trusted にし、`/hooks` で ikisatsu のフックを承認してから、「**ikisatsu にログインして**」と頼んでください。

### プロジェクトの紐付け

使いたいリポジトリのルートに `.ikisatsu.json` をコミットします。

```json
{ "projectId": "your-project" }
```

`projectId` は `[A-Za-z0-9._-]` の 100 文字までです。このファイルが無いリポジトリでは何も送りません。

ログイン先: https://app.ikisatsu.dev/

## 開発(このリポジトリ単体)

`.npmrc` で `legacy-peer-deps=true` にしてあります。

```
npm install
npm run typecheck
npm test
npm run build
```

`npm run build` は `apps/agent-hooks` をバンドルし、`plugins/*/hooks/*.mjs` と `plugins/*/bin/*.mjs` を更新します。

## 貢献について

**Pull Request は受け付けません。** バグ報告や要望は [Issues](https://github.com/AI-Eng-Dojo/ikisatsu-plugins/issues) だけ開いてください。反映するかどうかはメンテナーが判断します。
