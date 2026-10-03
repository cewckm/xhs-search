# intel.py — grep the knowledge base for anything matching a regex, freshest first.
import io
import json
import os as _os
import re
import sys

_ROOT = _os.environ.get("XHS_WORKSPACE") or _os.path.join(_os.path.expanduser("~"), "Desktop", "xhs")
KB = _os.path.join(_ROOT, "kb", "notes.json")


def li(v):
    m = re.match(r"([\d.]+)\s*([万亿]?)", str(v or "0").strip())
    if not m:
        return 0
    n = float(m.group(1))
    if m.group(2) == "万":
        n *= 10000
    elif m.group(2) == "亿":
        n *= 100000000
    return int(n)


def recency_rank(n):
    """Higher = fresher. '3小时前' beats '09-11' beats nothing."""
    d = (n.get("date") or "") + " " + (n.get("title") or "")
    if re.search(r"分钟前|小时前|刚刚", d):
        return 3
    if re.search(r"昨天|前天", d):
        return 2
    if re.search(r"10\s*[-./月]\s*0?[1-6]", d):
        return 2
    if re.search(r"09-\d{2}", d):
        return 1
    return 0


notes = json.load(io.open(KB, encoding="utf-8"))
pat = re.compile(sys.argv[1] if len(sys.argv) > 1 else r".")
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 15
only_fresh = "--all" not in sys.argv

rows = []
for n in notes.values():
    title = n.get("title") or ""
    body = n.get("body") or ""
    if re.search(r"2025|2024", title + body[:200]):
        continue
    if not pat.search(title + " " + body):
        continue
    if only_fresh and recency_rank(n) == 0:
        continue
    rows.append(n)

rows.sort(key=lambda x: (-recency_rank(x), -li(x.get("likes"))))
print(f"命中 {len(rows)} 篇（仅 2026 且新鲜优先）\n")
for n in rows[:limit]:
    body = re.sub(r"\s+", " ", n.get("body") or "")[:160]
    print(f"[{str(n.get('likes') or '-'):>6}] {(n.get('title') or '')[:42]}  @{n.get('author') or '?'}  {n.get('date') or ''}")
    if body:
        print(f"         {body}")
    for c in sorted(n.get("comments") or [], key=lambda c: -li(c.get("likes")))[:2]:
        if c.get("text"):
            print(f"         └评论({c.get('likes') or 0}赞): {c['text'][:85]}")
    print()
