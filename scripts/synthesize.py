# synthesize.py — build a report from the accumulated knowledge base.
# Usage: python synthesize.py <cycleIndex|final> <sinceIso> <untilIso>
import json
import os
import re
import sys
from datetime import datetime, timezone

# Where the knowledge base lives. Same resolution as scripts/config.mjs: an
# explicit XHS_WORKSPACE wins, otherwise ~/Desktop/xhs, except that an existing
# ~/Desktop/supian/xhs (this skill's first deployment) is reused when present.
def _resolve_root():
    explicit = os.environ.get("XHS_WORKSPACE")
    if explicit:
        return explicit
    home = os.path.expanduser("~")
    legacy = os.path.join(home, "Desktop", "supian", "xhs")
    if os.path.exists(os.path.join(legacy, "kb", "notes.json")):
        return legacy
    return os.path.join(home, "Desktop", "xhs")


ROOT = _resolve_root()
KB_NOTES = os.path.join(ROOT, "kb", "notes.json")
KB_SEARCHES = os.path.join(ROOT, "kb", "searches.json")
KB_IMG = os.path.join(ROOT, "kb", "img")
REPORTS = os.path.join(ROOT, "reports")

cycle_arg = sys.argv[1] if len(sys.argv) > 1 else "1"
since_iso = sys.argv[2] if len(sys.argv) > 2 else "1970-01-01T00:00:00.000Z"
until_iso = sys.argv[3] if len(sys.argv) > 3 else datetime.now(timezone.utc).isoformat()
is_final = cycle_arg == "final"
cycle = 0 if is_final else int(cycle_arg)

with open(KB_NOTES, encoding="utf-8") as f:
    NOTES = json.load(f)
try:
    with open(KB_SEARCHES, encoding="utf-8") as f:
        SEARCHES = json.load(f)
except Exception:
    SEARCHES = []


def parse_iso(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


SINCE, UNTIL = parse_iso(since_iso), parse_iso(until_iso)
local = lambda dt: dt.astimezone().strftime("%m-%d %H:%M")


def to_int(v):
    if v is None:
        return 0
    m = re.match(r"([\d.]+)\s*([万亿]?)", str(v).strip())
    if not m:
        return 0
    n = float(m.group(1))
    if m.group(2) == "万":
        n *= 10000
    elif m.group(2) == "亿":
        n *= 100000000
    return int(n)


def valid(n):
    if re.search(r"安全限制|访问频繁|操作过于频繁", n.get("title") or ""):
        return False
    return bool((n.get("body") or "").strip()) or bool(n.get("images"))


ALL = [n for n in NOTES.values() if valid(n)]
SKIPPED = len(NOTES) - len(ALL)
NEW = [n for n in ALL if SINCE <= parse_iso(n.get("firstSeen", "1970-01-01T00:00:00Z")) <= UNTIL]
NEW_COMMENT_NOTES = [n for n in ALL
                     if parse_iso(n.get("firstSeen", "1970-01-01T00:00:00Z")) < SINCE
                     and parse_iso(n.get("lastCommentAt", "1970-01-01T00:00:00Z")) >= SINCE]
SEARCH_WINDOW = [s for s in SEARCHES if SINCE <= parse_iso(s.get("at", "1970-01-01T00:00:00Z")) <= UNTIL]

TOTAL_COMMENTS = sum(len(n.get("comments") or []) for n in ALL)
TOTAL_NEW_COMMENTS = sum(len(n.get("comments") or []) for n in NEW)
NEW_COMMENTS = sum(len(n.get("comments") or []) for n in NEW_COMMENT_NOTES)

# ---------------- theme taxonomy ----------------
THEMES = [
    ("交通 / 入场 / 接驳车",
     r"接驳车|接驳|12号线|地铁|爱国路|复兴岛|时尚中心|2号门|打车|停车|入场|进场|班车|岛"),
    ("排队时长与最佳到场时间",
     r"排队|排了|等了|限流|人多|拥挤|队伍|小时才|建议早|早点去|一早|几点到"),
    ("PIN 收集与兑换规则",
     r"\bpin\b|PIN|徽章|集pin|集齐|兑换|换pin|冰箱贴|结算点|领pin|碎片"),
    ("无料 / 免费周边领取",
     r"无料|先到先得|限量|领取|免费|赠品|打卡送|送完即止|特典|物料|周边|透卡|卡套"),
    ("地图 / 分区 / 展位",
     r"地图|分区|展位|A区|B区|C区|A馆|B馆|C馆|摊位|路线图|导览|平面图|C-16|B-16"),
    ("花车巡游",
     r"花车|巡游|游行|parade"),
    ("演出 / 音乐会",
     r"音乐会|演出|舞台|live|演唱会|表演|歌手|DJ"),
    ("天气 / 装备 / 必带清单",
     r"天气|下雨|雨衣|雨伞|太阳|晒|防晒|降温|外套|穿着|冲锋衣|鞋|充电宝|信号|网络|马扎"),
    ("NPC / 互动任务",
     r"NPC|npc|互动|任务|剧情|角色扮演|盖章"),
    ("餐饮 / 补给",
     r"吃|喝|餐饮|小吃|饮料|餐|补给|咖啡|水"),
    ("门票 / 黄牛 / 入场资格",
     r"黄牛|票价|加价|转让|捡漏|门票|入场券|登岛资格|预约"),
    ("时间安排 / 值得去吗",
     r"几点|时长|半天|一整天|建议.*点|截止|结束时间|值得|值不值|体验"),
]
BUILD = {t[0]: {"sources": [], "voices": [], "likes": 0} for t in THEMES}
SEEN = set()


def snippet(text, pat, width=110):
    t = re.sub(r"\s+", " ", text or "").strip()
    m = re.search(pat, t, re.I)
    if not m:
        return t[: width * 2]
    a = max(0, m.start() - width)
    b = min(len(t), m.end() + width)
    return ("…" if a > 0 else "") + t[a:b] + ("…" if b < len(t) else "")


def add(theme, who, text, likes, kind, src, pat):
    b = BUILD[theme]
    quote = snippet(text, pat)
    key = (str(src)[:22], quote[:55])
    if key in SEEN:
        return
    SEEN.add(key)
    lk = to_int(likes)
    b["likes"] += lk
    b["voices"].append({"who": who, "text": quote, "likes": lk, "kind": kind, "src": src})
    if kind == "note":
        b["sources"].append(str(src)[:38])
    elif str(src)[:38] not in b["sources"]:
        b["sources"].append(str(src)[:38])


pool = ALL if is_final else (NEW + NEW_COMMENT_NOTES)
for n in pool:
    title = n.get("title") or ""
    body = re.sub(r"\s+", " ", n.get("body") or "")[:2200]
    for name, pat in THEMES:
        if re.search(pat, f"{title} {body}", re.I):
            add(name, n.get("author") or "?", body or title, n.get("likes"), "note", title, pat)
    for cm in (n.get("comments") or []):
        t = cm.get("text") or ""
        for name, pat in THEMES:
            if re.search(pat, t, re.I):
                add(name, cm.get("author") or "匿名", t, cm.get("likes"), "comment", title, pat)

FINDINGS = []
for name, b in BUILD.items():
    nsrc, nv = len(set(b["sources"])), len(b["voices"])
    if not nv:
        continue
    if nsrc >= 3 and b["likes"] >= 50:
        verdict, conf = "可信度高 —— 多篇独立笔记 + 评论互相印证", "高"
    elif nsrc >= 2 and b["likes"] >= 30:
        verdict, conf = "基本可信 —— 有交叉印证，但存在个体差异", "中"
    elif nsrc >= 2:
        verdict, conf = "多篇说法一致但互动量小 —— 可参考，建议现场核实", "中低"
    else:
        verdict, conf = "仅单一来源 —— 未获多方印证，需现场核实", "低"
    FINDINGS.append({"theme": name, "sources": nsrc, "voices": nv, "likes": b["likes"],
                     "verdict": verdict, "conf": conf,
                     "quotes": sorted(b["voices"], key=lambda v: -v["likes"])[:5]})
FINDINGS.sort(key=lambda f: (-f["sources"], -f["likes"]))

# ---------------- unanswered questions ----------------
QS = []
for n in pool:
    for cm in (n.get("comments") or []):
        t = (cm.get("text") or "").strip()
        if len(t) < 5 or to_int(cm.get("replies")) >= 2:
            continue
        if not re.search(r"[?？]", t) and not re.search(r"(吗|呢)[。！!~～\s]*$", t):
            continue
        QS.append({"text": t[:170], "who": cm.get("author") or "匿名", "ip": cm.get("ip") or "-",
                   "replies": to_int(cm.get("replies")), "note": (n.get("title") or "")[:28]})
QS.sort(key=lambda q: (q["replies"], -to_int(q.get("likes"))))

# ---------------- images for this report ----------------
import shutil
IMG_DIR = os.path.join(REPORTS, "final", "img") if is_final else os.path.join(REPORTS, f"cycle-{cycle:02d}", "img")
os.makedirs(IMG_DIR, exist_ok=True)

def img_for(note):
    """Cached first-image for a note; downscale so the document stays emailable."""
    src = os.path.join(KB_IMG, f"{note['id']}.jpg")
    if not os.path.exists(src):
        return None
    dst = os.path.join(IMG_DIR, f"{note['id']}.jpg")
    if not os.path.exists(dst):
        try:
            from PIL import Image
            with Image.open(src) as im:
                im = im.convert("RGB")
                im.thumbnail((900, 1200))
                im.save(dst, "JPEG", quality=74)
        except Exception:
            try:
                shutil.copyfile(src, dst)
            except Exception:
                return None
    return dst if os.path.exists(dst) else None


GALLERY = []
pool_sorted = sorted(NEW if not is_final else ALL, key=lambda x: -to_int(x.get("likes")))
cap = 14 if is_final else 6
for n in pool_sorted:
    if len(GALLERY) >= cap:
        break
    f_ = img_for(n)
    if not f_:
        continue
    GALLERY.append({"id": n["id"], "file": f_, "title": (n.get("title") or "")[:44],
                    "author": n.get("author") or "?", "likes": n.get("likes") or "-",
                    "body": re.sub(r"\s+", " ", n.get("body") or "")[:120]})

GALLERY_FULL = []
if is_final:
    for n in pool_sorted[:18]:
        f_ = img_for(n)
        if f_:
            GALLERY_FULL.append({"id": n["id"], "file": f_, "title": (n.get("title") or "")[:44],
                                 "author": n.get("author") or "?", "likes": n.get("likes") or "-",
                                 "body": re.sub(r"\s+", " ", n.get("body") or "")[:150]})

title_line = ("REDLAND 2026 完整攻略（全场汇总）" if is_final
              else f"REDLAND 2026 攻略追踪 · 第 {cycle} 份报告")
window_line = (f"累计知识库：{len(ALL)} 篇笔记 / {TOTAL_COMMENTS} 条评论"
               if is_final else
               f"本周期（{local(SINCE)} → {local(UNTIL)}）新增 {len(NEW)} 篇笔记 · {TOTAL_NEW_COMMENTS} 条评论")

L = []
A = L.append
A(f"# {title_line}")
A("")
A(f"- **生成时间**：{datetime.now().astimezone().strftime('%Y-%m-%d %H:%M')}")
A(f"- **{window_line}**")
if not is_final:
    A(f"- **累计知识库**：{len(ALL)} 篇笔记 / {TOTAL_COMMENTS} 条评论（爬虫全程不停，持续扩充）")
    A(f"- **本轮又复查出新评论的笔记**：{len(NEW_COMMENT_NOTES)} 篇（+{NEW_COMMENTS} 条评论）")
    if SEARCH_WINDOW:
        kws = "、".join(dict.fromkeys(s.get("keyword", "") for s in SEARCH_WINDOW))
        A(f"- **本周期检索的关键词**（{len(SEARCH_WINDOW)} 次）：{kws}")
A(f"- **行程**：10 月 4 日到场 → 优先采纳 10/2、10/3 现场实战信息")
A("")

if FINDINGS:
    A("## 一、多方印证结论（按「多少人说过」排序）")
    A("")
    A("> 判定：≥3 篇独立笔记互相印证 → **高**；2 篇交叉 → **中**；仅 1 篇 → **低（需现场核实）**。")
    A("")
    A("| 结论 / 话题 | 支撑笔记 | 相关言论 | 累计点赞 | 可信度 |")
    A("|---|---|---|---|---|")
    for f in FINDINGS:
        A(f"| {f['theme']} | {f['sources']} 篇 | {f['voices']} 条 | {f['likes']} | **{f['conf']}** |")
    A("")
    for f in FINDINGS:
        A(f"### 【{f['conf']}】{f['theme']}")
        A("")
        A(f"{f['verdict']}　｜　支撑：{f['sources']} 篇独立笔记 · {f['voices']} 条言论 · 累计点赞 {f['likes']}")
        A("")
        for q in f["quotes"]:
            tag = "笔记" if q["kind"] == "note" else "评论"
            A(f"- [{tag}｜@{q['who']}｜赞{q['likes']}] {q['text']}")
        A("")

if QS:
    A("## 二、问了没人答的问题（明天可能踩的坑）")
    A("")
    A("| 问题 | 提问者 | 属地 | 回复 | 出自笔记 |")
    A("|---|---|---|---|---|")
    for q in QS[:18]:
        A(f"| {q['text'].replace('|', '／')} | @{q['who']} | {q['ip']} | {q['replies']} | {q['note'].replace('|', '／')} |")
    A("")

fresh_pool = sorted(NEW if not is_final else ALL, key=lambda x: (-to_int(x.get("likes"))))[:12]
A("## 三、本周期新增笔记（按热度）")
A("")
for i, n in enumerate(fresh_pool, 1):
    A(f"### {i}. {(n.get('title') or '(无标题)').strip()}")
    A("")
    meta = f"**@{n.get('author') or '?'}** ｜ 赞 {n.get('likes') or '-'} · 藏 {n.get('collects') or '-'}"
    if n.get("date"):
        meta += f" ｜ 发布：{n['date']}"
    if n.get("ipLocation"):
        meta += f" ｜ 属地：{n['ipLocation']}"
    if n.get("sourceKeyword"):
        meta += f" ｜ 检索词：{n['sourceKeyword']}"
    A(meta)
    A("")
    body = re.sub(r"\s+", " ", n.get("body") or "")[:1500]
    if body:
        A(body)
        A("")
    cms = n.get("comments") or []
    if cms:
        A(f"**评论区（{len(cms)} 条，按赞排序）**")
        A("")
        for cm in sorted(cms, key=lambda c: -to_int(c.get("likes")))[:6]:
            A(f"- [{cm.get('likes') or 0} 赞｜{cm.get('ip') or '-'}] @{cm.get('author') or '?'}：{cm.get('text')}")
        A("")
    if n.get("images"):
        f_ = os.path.join(IMG_DIR, f"{n['id']}.jpg")
        if os.path.exists(f_):
            A(f"![{(n.get('title') or '')[:20]}](img/{n['id']}.jpg)")
            A("")
    A(f"https://www.xiaohongshu.com/explore/{n['id']}")
    A("")
    A("---")
    A("")

if GALLERY:
    A("## 四、精选图文（正文 + 配图）")
    A("")
    for g in GALLERY:
        A(f"### {g['title']}")
        A("")
        A(f"@{g['author']}　赞{g['likes']}")
        A("")
        if g.get("body"):
            A(g["body"])
            A("")
        A(f"![{g['title']}](img/{os.path.basename(g['file'])})")
        A("")

os.makedirs(os.path.join(REPORTS, f"cycle-{cycle:02d}") if not is_final else os.path.join(REPORTS, "final"), exist_ok=True)
base_dir = os.path.join(REPORTS, "final") if is_final else os.path.join(REPORTS, f"cycle-{cycle:02d}")
md_path = os.path.join(base_dir, "report.md")
with open(md_path, "w", encoding="utf-8") as f:
    f.write("\n".join(L))

# ---------------- Word ----------------
try:
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn

    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = "微软雅黑"
    st.font.size = Pt(10.5)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")

    doc.add_heading(title_line, level=0)
    p = doc.add_paragraph()
    p.add_run(window_line + "\n").bold = True
    if not is_final:
        p.add_run(f"累计知识库：{len(ALL)} 篇笔记 / {TOTAL_COMMENTS} 条评论\n")
        if SEARCH_WINDOW:
            p.add_run("本周期检索：" + "、".join(dict.fromkeys(s.get("keyword", "") for s in SEARCH_WINDOW))[:300] + "\n")
    p.add_run("行程：10 月 4 日到场 → 优先采纳 10/2、10/3 现场实战信息")

    if FINDINGS:
        doc.add_heading("一、多方印证结论", level=1)
        t = doc.add_table(rows=1, cols=5)
        t.style = "Light Grid Accent 1"
        for j, h in enumerate(["话题", "支撑笔记", "相关言论", "累计点赞", "可信度"]):
            t.rows[0].cells[j].text = h
        for f in FINDINGS:
            r = t.add_row().cells
            r[0].text, r[1].text, r[2].text = f["theme"], f"{f['sources']} 篇", f"{f['voices']} 条"
            r[3].text, r[4].text = str(f["likes"]), f["conf"]
        for f in FINDINGS:
            doc.add_heading(f"【{f['conf']}】{f['theme']}", level=2)
            v = doc.add_paragraph()
            v.add_run(f"{f['verdict']}\n").bold = True
            v.add_run(f"支撑：{f['sources']} 篇独立笔记 · {f['voices']} 条言论 · 累计点赞 {f['likes']}")
            for q in f["quotes"]:
                tag = "笔记" if q["kind"] == "note" else "评论"
                doc.add_paragraph(f"[{tag}｜@{q['who']}｜赞{q['likes']}] {q['text']}", style="List Bullet")

    if QS:
        doc.add_heading("二、问了没人答的问题", level=1)
        qt = doc.add_table(rows=1, cols=4)
        qt.style = "Light Grid Accent 1"
        for j, h in enumerate(["问题", "提问者", "回复", "出自笔记"]):
            qt.rows[0].cells[j].text = h
        for q in QS[:18]:
            r = qt.add_row().cells
            r[0].text, r[1].text, r[2].text, r[3].text = q["text"][:130], "@" + q["who"], str(q["replies"]), q["note"][:26]

    doc.add_heading("三、本周期新增笔记", level=1)
    for n in fresh_pool:
        doc.add_heading((n.get("title") or "(无标题)")[:70], level=2)
        m = doc.add_paragraph()
        rr = m.add_run(f"@{n.get('author') or '?'} ｜ 赞 {n.get('likes') or '-'} · 藏 {n.get('collects') or '-'}"
                       + (f" ｜ {n.get('date')}" if n.get("date") else "")
                       + (f" ｜ {n.get('ipLocation')}" if n.get("ipLocation") else ""))
        rr.font.size = Pt(9)
        rr.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
        body = re.sub(r"\s+", " ", n.get("body") or "")[:1200]
        if body:
            doc.add_paragraph(body)
        cms = n.get("comments") or []
        if cms:
            doc.add_paragraph("评论区（按赞排序）：").runs[0].bold = True
            for cm in sorted(cms, key=lambda c: -to_int(c.get("likes")))[:6]:
                doc.add_paragraph(f"[{cm.get('likes') or 0} 赞｜{cm.get('ip') or '-'}] @{cm.get('author') or '?'}：{cm.get('text')}",
                                  style="List Bullet")
        f_ = os.path.join(IMG_DIR, f"{n['id']}.jpg")
        if os.path.exists(f_):
            try:
                doc.add_picture(f_, width=Inches(4.6))
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            except Exception as e:
                doc.add_paragraph(f"[配图插入失败: {e}]")

    if GALLERY:
        doc.add_heading("四、精选图文", level=1)
        for g in GALLERY:
            doc.add_heading(g["title"], level=2)
            meta = doc.add_paragraph()
            rr = meta.add_run(f"@{g['author']}　赞{g['likes']}")
            rr.font.size = Pt(9)
            rr.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
            if g.get("body"):
                doc.add_paragraph(g["body"])
            try:
                doc.add_picture(g["file"], width=Inches(4.6))
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            except Exception as e:
                doc.add_paragraph(f"[配图插入失败: {e}]")

    docx_name = "REDLAND完整攻略.docx" if is_final else f"REDLAND报告-{cycle:02d}.docx"
    doc.save(os.path.join(base_dir, docx_name))
    print(f"DOCX {docx_name}")
except Exception as e:
    print(f"DOCX_SKIP {type(e).__name__} {e}")

print(f"MD {os.path.basename(md_path)}")
print(f"STATS new_notes={len(NEW)} new_comments={TOTAL_NEW_COMMENTS} kb_notes={len(ALL)} "
      f"kb_comments={TOTAL_COMMENTS} findings={len(FINDINGS)} questions={len(QS)} images={len(GALLERY)}")
