# Environment

Claude Code の個人設定（全プロジェクト共通）を管理する dotfiles リポジトリ。

## 中身

| パス | 内容 |
| --- | --- |
| `dotfiles/CLAUDE.md` | 全体共通の指示 → `~/.claude/CLAUDE.md` |
| `dotfiles/agents/` | サブエージェント定義 → `~/.claude/agents/` |
| `dotfiles/agents-optional/` | 普段は無効にしておくサブエージェント（`setup.sh` はコピーしない） |
| `setup.sh` | 上記を `~/.claude/` にコピーし、`settings.json` に必要な設定を追加する |
| `apply-to-existing.sh` | 既存リポジトリに、クラウドセッション用の自動同期フックを追加する |

## 使い方

`dotfiles/` を編集したら、次のコマンドで `~/.claude/` に反映する（何回実行しても大丈夫）。

```bash
bash setup.sh
```

jq がない環境では `settings.json` は更新されないので、表示された内容を手作業で追加する。

## 運用メモ

- **CLAUDE.md は頻繁に変えない**。内容が変わるとプロンプトキャッシュ（前回と同じ部分の読み込みを安くする仕組み）が効かなくなる。変更はまとめて行う。
- CLAUDE.md はサブエージェントにも毎回渡されるので、短く保つほど全体のコストが下がる。公式の目安は200行未満。

## Haiku 版 Explore を有効にする

組み込みの Explore はメインセッションと同じモデル（上限は Opus）で動く。コストを下げたい期間は、Haiku 版に切り替える。

1. `dotfiles/agents-optional/Explore.md` を `dotfiles/agents/` に移動する
2. `dotfiles/CLAUDE.md` の表で、Explore 行のモデル欄を `Haiku` に書き換える
3. `bash setup.sh` を実行する

元に戻すときは、逆の手順を行ったうえで `~/.claude/agents/Explore.md` を削除する。
