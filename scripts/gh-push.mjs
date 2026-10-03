// gh-push.mjs — 用已保存的 token 创建仓库并推送，然后立即删除 token 文件。
//
//   node gh-push.mjs [repoName] [--private]
//
// 安全约定：
//   · token 只从 _token.txt 读，绝不打印到控制台
//   · 推送用的 URL 里内嵌 token，但只出现在子进程参数中，不写入任何文件
//   · 成功后删除 _token.txt
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONFIG } from './config.mjs';

const TOKEN_FILE = join(CONFIG.scriptsDir, '_token.txt');
const repoName = process.argv[2] ?? 'xhs-search';
const isPrivate = process.argv.includes('--private');
const REPO_DIR = 'C:/Users/32464/Desktop/skill-dsh/search';

if (!existsSync(TOKEN_FILE)) {
  console.error(`缺少 token 文件: ${TOKEN_FILE}`);
  console.error('先跑: node gh-pat.mjs token');
  process.exit(1);
}
const token = readFileSync(TOKEN_FILE, 'utf8').trim();
if (!/^(ghp_|github_pat_)/.test(token)) {
  console.error('token 格式不对（应以 ghp_ 或 github_pat_ 开头）');
  process.exit(1);
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsh-xhs-search',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { status: res.status, ok: res.ok, json, text };
};

// 1) 我是谁
const me = await api('/user');
if (!me.ok) {
  console.error(`token 无效或权限不足 (HTTP ${me.status}): ${(me.json?.message ?? me.text).slice(0, 120)}`);
  process.exit(1);
}
const login = me.json.login;
const ownerType = me.json.type;
console.log(`账号: ${login} (${ownerType})`);

// 2) 建仓（已存在则复用）
let created = await api('/user/repos', {
  method: 'POST',
  body: JSON.stringify({
    name: repoName,
    description: '小红书笔记搜索技能 for DeepSeek Harness — 用系统级鼠标事件驱动隔离浏览器，抓正文/评论/配图并生成报告',
    private: isPrivate,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    auto_init: false,
  }),
});
if (created.status === 422 && /already exists/i.test(created.text)) {
  console.log(`仓库已存在，复用: ${login}/${repoName}`);
} else if (!created.ok) {
  console.error(`建仓失败 (HTTP ${created.status}): ${(created.json?.message ?? created.text).slice(0, 200)}`);
  if (created.json?.errors) console.error(JSON.stringify(created.json.errors));
  process.exit(1);
} else {
  console.log(`仓库已创建: ${created.json.html_url}  (${created.json.private ? '私有' : '公开'})`);
}

const remote = `https://github.com/${login}/${repoName}.git`;
const authedRemote = `https://x-access-token:${token}@github.com/${login}/${repoName}.git`;

// 3) 推送
const git = (args, opts = {}) => execFileSync('git', args, {
  cwd: REPO_DIR, encoding: 'utf8', stdio: 'pipe', ...opts,
});
try {
  try { git(['remote', 'remove', 'origin']); } catch { /* no remote yet */ }
  git(['remote', 'add', 'origin', remote]);
  console.log('推送中…');
  const out = git(['-c', 'credential.helper=', 'push', '-u', authedRemote, 'main'], { stdio: 'pipe' });
  console.log(String(out).trim() || '推送完成');
} catch (error) {
  const stderr = String(error.stderr ?? error.message);
  console.error('推送失败: ' + stderr.replace(token, '***').split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

// 4) 收尾
try {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const sha = git(['rev-parse', '--short', 'HEAD']).trim();
  const count = git(['ls-files']).trim().split('\n').length;
  console.log(`\n分支 ${branch} · 提交 ${sha} · 文件 ${count} 个`);
} catch { /* diagnostics only */ }

unlinkSync(TOKEN_FILE);
console.log(`已删除 token 文件: ${TOKEN_FILE}`);
console.log(`\n仓库地址: ${remote}`);
console.log('提示: 需要改描述或加 topic 时，直接告诉我。');
