# intel-any.py — same as intel.py but without the 2026-only filter.
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


notes = json.load(io.open(KB, encoding="utf-8"))
pat = re.compile(sys.argv[1] if len(sys.argv) > 1 else r"10\s*[-./月]\s*0?4|10月4|4号|D4|day\s*4|第四天")
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20

hits = [n for n in notes.values() if pat.search((n.get("title") or "") + " " + (n.get("body") or ""))]
hits.sort(key=lambda x: -li(x.get("likes")))
print(f"命中 {len(hits)} 篇\n")
for n in hits[:limit]:
    body = re.sub(r"\s+", " ", n.get("body") or "")[:130]
    print(f"[{str(n.get('likes') or '-'):>6}] {(n.get('title') or '')[:40]}  @{n.get('author') or '?'}  {n.get('date') or ''}")
    if body:
        print(f"         {body}")
    cm = n.get("comments") or []
    if cm:
        top = sorted(cm, key=lambda c: -li(c.get("likes")))[:2]
        for c in top:
            if c.get("text"):
                print(f"         └评论({c.get('likes') or 0}赞): {c['text'][:80]}")
    print()
