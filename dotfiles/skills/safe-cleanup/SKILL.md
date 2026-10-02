---
name: safe-cleanup
description: Read BEFORE deleting or tidying anything on disk — removing git worktrees, leftover folders, caches, old branches, or stopping processes ("片付け", "整理", "削除", "worktree を消す", "clean up", "prune", "kill"). Checklist distilled from two real incidents (a worktree removal that followed a Windows junction and wiped 193k irreplaceable files; a kill-by-name that stopped every Python on the machine).
---

# Safe cleanup

Deleting is the one thing that cannot be redone. Work in this order and do not skip steps.

## 0. Where you are
- Work from **inside the repository that owns the data**. A session started in a parent folder does not load that project's CLAUDE.md or memory, so its local warnings are invisible — `cd` into each repo and read its `CLAUDE.md` / runbooks before touching it.
- Data that is not in git (caches, downloads, `backup/`, anything `.gitignore`d) has **no undo**. Treat it as irreplaceable until you have proved otherwise.

## 1. Inventory first (read-only), then ask
Produce a table and get the user's approval before deleting anything:
- `git worktree list --porcelain` and the actual folders (unregistered leftovers exist).
- Per worktree: branch merged into main? (`git merge-base --is-ancestor <br> main`), commits ahead (`git rev-list --count main..<br>`), uncommitted changes (`git -C <wt> status --porcelain | wc -l`), last commit time and folder mtime.
- **Anything touched in the last ~48 h is probably in use by another session — keep it** unless the user says it is finished.
- A branch whose commits exist nowhere else (not merged, no remote) is kept.

## 2. Links (junctions / symlinks) — the trap
`git worktree remove`, `rm -rf` and PowerShell `Remove-Item -Recurse` can walk **through** a Windows junction and delete the real target. `git status` does not show ignored junctions.
- Before removing any folder: `cmd /c dir /AL /S /B "<folder>"` (lists reparse points). On POSIX: `find <folder> -type l`.
- If any link is found: unlink only the link — `cmd /c rmdir "<junction>"` (**no `/S`**) — then confirm the target still has its files. Never delete "through" it.
- Re-run the check immediately before each removal, not once at the start.

## 3. Save before force
Never use `--force` (or delete a dirty worktree) without archiving first, outside the folder being removed:
```
git -C <wt> status --porcelain > status.txt
git -C <wt> rev-parse HEAD      > base_commit.txt
git -C <wt> diff --binary HEAD  > uncommitted.patch      # verify: git -C <wt> apply --check -R uncommitted.patch
# copy untracked files you may need
```

## 4. Remove, one item at a time
- Registered worktree: link check → `git worktree remove <path>` (no `--force`; git refuses if dirty — good).
- Unregistered **empty** folder: `find <dir> -depth -type d -empty -delete` (deletes only empty directories).
- Unregistered folder **with files**: use `rm_leftover.py` in this skill folder (`python rm_leftover.py <parent-dir> <name>`): it refuses unless the target is a direct child of the given parent and contains no reparse point, then removes it.
- Tool pitfalls on Windows: the PowerShell tool blocks `rmdir /s`; Git Bash rewrites `/s` in `cmd /c "rmdir /s /q ..."` so nothing is removed. Always check "does it still exist?" after each command instead of trusting the exit message.
- Afterwards: `git worktree prune`; delete branches only with `git branch -d` (never `-D`), skipping branches checked out in a remaining worktree.

## 5. Prove nothing else changed
Before the first removal, record counts/sizes of the important data (e.g. number of files in each cache folder, sizes of index files). **Re-count after every step**; stop at the first difference.

## 6. Backups are not a safety net by themselves
A mirror-style backup faithfully copies a damaged source. After a cleanup, look at the backup's own report (file counts per bundle): a large drop is an incident, not a success. Do not run a backup while the source is half-restored.

## 7. Processes
- **Never stop processes by name** (`taskkill /IM python.exe`, `pkill python`, `killall node`): other sessions, MCP servers and scheduled jobs share the machine.
- Stop only what you started: note the PID at launch and use `taskkill /PID <pid>` / `kill <pid>`, or the tool's own "stop background task".
- If unsure who owns a process, list command lines first (PowerShell: `Get-CimInstance Win32_Process | Select ProcessId,CommandLine`) and ask.
- Put the same rule in every subagent brief that may start long-running work.

## 8. Report
Say what was removed, what was kept and why, where archives were saved, and the before/after counts.
