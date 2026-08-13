# macOS Cookie 同步器

本机只负责维护微博登录态，不执行小时采集。完整的 hotlist、metrics、posts 和 AI 采集全部由 GitHub Actions 完成，因此不会持续占用本机 CPU、网络或电池。

## 工作方式

- 使用独立 Chrome Profile，CDP 只监听 `127.0.0.1:9223`。
- `launchd` 每天北京时间 07:05 静默运行一次；电脑当时休眠时，macOS 会在之后唤醒时补运行。
- 从 Chrome 浏览器上下文读取 PC 和移动端 Cookie，先验证两端登录，再更新仓库的 `WEIBO_COOKIE` 与 `WEIBO_MOBILE_COOKIE` GitHub Secrets。
- Cookie 只通过内存和 `gh secret set` 的标准输入传递，不出现在命令参数、代码、plist、日志或 Git 历史中。GitHub 只保存加密 Secret。
- 同步成功保持静默；登录失效、Chrome 未运行或上传失败时发送 macOS 通知，云端继续使用上次成功同步的 Secret。
- 云端 Watchdog 每小时在 12、27、42、57 分检查。当前小时缺失且没有运行中的 Hourly Archive 时，自动派发完整云端采集。

浏览器状态复用方式参考了 MediaCrawler 的设计思路：用户在真实浏览器中登录，后续从同一浏览器上下文读取更新后的 Cookie；本项目为独立实现，没有复制其源码。

## 安装与首次登录

```bash
scripts/install-local-collector.sh
```

在打开的专用 Chrome 中分别登录：

1. `https://s.weibo.com/top/summary`
2. `https://m.weibo.cn/`

然后验证并立即同步一次：

```bash
scripts/local-collector check-login
scripts/local-collector sync-now
```

## 常用命令

```bash
# 立即刷新 GitHub Cookie Secrets，不执行采集
scripts/local-collector sync-now

# 启用每日同步；会立即同步一次
scripts/local-collector start

# 停止每日同步，保留登录态和配置
scripts/local-collector stop

# 查看状态或日志
scripts/local-collector status
scripts/local-collector logs

# 重新打开可见的专用 Chrome 登录窗口
scripts/local-collector relogin
scripts/local-collector check-login
scripts/local-collector sync-now
```

## 卸载

只卸载 launchd 任务，保留专用 Profile 与日志：

```bash
scripts/uninstall-local-collector.sh
```

彻底卸载并把 Profile、状态和日志移到废纸篓：

```bash
scripts/uninstall-local-collector.sh --purge
```
