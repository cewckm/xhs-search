# xhs-search — 小红书笔记搜索与阅读（DSH 技能插件）

给 DeepSeek Harness 加一个技能：**搜索小红书、打开笔记、抓取正文与评论、落进知识库、生成带配图的报告**。

装好之后，任何会话里说「帮我查小红书上的 xxx」，模型就能加载
`xhs-search` 这个技能，拿到完整可执行的操作手册。

```
search/
├── plugin/
│   ├── package.json      插件清单（dsh.skill 指向技能与脚本位置）
│   ├── index.js          Host 侧：注册运行时技能 + 状态接口
│   ├── install.mjs       装进 DSH profile（可 --uninstall）
│   ├── selftest.mjs      不开 DSH 也能验证插件（mock context）
│   └── README.md         本文件
├── skill/
│   └── SKILL.md          技能正文（操作手册，含所有踩坑经验）
├── scripts/              可直接运行的实现（16 个脚本）
└── docs/
    └── QUICKSTART.md     从零跑通的步骤
```

---

## 一、它解决什么问题

小红书的 Web 端对自动化有识别能力，直接抓取会撞上三道墙：

| 做法 | 结果 |
|---|---|
| 直接请求笔记 URL | ❌ `安全限制 300013` / `error_code 300031 当前笔记暂时无法浏览` |
| 浏览器合成事件点击（CDP `Input.dispatchMouseEvent`） | ❌ 前几次能用，很快被识别 → 安全限制 / 验证码 |
| **Windows 系统级鼠标事件**（`SetCursorPos` + `mouse_event`） | ✅ 与真人点击等价，长期稳定 |

这个技能把第三条路完整封装好了，包括**视口原点自校准**（把 DOM 坐标换算成屏幕像素）
和**限流退避**（分级降温、小时预算、热身间隔）。

另外还解决了三个坑：

- **虚拟列表**：搜索结果里 44–66 条卡片，DOM 只渲染约 30 条 → 只点真实存在的
- **详情接口 500**：`/api/sns/web/v1/feed` 一律失败 → 正文/评论只从 DOM 读
- **图片是 WebP**：URL 以 `.jpg` 结尾但实际是 WebP，python-docx 不认 → 魔数嗅探 + 转码

---

## 二、安装

```powershell
cd "C:\Users\32464\Desktop\skill-dsh\search\plugin"
node install.mjs
```

它会做三件事：

1. 把插件装到 `<profile>/node_modules/dsh-skill-xhs-search`
2. 把 `- id: skill-xhs-search` 这一行写进 `<profile>/cordis.patch.yml`（旧文件备份为 `.bak`）
3. 打印技能与脚本的绝对路径

然后 **完全退出 DSH 再打开**（Windows 托盘图标也要退，不是刷新页面）。

可选参数：

| 参数 | 作用 |
|---|---|
| `--profile <name>` | 目标 profile（默认取 `DSH_PROFILE`，否则 `desktop`） |
| `--home <path>` | DSH 配置根目录（默认 `DSH_HOME`，否则 `~/.dsh`） |
| `--workspace <path>` | 覆盖知识库/浏览器 profile 的存放位置 |
| `--browser <exe>` | 覆盖浏览器可执行文件（默认自动探测 Edge / Chrome） |
| `--port <n>` | 覆盖调试端口（默认 9222） |
| `--uninstall` | 卸载并还原补丁 |

### 装完怎么确认生效

1. DSH 启动输出里会有这一行：
   ```
   [dsh-skill-xhs-search] host half active { skill: 'xhs-search', registered: true, ... }
   ```
2. 会话的技能目录里出现 `xhs-search`
3. 浏览器打开 `http://127.0.0.1:19387/dsh-skill-xhs-search/status` 能看到解析后的路径

不想装插件也可以直接用脚本 —— 见 `docs/QUICKSTART.md`。

---

## 三、首次使用（三步）

```powershell
cd "C:\Users\32464\Desktop\skill-dsh\search\scripts"

node launch.mjs        # 1) 拉起隔离浏览器窗口（首次需在这个窗口里扫码登录小红书）
node calibrate.mjs     # 2) 校准视口原点（自验证：点侧边栏首页，看 URL 是否变化）
node core.mjs search "REDLAND 攻略" latest   # 3) 试搜一次
```

窗口位置被移动过的话，**必须重新跑 `calibrate.mjs`**。

---

## 四、常用命令

| 命令 | 作用 |
|---|---|
| `node launch.mjs [--status]` | 启动 / 检查隔离窗口 |
| `node calibrate.mjs` | 校准鼠标坐标映射 |
| `node status.mjs` | 当前页面状态（是否被限制 / 验证码 / 卡片数） |
| `node core.mjs search "<词>" [排序]` | 搜索并列出卡片 |
| `node core.mjs read <ID> <token>` | 读一篇笔记的正文+评论 |
| `node crawler.mjs` | 持续采集（搜索 → 阅读 → 落库） |
| `node campaign.mjs` | 采集 + 定时出报告，跑到 `XHS_END_HOUR` |
| `python synthesize.py <n> <since> <until>` | 从知识库合成报告（含配图） |
| `python intel.py <正则> <条数>` | 在知识库里检索情报（2026 优先） |
| `python md2docx.py <in.md> <out.docx>` | Markdown → Word |
| `node plugin/selftest.mjs` | 插件自检（不需 DSH） |

### 节奏控制（环境变量）

| 变量 | 默认 | 含义 |
|---|---|---|
| `XHS_DETAIL_GAP_MS` | 25000 | 每篇笔记之间的间隔 |
| `XHS_SEARCH_GAP_MS` | 30000 | 搜索之间的间隔 |
| `XHS_MAX_DETAILS_PER_HOUR` | 60 | 每小时打开笔记上限 |
| `XHS_BLOCK_COOLDOWN_MS` | 1200000 | 触发限制后的降温时长 |
| `XHS_END_HOUR` | 22 | 跑到当天几点 |
| `XHS_WORKSPACE` | 自动 | 知识库/浏览器 profile 位置 |
| `XHS_BROWSER` | 自动 | 浏览器可执行文件 |
| `XHS_PORT` | 9222 | 调试端口 |
| `XHS_PYTHON` | `python` | 报告工具用的 Python |

---

## 五、数据落在哪

```
<workspace>/
├── edge-profile/     隔离窗口的登录态（独立于你日常浏览器）
├── kb/
│   ├── notes.json     全部笔记（正文/作者/时间/点赞/图集/评论/来源关键词）
│   ├── searches.json  检索记录
│   └── img/           已下载配图（JPEG）
├── reports/           报告输出（md + docx）
└── crawl.log / campaign.log / heartbeat.json
```

---

## 六、已知限制

- **仅 Windows**：系统级鼠标事件走 `user32.dll`（PowerShell + P/Invoke）。
  在 macOS/Linux 上需要换成 `cliclick` / `xdotool` 这类等价工具。
- **点击会短暂占用真实鼠标**：每次点击光标会移动过去，约 0.2 秒。
  跑批期间不适合同时使用电脑。
- **平台限流按账号频次计算**，与「是否真人点击」无关 —— 所以必须遵守默认节奏。
  三轮实测中，超过约 100 篇/半小时会触发安全限制。
- **登录态会过期**，需要偶尔在窗口里重新扫码。
- **小红书页面结构可能变化**，选择器（`#detail-desc`、`.comment-item` 等）届时需要更新。
- 技能正文里内嵌的路径是**安装时解析的绝对路径**；换机器要重跑 `install.mjs`。

---

## 七、合规

- **只读**：搜索、读笔记、读评论。不做点赞、评论、关注、发帖、私信。
- 只处理当前用户有权访问的公开内容；**登录态属于用户本人，不要导出或分享 cookie**。
- 遵守默认限速。高频批量抓取会触发平台风控，也可能违反平台条款。
- 整理结果对外发布时，请注明信息来自小红书用户并尊重原作者。
