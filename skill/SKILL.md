---
name: xhs-search
description: 搜索并阅读小红书笔记——用系统级鼠标事件驱动一个隔离的浏览器窗口，抓取笔记正文与评论，落进知识库，并可生成带配图的 Markdown/Word 报告。
whenToUse: 用户要求查小红书（RED/rednote/小红书）上的内容、看某个话题下大家在说什么、收集某活动的攻略/避坑/实况、需要把笔记正文和评论整理成报告时使用。
---

# 小红书笔记搜索与阅读

用 CDP 连接一个**隔离配置的浏览器窗口**，通过**系统级鼠标点击**打开笔记，
抓取正文 + 评论 + 配图，累积到知识库，最后生成带配图的报告。

脚本都在 `{{SCRIPTS_DIR}}`，工作目录默认 `{{WORKSPACE}}`。

---

## 一、先读这一节：为什么这么做（血泪教训，别绕回去）

这四条是实测踩出来的，**任何一条走回头路都会导致任务失败**：

### 1. 必须用「系统级鼠标事件」打开笔记，不能用合成事件，更不能直接跳 URL

| 做法 | 结果 |
|---|---|
| `fetch` / 直接 `Page.navigate` 到笔记 URL | ❌ 返回 **安全限制 300013**，或 `error_code=300031 当前笔记暂时无法浏览` |
| CDP `Input.dispatchMouseEvent`（浏览器合成事件） | ❌ 前几次能用，很快被识别 → 安全限制 / 验证码 |
| **Windows `SetCursorPos` + `mouse_event`（硬件事件）** | ✅ **和你亲手点击等价，长期稳定** |

系统级点击需要**视口原点校准**（见第三节），因为要算出屏幕绝对坐标。

### 2. 搜索结果列表是虚拟列表：只有约 30 张卡片真的在 DOM 里

`window.__INITIAL_STATE__.search.feeds` 里有 44–66 条，
但 DOM 里只渲染约 30 条。**只点 DOM 里确实存在的卡片**（用 `domCardIds()` 取交集），
点不到的**跳过就好，绝不要降级为 URL 跳转**——那正是触发风控的行为。

### 3. 详情接口 `/api/sns/web/v1/feed` 一律返回 500

不要试图走 API。正文和评论**只能从 DOM 读**：
正文 `#detail-desc`，评论 `.comment-item`（过滤掉 `.comment-item-sub` 嵌套回复）。

### 4. 小红书 CDN 返回的是 WebP，不是 JPEG（哪怕 URL 以 .jpg 结尾）

python-docx 不认 WebP，直接嵌会 **`UnrecognizedImageError`**。
下载必须**嗅探魔数**：JPEG/PNG 直接用，WebP/AVIF **转码成真 JPEG**（`tojpg.py`）。

---

## 二、三条工作流

### 工作流 A：快速查一个关键词（单次，几十秒）

```bash
cd "{{SCRIPTS_DIR}}"
node core.mjs search "关键词" latest        # 搜索并打印卡片列表
node core.mjs read <笔记ID> <xsecToken>     # 读一篇笔记的正文+评论
```

### 工作流 B：批量采集 + 落库（推荐，长期稳定）

```bash
# 1) 启动隔离浏览器（带调试端口，登录态持久化在 profile 里）
node launch.mjs

# 2) 校准视口原点（每个窗口位置只需一次）
node calibrate.mjs

# 3) 持续采集：轮流搜索关键词 → 点开新鲜笔记 → 落进知识库
node crawler.mjs            # 持续跑到被停止；环境变量控制节奏

# 4) 生成报告（从知识库合成，含配图）
python synthesize.py 1 1970-01-01T00:00:00.000Z 2100-01-01T00:00:00.000Z
```

完整编排（采集不停 + 每 20 分钟出一份报告，直到指定时间）用 `campaign.mjs`。

### 工作流 C：只搜索不打开笔记（零风控成本）

搜索卡片本身就带**标题、作者、点赞/收藏数、封面图、发布时间**，
不打开笔记也能拿到。适合先摸底、或风控收紧时保底。

crawler 设 `maxNotes=0` 即纯搜索模式。

---

## 三、首次使用：四步把它跑起来

### 第 1 步：启动隔离窗口

隔离窗口用**独立的 user-data-dir**，和你日常浏览器互不干扰：

```bash
node "{{SCRIPTS_DIR}}/launch.mjs"
```

它做的事：用 `{{BROWSER_EXE}}` 启动，加 `--remote-debugging-port={{PORT}}`
和 `--user-data-dir={{WORKSPACE}}/edge-profile`，然后打开小红书。

> **登录**：首次需要在**那个窗口里**扫码登录一次。之后登录态保存在 profile 里，
> 重启不用再扫（会话过期才需要）。搜索接口未登录会返回「登录后查看搜索结果」，
> 脚本会检测到这个 gate 并提示。

### 第 2 步：校准（关键，且只需一次）

系统级点击必须知道「视口坐标 → 屏幕坐标」的偏移：

```bash
node "{{SCRIPTS_DIR}}/calibrate.mjs"
```

**自验证原理**：拿侧边栏第一个可见链接当靶子，用真鼠标点过去，
再检查 URL 有没有变化——变了就说明偏移算对了，结果写进 `osclick-cal.json`。

如果窗口被移动过，**必须重新校准**。

### 第 3 步：冒烟测试

```bash
node "{{SCRIPTS_DIR}}/core.mjs" search "美食" latest
node "{{SCRIPTS_DIR}}/status.mjs"        # 看当前页面状态（是否被限制/验证码）
```

### 第 4 步：开始采集

```bash
cd "{{SCRIPTS_DIR}}"
XHS_END_HOUR=22 node crawler.mjs
```

---

## 四、节奏与风控（必读）

平台按**账号频次**限流，与「是不是真人点击」无关——所以**慢就是快**。

| 环境变量 | 默认 | 含义 |
|---|---|---|
| `XHS_DETAIL_GAP_MS` | 25000 | 每打开一篇笔记后的间隔 |
| `XHS_SEARCH_GAP_MS` | 30000 | 搜索之间的间隔 |
| `XHS_MAX_DETAILS_PER_HOUR` | 60 | 每小时打开笔记上限（硬预算） |
| `XHS_BLOCK_COOLDOWN_MS` | 1200000 | 触发限制后的降温时长（分级递增） |
| `XHS_END_HOUR` | 22 | 跑到当天的几点收工 |
| `XHS_WARMUP_DETAILS` | 2 | 前几篇用双倍间隔热身 |

**已经被验证的安全值**：25 秒/篇、每小时 60 篇上限、连续零风控运行数小时。

### 三种限制信号，以及各自的对策

| 信号 | 含义 | 对策 |
|---|---|---|
| 笔记页标题变成 `安全限制` | 详情接口被限流 | 该标签页被重定向，但**回首页立刻恢复**；爬虫会自动降温 |
| 搜索页跳 `captcha` | 搜索也被限 | 全面停手，等 30 分钟以上 |
| 搜索返回 0 卡片 / `gate=true` | 登录态失效 | 需要重新扫码 |

**关键认知**：限制是**按接口 + 按频次**的，不是封号。
`status.mjs` 可以随时看当前页面处于哪种状态。

---

## 五、知识库

落库位置：`{{KB_DIR}}`

| 文件 | 内容 |
|---|---|
| `notes.json` | 全部笔记：`id` `title` `body` `author` `date` `ipLocation` `likes` `collects` `tags` `images[]` `cover` `comments[]` `sourceKeyword` `firstSeen` `lastFetched` |
| `searches.json` | 每次检索：时间、关键词、排序、命中数、新增数 |
| `img/` | 已下载配图（文件名 `<笔记ID>.jpg`，已转 JPEG） |

评论对象：`{author, text, likes, replies, date, ip}`

**时效性过滤**：老帖会污染结论。按 `date` 或正文里的年份过滤，例如
「只保留近三天」用 `分钟前|小时前|刚刚|昨天|前天|[123]天前`。

---

## 六、生成报告

```bash
python "{{SCRIPTS_DIR}}/synthesize.py" <报告编号> <起始ISO时间> <结束ISO时间>
```

产出 `report.md` + `.docx`（含内嵌配图），结构：

1. **多方印证结论** —— 同一说法跨笔记+评论聚合，按「几篇独立笔记印证」分级
   （≥3 篇=高，2 篇=中，1 篇=低），并标注累计点赞
2. **问了没人答的问题** —— 评论区提问但回复少的，往往是真正的坑
3. **新增笔记明细** —— 正文 + 评论表格 + 配图
4. **精选图文** —— 高热度笔记的封面/配图

`md2docx.py <in.md> <out.docx>` 可以把任意 Markdown 转成排版好的 Word。

**报告时间窗口的坑**：时间戳统一用 **UTC ISO**（`toISOString()`），
所以「本地 14:00」要写成 `06:00Z`（东八区 -8h）。窗口必须**有上下界**，
否则会把历史全部算成「本周期新增」。

---

## 七、命令速查

| 命令 | 作用 |
|---|---|
| `node launch.mjs` | 启动带调试端口的隔离窗口 |
| `node calibrate.mjs` | 校准视口原点（自验证） |
| `node status.mjs` | 当前页面状态：URL / 卡片数 / 是否被限制 / 是否验证码 |
| `node core.mjs search <关键词> [排序]` | 搜索，打印卡片列表 |
| `node core.mjs read <ID> <token>` | 读一篇笔记 |
| `node crawler.mjs` | 持续采集（搜索 → 阅读 → 落库） |
| `node campaign.mjs` | 采集 + 定时报告，跑到 `XHS_END_HOUR` |
| `python synthesize.py <n> <since> <until>` | 从知识库合成报告 |
| `python intel.py <正则> <条数>` | 在知识库里按正则检索情报（2026 优先） |
| `python md2docx.py <in.md> <out.docx>` | Markdown → Word |
| `curl http://127.0.0.1:{{PORT}}/json/version` | 确认调试端口可用 |

---

## 八、目录约定

```
{{WORKSPACE}}/
├── edge-profile/         隔离窗口的登录态（独立于日常浏览器）
├── kb/                   知识库（notes.json / searches.json / img/）
├── reports/              报告输出
└── heartbeat.json        采集进度心跳
```

---

## 九、排错

| 现象 | 原因 / 处理 |
|---|---|
| `no page target on port {{PORT}}` | 窗口没启动或调试端口没开 → 跑 `launch.mjs` |
| 点击没反应、`card-not-found` | ① 没校准或窗口被移动 → 重跑 `calibrate.mjs`；② 卡片不在 DOM（虚拟列表）→ 跳过即可 |
| 笔记标题显示 `安全限制` | 详情被限流 → 停止打开笔记，等降温（搜索仍可用） |
| 搜索返回 `gate: true` | 登录失效 → 在窗口里重新扫码 |
| Word 里图片变成 `[图片 xxx 插入失败]` | 下载时没做 WebP→JPEG 转码 → 确认 `imgfetch.mjs` 的 `sniff()` 生效 |
| 报告「本周期新增」数字离谱地大 | 时间窗口缺上界，或时间戳时区搞错（见第六节） |
| 浏览器被关掉了 | 直接重跑 `launch.mjs`（登录态还在 profile 里） |

---

## 十、合规红线

- **只读**：搜索、读笔记、读评论。**不要**点赞、评论、关注、发帖、私信。
- **限速**：按第四节的默认节奏来。批量高频抓取会触发风控，也可能违反平台条款。
- **范围**：只处理当前用户有权访问的公开内容；登录态属于用户本人，
  不要导出、上传或分享 cookie。
- **用途**：个人查阅与整理。对外发布时请注明信息来源为小红书用户，尊重原作者。
