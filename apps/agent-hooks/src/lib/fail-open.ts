// フックは fail-open: どんな失敗(例外・タイムアウト)でも exit 0 で終わり、エージェントを止めない。
// stdout には書かない。ログは console.error の固定文言だけ(本文・トークン・例外メッセージを出さない)

export interface FailOpenDeps {
  exit: (code: number) => void;
  /** 全体の締め切り。stdin が閉じない等の想定外でも、この時間で必ず終える */
  deadlineMs: number;
}

const defaultDeps: FailOpenDeps = { exit: (code) => process.exit(code), deadlineMs: 20_000 };

export async function runFailOpen(
  main: () => Promise<void>,
  deps: FailOpenDeps = defaultDeps,
): Promise<void> {
  const timer = setTimeout(() => {
    console.error("ikisatsu: 時間切れのため中断しました(セッションには影響しません)");
    deps.exit(0);
  }, deps.deadlineMs);
  timer.unref();
  try {
    await main();
  } catch {
    console.error("ikisatsu: 処理に失敗しました(セッションには影響しません)");
  }
  clearTimeout(timer);
  deps.exit(0);
}
