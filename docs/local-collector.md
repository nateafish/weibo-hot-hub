# macOS 本地主采集器

本方案采用“macOS `launchd` 本地主采集 + GitHub Actions 延迟兜底”。本机不注册 self-hosted runner，也不使用代理池。采集请求直接从专用 Chrome 的登录上下文读取 Cookie，并只通过子进程内存环境传递；Cookie 不写入代码、配置、日志或 Git。Chrome 自身会在专用 Profile 中保存正常的浏览器登录态。

## 工作方式

- 专用 Chrome Profile 只为本项目使用，CDP 固定监听 `127.0.0.1:9223`。脚本会在读取 Cookie 前检查监听地址，发现对外监听立即停止。
- `launchd` 每小时在 08、23、38、53 分唤醒检查；程序内部再随机等待 20–180 秒。
- `caffeinate -ims` 覆盖整个检查和采集过程，电池供电时也会阻止空闲系统睡眠。
- 本地使用非阻塞进程锁，并按北京时间小时检查远端 hotlist 和 run 文件。实际采集在临时 Git worktree 中进行，不会动主工作区的未跟踪文件。
- 开始前验证 PC 热搜页和移动端 `/api/config` 登录；失效会停止、发 macOS 通知，并让 42/57 分的云端 Watchdog 兜底。
- 本地开始时在当前远端提交写入带北京时间的 Commit Status 租约，长任务每 5 分钟续租，结束后更新为 success 或 failure。
- 采集后验证 hotlist、run、再次验证两端登录，并检查 metrics/posts/AI 成功率。报告中出现 403、429、432、登录跳转或超时会判为失败。
- 推送前会两次重新读取 `origin/main` 的当前小时快照。云端已完成时丢弃本地结果；推送永不使用 force。
- 正常 push 触发现有 Pages 工作流。本地会等待工作流成功，再验证线上 `site-data/manifest.json` 与首页。

这套浏览器状态复用方式参考了 MediaCrawler 的设计思路：由用户在真实浏览器中完成登录，后续从同一浏览器上下文读取最新 Cookie；实现为本项目独立编写，没有复制其源码。

## 首次安装与登录

要求：Apple Silicon macOS、Google Chrome、`uv`、`gh`、`git`，且 `gh auth status` 有效。仓库应为 `nateafish/weibo-hot-hub` 的可推送检出。

```bash
scripts/install-local-collector.sh
```

安装器会安装 Python 环境、生成并加载 `~/Library/LaunchAgents/com.nateafish.weibo-hot-hub.local-collector.plist`，然后打开专用 Chrome。请在打开的两个页面中分别登录：

1. `https://s.weibo.com/top/summary`
2. `https://m.weibo.cn/`

登录后验证：

```bash
scripts/local-collector check-login
```

不要使用普通 Chrome Profile 启动 CDP，也不要把 9223 端口绑定到局域网地址。

## 启动、停止和测试

立即运行一次（跳过 20–180 秒随机等待）：

```bash
scripts/local-collector run-now
```

运行一个不写租约、不提交、不推送的单话题小范围测试：

```bash
scripts/local-collector smoke
```

启动或重新启用定时任务：

```bash
scripts/local-collector start
```

停止本地采集但保留配置和登录态：

```bash
scripts/local-collector stop
```

查看状态：

```bash
scripts/local-collector status
```

持续查看日志：

```bash
scripts/local-collector logs
```

## 重新登录

```bash
scripts/local-collector stop
scripts/local-collector relogin
scripts/local-collector check-login
scripts/local-collector start
```

`relogin` 会重新打开同一个专用 Profile，因此网站正常刷新 Cookie 后，下一次采集会自动使用新状态。无需复制 Cookie，也不要把 Cookie 粘贴到终端、配置或 GitHub Secret。

## 卸载

只卸载 launchd 任务，保留 Profile 与日志：

```bash
scripts/uninstall-local-collector.sh
```

彻底卸载并清除专用 Profile、状态和日志：

```bash
scripts/uninstall-local-collector.sh --purge
```

彻底卸载使用可恢复的“移到废纸篓”，不会删除仓库或仓库中的未跟踪文件。

## 验收建议

小范围验收使用 `smoke`；它在受限临时目录采集一个话题并立即清理。完整小时验收使用 `run-now` 的默认 `max_topics=0`。验收后检查：

```bash
git status --short
git log -1 --oneline
gh run list --workflow deploy-pages.yml --limit 3
```

期望结果是主工作区无采集残留、同一北京时间小时只有一个 hotlist/run 组合、普通 fast-forward push 成功、Pages 成功且线上 manifest 指向该小时。可用下面的扫描确认版本库和日志没有 Cookie 字段值；命令只检查字段名，不打印疑似值：

```bash
git grep -nE '(WEIBO_COOKIE|WEIBO_MOBILE_COOKIE)=[^$]' -- ':!docs/local-collector.md'
grep -RIlE '(Cookie|Set-Cookie):[[:space:]]*[^[]' "$HOME/Library/Logs/weibo-hot-hub" || true
```
