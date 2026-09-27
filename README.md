# Environment

Claude Code の個人設定（全プロジェクト共通）を管理する dotfiles リポジトリ。

## 中身

| パス | 内容 |
| --- | --- |
| `dotfiles/CLAUDE.md` | 全体共通の指示 → `~/.claude/CLAUDE.md` |
| `dotfiles/agents/` | サブエージェント定義 → `~/.claude/agents/` |
| `dotfiles/agents-optional/` | 普段は無効にしておくサブエージェント（`setup.sh` はコピーしない） |
| `dotfiles/hooks/` | Claude Code フック（`context-guard.js` など） → `~/.claude/hooks/` |
| `setup.sh` | 上記を `~/.claude/` にコピーし、`settings.json` にフックを登録する（Node で処理） |
| `apply-to-existing.sh` | 既存リポジトリに、クラウドセッション用のフック（設定の自動同期と context-guard）を追加する |
| `tests/` | `context-guard.js` のテスト（`node --test tests/context-guard.test.js`） |

## 使い方

`dotfiles/` を編集したら、次のコマンドで `~/.claude/` に反映する（何回実行しても大丈夫）。

```bash
bash setup.sh
```

## 運用メモ

- **CLAUDE.md は頻繁に変えない**。内容が変わるとプロンプトキャッシュ（前回と同じ部分の読み込みを安くする仕組み）が効かなくなる。変更はまとめて行う。
- CLAUDE.md はサブエージェントにも毎回渡されるので、短く保つほど全体のコストが下がる。公式の目安は200行未満。

## コンテキスト・チェックポイント（context-guard）

- `dotfiles/hooks/context-guard.js` は Stop フック（会話が一区切りつくたびに呼ばれる）で、トランスクリプト（会話ログ）の末尾からトークン使用量を読み取ってコンテキスト使用率を計算する。追加のAPI呼び出しはなく、コストはかからない。
- 使用率が 60/70/80/90%（既定）に達するたびに、Claude に「今のうちにチェックポイントを取って」と指示を追加する。
- 保存先は2種類: 恒久的なプロジェクト知識（決定事項・理由・規約・コマンドなど）はプロジェクトのリポジトリ（CLAUDE.md や README など）か、そのプロジェクトの自動メモリに書く。一時的な進捗（今のゴール・完了/未完了・次にやること）は `%TEMP%/claude-handoff/<session>.md` に上書きする。
- オートコンパクション（自動要約。長くなった会話を要約して圧縮する機能）でこの会話が要約された直後、SessionStart フックが `<session>.md` の内容を自動的に読み込んで会話に注入し直す。
- クラウドセッションはユーザー設定（`~/.claude/settings.json`）のフックを使わないため、各リポジトリの `.claude/settings.json` にもクラウドでだけ動く同じフックを入れてある（`apply-to-existing.sh` で追加）。ローカルではそちらは何もせずに終わる。
- 閾値を変えたい場合は `~/.claude/settings.json` の `env` に `CONTEXT_GUARD_PCT`（開始%、既定60）と `CONTEXT_GUARD_STEP`（何%刻みで再通知するか、既定10）を設定する。

## Haiku 版 Explore を有効にする

組み込みの Explore はメインセッションと同じモデル（上限は Opus）で動く。コストを下げたい期間は、Haiku 版に切り替える。

1. `dotfiles/agents-optional/Explore.md` を `dotfiles/agents/` に移動する
2. `dotfiles/CLAUDE.md` の表で、Explore 行のモデル欄を `Haiku` に書き換える
3. `bash setup.sh` を実行する

元に戻すときは、逆の手順を行ったうえで `~/.claude/agents/Explore.md` を削除する。
