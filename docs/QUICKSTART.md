# 快速上手（5 分钟）

不需要装 DSH 插件也能直接用。装上插件只是为了把这份能力变成会话里可加载的技能。

---

## 前置条件

| 需要 | 说明 |
|---|---|
| Windows | 系统级鼠标事件走 `user32.dll` |
| Node.js ≥ 18 | 需要内置 `fetch` 与 `WebSocket` |
| Python + Pillow | 只在「生成报告」和图片转码时用到 |
| 小红书账号 | 首次要在一个隔离窗口里扫码登录一次 |

---

## 三步跑通

```powershell
cd "C:\Users\32464\Desktop\skill-dsh\search\scripts"

# 1) 拉起隔离浏览器窗口（独立 profile，不动你日常浏览器）
node launch.mjs

# 2) 校准鼠标坐标（自验证：点侧边栏「首页」，看 URL 有没有变）
node calibrate.mjs

# 3) 试搜一次
node core.mjs search "REDLAND 攻略" latest
```

第 1 步执行后，如果那个窗口显示登录框，**在窗口里扫码登录**。
登录态保存在 `<workspace>/edge-profile`，之后重启不用再扫。

---

## 读一篇笔记

搜索结果会打印每条的 ID 不在列表里，所以先拿 JSON：

```powershell
node core.mjs search "REDLAND 攻略" latest --json
```

拿到某条的 `id` 和 `xsecToken` 后：

```powershell
node core.mjs read <id> <xsecToken>
```

`xsecToken` 是必需的 —— 没有它，笔记页面会返回「当前笔记暂时无法浏览」。

---

## 持续采集 + 出报告

```powershell
# 采集到 22:00，每 20 分钟出一份报告
$env:XHS_END_HOUR="22"
node campaign.mjs
```

只想采集、不出报告：

```powershell
node crawler.mjs
```

只看搜索卡片（不打开任何笔记，零风控成本）：

```powershell
node -e "import('./crawler.mjs').then(m => m.runCrawler({ maxNotes: 0, deadlineMs: Date.now() + 3600_000 }))"
```

---

## 从知识库生成报告

```powershell
python synthesize.py 1 1970-01-01T00:00:00.000Z 2100-01-01T00:00:00.000Z
```

产物在 `<workspace>/reports/cycle-01/`：`report.md` + `REDLAND报告-01.docx`（含内嵌配图）。

**时间窗口注意**：时间戳统一是 **UTC ISO**（`toISOString()`）。
北京时间 14:00 要写成 `06:00Z`（减 8 小时）。

---

## 在知识库里检索

```powershell
# 找提到「接驳车」的内容，最新优先，取 10 条
python intel.py "接驳车|入场|排队" 10

# 不限年份（默认会过滤掉去年的老帖）
python intel-any.py "接驳车" 10
```

---

## 常见问题

**点击没反应？**
窗口被移动过 → 重跑 `node calibrate.mjs`。

**搜索返回 `gate: true`？**
登录态失效 → 在窗口里重新扫码。

**笔记标题显示「安全限制」？**
详情接口被限流。搜索仍可用。等 20–30 分钟再试，
或把 `XHS_DETAIL_GAP_MS` 调大（例如 60000）重新开始。

**报告里图片插入失败？**
确认 `imgfetch.mjs` 的 WebP→JPEG 转码生效（`tojpg.py` 能被 Python 调用到）。
`XHS_PYTHON` 环境变量可以指定 Python 路径。

**浏览器被关掉了？**
重跑 `node launch.mjs`，登录态还在 profile 里。

---

## 目录说明

采集数据默认放在 `~/Desktop/xhs`（若 `~/Desktop/supian/xhs` 已有知识库，则沿用后者）。

用 `XHS_WORKSPACE` 可以换位置：

```powershell
$env:XHS_WORKSPACE="D:\xhs-data"
node launch.mjs
```
