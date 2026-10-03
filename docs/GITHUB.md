# GitHub 使用说明（给第一次用 GitHub 的人）

这个文件夹已经是一个 **git 仓库**，并且已经发布到：

**https://github.com/cewckm/xhs-search**

---

## 一、最重要的概念（一句话版）

| 名词 | 白话解释 |
|---|---|
| **仓库 (repo)** | 你这个项目的线上副本，就是上面那个网址 |
| **提交 (commit)** | 给当前的改动拍一张"快照"，存在你本地 |
| **推送 (push)** | 把本地的快照上传到线上仓库 |
| **token** | 一把临时钥匙，让 `git` 有权限上传。**用完就该销毁** |

**改完东西 ≠ 已经上传。** 必须「提交 + 推送」才算更新到线上。

---

## 二、以后怎么更新（两种方式）

### 方式 A：一句话更新（推荐）

```powershell
cd "C:\Users\32464\Desktop\skill-dsh\search\scripts"
.\gh-update.ps1 -Message "描述你改了什么"
```

它会自动完成：显示改动 → 提交 → 生成临时钥匙 → 推送 → **删除钥匙** → 校验线上线下一致。

前提：需要一个**登录着 GitHub 的可调试浏览器窗口**。没有的话先跑一次：

```powershell
node .\launch-gh.mjs        # 打开一个可被工具驱动的浏览器窗口，登录 GitHub（只需一次）
```

### 方式 B：手动 git（想自己掌控时）

```powershell
cd "C:\Users\32464\Desktop\skill-dsh\search"

git status                  # 看改了什么
git add -A                  # 把改动加入待提交
git commit -m "改了什么"     # 提交（本地快照）
git push origin main        # 推送到线上
```

`git push` 会要求认证。第一次用的话，建议先跑一次方式 A，
让 `.git-credentials` 之外的东西都配好；或者用 GitHub Desktop 这类图形工具。

---

## 三、想省掉"每次生成钥匙"？做一个长期钥匙

如果你以后会经常更新，可以手动建一个**长期 token**，之后 `git push` 就不用再走浏览器了：

1. 打开 https://github.com/settings/tokens/new
2. **Note**：随便写，比如 `xhs-search long-lived`
3. **Expiration**：选 90 天或 No expiration
4. 勾选 **`repo`**（这一个就够）
5. 点 **Generate token**，复制那串 `ghp_...`
6. 在 PowerShell 里存进凭据管理器（Windows 会加密保存）：

```powershell
# 第一次推送时输入用户名 cewckm、密码粘贴 token，之后就会记住
git config --global credential.helper manager
cd "C:\Users\32464\Desktop\skill-dsh\search"
git push origin main
```

> ⚠️ token 等于密码。**不要**贴到聊天窗口、不要提交进仓库、不要截图分享。
> 泄露了就立刻去 https://github.com/settings/tokens 删掉它。

---

## 四、常见操作速查

| 我想… | 命令 |
|---|---|
| 看改了什么 | `git status` / `git diff` |
| 看历史提交 | `git log --oneline` |
| 提交并推送（一键） | `.\gh-update.ps1 -Message "..."` |
| 只推送（已提交过） | `.\gh-update.ps1` |
| 撤销还没提交的改动 | `git checkout -- <文件>` |
| 看线上和本地是否一致 | `git fetch origin main` 然后比较 `git rev-parse HEAD` 与 `git rev-parse origin/main` |
| 把线上改动拉回来 | `git pull origin main` |

---

## 五、这个仓库当前状态

| 项目 | 值 |
|---|---|
| 线上地址 | https://github.com/cewckm/xhs-search |
| 可见性 | 公开（Public） |
| 默认分支 | `main` |
| 提交身份 | `xhs-search <xhs-search@users.noreply.github.com>`（只在本仓库内设置，未改你的全局 git 配置） |
| 忽略规则 | 见 `.gitignore`（排除知识库、报告、token、辅助脚本等本地文件） |

---

## 六、更新 DSH 里的插件

插件是**引用**这个文件夹的（技能正文与脚本用绝对路径指过来），所以：

- **改了 `skill/SKILL.md` 或 `scripts/` 里的东西** → 推到 GitHub 后，本地 DSH **无需重装**，
  下次会话加载技能时就会读到新内容（技能正文每次加载都会重新读取）。
- **改了 `plugin/index.js` 或 `plugin/package.json`** → 需要重跑安装并重启 DSH：

```powershell
cd "C:\Users\32464\Desktop\skill-dsh\search\plugin"
node install.mjs
# 然后完全退出 DSH（含托盘图标）再打开
```
