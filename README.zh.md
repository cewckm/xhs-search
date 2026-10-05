# xhs-search

[English](README.md) | **中文**

**给 DeepSeek Harness 的小红书笔记搜索技能** —— 搜索关键词、打开笔记、抓取正文与评论、
落进本地知识库，再合成带配图的报告。

包装成 DSH 插件（`dsh.skill`），装上之后任何会话说一句「帮我查小红书上的 xxx」，
模型就会加载 `xhs-search` 技能并拿到完整可执行的操作手册。

---

## 为什么需要它

小红书的 Web 端能识别自动化，直接抓取会连撞三道墙。这个项目把绕过路径完整封装好了：

| 做法 | 结果 |
|---|---|
| 直接请求笔记 URL | ❌ `安全限制 300013` / `error_code 300031 当前笔记暂时无法浏览` |
| 浏览器合成事件点击（CDP `Input.dispatchMouseEvent`） | ❌ 前几次能用，很快被识别 → 安全限制 / 验证码 |
| **Windows 系统级鼠标事件**（`SetCursorPos` + `mouse_event`） | ✅ 与真人点击等价，可长时间稳定运行 |

实测对比（同一时刻、同一账号）：**URL 跳转被拦，系统级点击成功读取 265 字正文。**

除了反爬，还解决了三个实际坑：

- **搜索结果虚拟列表**：接口返回 44–66 条卡片，DOM 只渲染约 30 条 → 只点真实存在的
- **详情接口 500**：`/api/sns/web/v1/feed` 一律失败 → 正文/评论只从 DOM 读
- **图片是 WebP**：URL 以 `.jpg` 结尾但实际是 WebP，python-docx 不认 → 魔数嗅探 + 转码

---

## 结构

```
.
├── plugin/            DSH 插件
│   ├── package.json     清单（dsh.skill 指向技能与脚本）
│   ├── index.js         Host 侧：注册运行时技能 + 状态接口
│   ├── install.mjs      安装 / 卸载（写 profile 补丁层）
│   ├── selftest.mjs     不开 DSH 即可验证（mock context）
│   └── README.md        安装与使用详解
├── skill/SKILL.md     技能正文（模型加载的操作手册）
├── scripts/           可直接运行的实现
│   ├── config.mjs       路径解析（环境变量 / config.json / 默认值）
│   ├── launch.mjs       拉起带调试端口的隔离浏览器
│   ├── calibrate.mjs    视口原点自校准（系统级点击的前提）
│   ├── osclick.mjs/.ps1 Windows 系统级鼠标输入
│   ├── core.mjs         CDP 搜索 / 读笔记
│   ├── click-read.mjs   点击式阅读（含虚拟列表处理）
│   ├── crawler.mjs      持续采集 + 限流退避
│   ├── campaign.mjs     采集 + 定时报告编排
│   ├── kb.mjs           知识库
│   ├── imgfetch.mjs     配图下载（WebP→JPEG）
│   ├── synthesize.py    报告合成（多方印证 / 待解答问题 / 配图）
│   ├── intel.py         知识库情报检索
│   └── md2docx.py       Markdown → Word
└── docs/QUICKSTART.md 5 分钟上手
```

---

## 快速开始

**不装插件，直接用脚本：**

```powershell
git clone <this repo>
cd scripts

node launch.mjs      # 拉起隔离浏览器（首次在这个窗口里扫码登录小红书）
node calibrate.mjs   # 校准鼠标坐标映射（自验证）
node core.mjs search "关键词" latest
```

**装成 DSH 技能：**

```powershell
cd plugin
node install.mjs
# 然后完全退出 DSH（含托盘图标）再打开
```

详见 [plugin/README.md](plugin/README.md) 与 [docs/QUICKSTART.md](docs/QUICKSTART.md)。

---

## 运行要求

| 需求 | 说明 |
|---|---|
| **Windows** | 系统级鼠标事件走 `user32.dll`（PowerShell + P/Invoke）。macOS/Linux 需换 `cliclick` / `xdotool` |
| **Node.js ≥ 18** | 依赖内置 `fetch` 与 `WebSocket` |
| **Python + Pillow** | 仅报告生成与图片转码需要 |
| **Edge 或 Chrome** | 自动探测，可用 `XHS_BROWSER` 覆盖 |
| 小红书账号 | 首次需在隔离窗口扫码登录一次，之后登录态存在本地 profile |

---

## 配置（环境变量）

| 变量 | 默认 | 含义 |
|---|---|---|
| `XHS_WORKSPACE` | `~/Desktop/xhs` | 知识库 / 浏览器 profile / 报告的位置 |
| `XHS_BROWSER` | 自动探测 | 浏览器可执行文件 |
| `XHS_PORT` | `9222` | 调试端口 |
| `XHS_PYTHON` | `python` | 报告工具用的 Python |
| `XHS_DETAIL_GAP_MS` | `25000` | 每篇笔记之间的间隔 |
| `XHS_SEARCH_GAP_MS` | `30000` | 搜索之间的间隔 |
| `XHS_MAX_DETAILS_PER_HOUR` | `60` | 每小时打开笔记上限 |
| `XHS_BLOCK_COOLDOWN_MS` | `1200000` | 触发限制后的降温时长 |
| `XHS_END_HOUR` | `22` | 定时任务跑到当天几点 |

---

## 数据落在哪

```
<workspace>/
├── edge-profile/     隔离窗口的登录态（独立于你日常浏览器）
├── kb/
│   ├── notes.json     笔记（正文 / 作者 / 时间 / 点赞 / 图集 / 评论 / 来源关键词）
│   ├── searches.json  检索记录
│   └── img/           已下载配图（JPEG）
└── reports/           报告（md + docx，含内嵌配图）
```

---

## 已知限制

- **仅 Windows**：核心的点击与校准依赖 Win32 API。
- **点击会短暂占用真实鼠标**：每次点击光标会移过去约 0.2 秒，跑批期间不适合同时用电脑。
- **平台限流按账号频次计算**，与「是否真人点击」无关。实测超过约 100 篇/半小时会触发安全限制。
- **登录态会过期**，需要偶尔重新扫码。
- **页面结构可能变化**，选择器（`#detail-desc`、`.comment-item` 等）届时需要更新。
- 技能正文里内嵌的路径是**安装时解析的绝对路径**，换机器要重跑安装。

---

## 合规与免责

- 本项目**只读**：搜索、读笔记、读评论。不做点赞、评论、关注、发帖、私信。
- 只应处理使用者有权访问的公开内容。**登录态属于使用者本人，不要导出或分享 cookie。**
- 请遵守默认限速。高频批量抓取会触发平台风控，也可能违反平台服务条款。
- 整理出的内容对外发布时，请注明信息来自小红书用户并尊重原作者。
- 本项目仅供个人学习与信息整理使用，使用者需自行承担合规责任。

---

## License

MIT — 见 [LICENSE](LICENSE)。
