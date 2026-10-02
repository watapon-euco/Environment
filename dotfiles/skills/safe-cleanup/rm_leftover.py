"""Remove one leftover folder safely (see SKILL.md, section 4).

Usage:
    python rm_leftover.py <parent-dir> <name>

Refuses (exit 2/3, nothing removed) unless:
  - <name> is a plain folder name and <parent-dir>/<name> exists, and
  - no reparse point (Windows junction / symlink) or POSIX symlink exists
    anywhere inside it.
Only then is the folder removed. Read-only files are made writable and retried.
"""
import os
import shutil
import stat
import sys


def is_link(path: str) -> bool:
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode):
        return True
    attrs = getattr(st, "st_file_attributes", 0)
    return bool(attrs & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    parent = os.path.abspath(sys.argv[1])
    name = sys.argv[2]
    if name in ("", ".", "..") or os.sep in name or "/" in name:
        print("refused: <name> must be a single folder name:", name)
        return 2
    target = os.path.join(parent, name)
    if os.path.dirname(os.path.abspath(target)) != parent or not os.path.isdir(target):
        print("refused: not a folder directly under the parent:", target)
        return 2
    if is_link(target):
        print("refused: the target itself is a link:", target)
        return 3

    links, n_files = [], 0
    for base, dirs, files in os.walk(target, topdown=True, followlinks=False):
        for d in list(dirs):
            p = os.path.join(base, d)
            if is_link(p):
                links.append(p)
                dirs.remove(d)  # never descend into a link
        for f in files:
            p = os.path.join(base, f)
            if is_link(p):
                links.append(p)
            n_files += 1

    print("files:", n_files, "links:", len(links))
    if links:
        for p in links[:20]:
            print("LINK:", p)
        print("refused: links found, nothing removed (unlink them first)")
        return 3

    def onerror(func, path, exc_info):
        os.chmod(path, stat.S_IWRITE)
        func(path)

    long_path = "\\\\?\\" + target if os.name == "nt" else target
    shutil.rmtree(long_path, onerror=onerror)
    gone = not os.path.exists(target)
    print("removed:", gone)
    return 0 if gone else 1


if __name__ == "__main__":
    sys.exit(main())
