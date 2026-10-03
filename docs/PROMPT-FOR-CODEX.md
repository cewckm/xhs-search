# 给 Codex 的提示词（直接复制粘贴）

下面整段粘给 Codex 即可。它包含了所有需要的上下文，Codex 不需要再问我。

---

```
任务：把一个已经提交好的本地 git 仓库推送到 GitHub。

仓库信息
- 本地路径：C:\Users\32464\Desktop\skill-dsh\search
- 远端：https://github.com/cewckm/xhs-search.git
- 远端当前在：b1ee8f1（第一个提交）
- 本地 HEAD 在：b71ca63（比远端多 2 个提交：6605d87、b71ca63）
- 请把本地 main 推到远端 main，推完确认两边一致。

需要推送的 2 个提交内容
- 6605d87：.gitignore 更新
- b71ca63：加入 GitHub 发布工具链（scripts/launch-gh.mjs、gh-pat.mjs、gh-push.mjs、
  gh-update.ps1、gh-upload.ps1）与 docs/GITHUB.md，并在 skill/SKILL.md 补充命令表

⚠️ 已知的坑（请先读，能省很多时间）

1) 本机 git 推送端点疑似被网络阻断
   - https://github.com 网页：时通时不通
   - https://api.github.com：稳定可达
   - git 的数据端点 https://github.com/cewckm/xhs-search.git/info/refs?service=git-receive-pack
     连续 5 次全部超时（curl 与 git 同时失败，都是 libcurl）
   - 连 gitlab.com、gitee.com 的 git 端点是正常的
   所以如果 git push 超时（约 21 秒后报 "Failed to connect ... port 443"），
   大概率不是你操作错，而是这条路径不通。请先跑一次下面的探测确认：
       curl.exe -sS -o NUL -w "%{http_code} %{time_total}\n" --max-time 15 "https://github.com/cewckm/xhs-search.git/info/refs?service=git-receive-pack"

2) 本机装了 Git Credential Manager（系统级 credential.helper=manager）
   推送时它会弹出 "Connect to GitHub" 图形窗口并卡住进程。
   如果只是要测试，先运行 `git config --system --get credential.helper` 看是不是 manager。
   要绕开它，推送时加 -c credential.helper= 并自己提供凭据。

3) 不要使用 URL 里内嵌凭据 + 301 重定向的组合
   https://www.github.com 会 301 到 https://github.com，git 会丢掉 URL 里的用户名密码，
   报 "No anonymous write access"。如果要用 www.github.com，请改用请求头传认证：
       -c "http.extraHeader=Authorization: Basic <base64(用户名:token)>"

认证方式（二选一，你决定）

A) 用现成的 token（推荐，最省事）
   我这边可以按需生成一个临时 token 文件。如果你需要，请告诉我，我让用户生成后把内容给你。
   （用户是 GitHub 新手，token 只能由他本人创建）

B) 让用户配合认证
   提示用户在弹出的窗口里登录，或者提供 Personal Access Token。
   注意 token 需要 repo 权限（推送用）。

成功标准
1) git push 成功（或报告明确的、可复现的失败原因）
2) git fetch origin main 后，git rev-parse HEAD 与 git rev-parse origin/main 相等
3) git ls-tree -r --name-only origin/main 能列出 36 个左右的文件，包含：
   docs/GITHUB.md、scripts/gh-update.ps1、scripts/launch-gh.mjs、scripts/gh-pat.mjs、scripts/gh-push.mjs

失败时请报告
- 具体哪一步失败、完整错误信息
- 探测命令的输出（HTTP 码与耗时）
- 你的出口网络与我这台机器是否不同（例如是否走了代理/VPN）

安全要求
- 不要把我给你的 token 写进任何会被提交的文件
- 不要把 token 打印到日志里
- 推送完成后，删除临时的 token 文件与任何 ~/.git-credentials
```
