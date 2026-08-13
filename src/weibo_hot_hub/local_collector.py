from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import websocket

from .hotlist import fetch_hotlist, hotlist_client
from .weibo import check_mobile_login, mobile_client


BEIJING = ZoneInfo("Asia/Shanghai")
LEASE_PREFIX = "local-collector/"
SENSITIVE = re.compile(
    r"(?i)(cookie|set-cookie|weibo_cookie|weibo_mobile_cookie)(\s*[:=]\s*)([^\s]+)"
)
FATAL_MARKERS = (
    "403",
    "429",
    "432",
    "login",
    "登录",
    "passport.weibo.com",
    "/visitor/",
    "timeout",
    "timed out",
)


class CollectorError(RuntimeError):
    pass


class LoginInvalid(CollectorError):
    pass


class RemoteAlreadyComplete(CollectorError):
    pass


def redact(value: str) -> str:
    return SENSITIVE.sub(lambda match: match.group(1) + match.group(2) + "[REDACTED]", value)


def log(message: str) -> None:
    stamp = datetime.now(BEIJING).isoformat(timespec="seconds")
    print(f"[{stamp}] {redact(message)}", flush=True)


def hour_key(now: datetime | None = None) -> str:
    return (now or datetime.now(BEIJING)).astimezone(BEIJING).strftime("%Y/%m/%d/%H")


def lease_context(key: str) -> str:
    date, hour = key.rsplit("/", 1)
    return LEASE_PREFIX + date.replace("/", "-") + "T" + hour + "+08:00"


def archive_paths(key: str) -> tuple[str, str]:
    return f"data/hotlists/{key}.json", f"data/runs/{key}.json"


def _run(
    args: list[str],
    *,
    cwd: Path,
    check: bool = True,
    env: dict[str, str] | None = None,
    timeout: float | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        args,
        cwd=cwd,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        timeout=timeout,
    )
    if check and completed.returncode:
        detail = redact((completed.stderr or completed.stdout).strip())[-1000:]
        raise CollectorError(f"{args[0]} failed ({completed.returncode}): {detail}")
    return completed


def repository_name(repo_root: Path) -> str:
    value = _run(["git", "remote", "get-url", "origin"], cwd=repo_root).stdout.strip()
    match = re.search(r"github\.com[/:]([^/]+/[^/]+?)(?:\.git)?$", value)
    if not match:
        raise CollectorError("origin is not a GitHub repository")
    return match.group(1)


def _domain_matches(cookie_domain: str, host: str) -> bool:
    domain = cookie_domain.lstrip(".").lower()
    host = host.lower()
    return host == domain or host.endswith("." + domain)


def cookie_header(cookies: Iterable[dict[str, Any]], host: str) -> str:
    now = time.time()
    eligible = [
        item
        for item in cookies
        if item.get("name")
        and _domain_matches(str(item.get("domain") or ""), host)
        and (not item.get("expires") or float(item["expires"]) > now)
    ]
    eligible.sort(key=lambda item: len(str(item.get("path") or "/")), reverse=True)
    return "; ".join(f"{item['name']}={item.get('value', '')}" for item in eligible)


class CdpCookies:
    def __init__(self, host: str = "127.0.0.1", port: int = 9223) -> None:
        if host not in {"127.0.0.1", "localhost", "::1"}:
            raise CollectorError("CDP host must be loopback")
        self.host = host
        self.port = port

    def _version(self) -> dict[str, Any]:
        url = f"http://{self.host}:{self.port}/json/version"
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                return json.load(response)
        except Exception as exc:
            raise CollectorError(
                "dedicated Chrome CDP is unavailable; run scripts/local-collector login"
            ) from exc

    def verify_loopback_listener(self) -> None:
        lsof = shutil.which("lsof") or "/usr/sbin/lsof"
        completed = subprocess.run(
            [lsof, "-nP", f"-iTCP:{self.port}", "-sTCP:LISTEN"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        lines = completed.stdout.splitlines()[1:]
        if not lines:
            raise CollectorError(f"nothing is listening on CDP port {self.port}")
        addresses = [line.split()[-2] for line in lines if len(line.split()) >= 9]
        if any(
            not (address.startswith("127.0.0.1:") or address.startswith("[::1]:"))
            for address in addresses
        ):
            raise CollectorError("CDP port is not restricted to 127.0.0.1/::1")

    def read(self) -> tuple[str, str]:
        self.verify_loopback_listener()
        endpoint = str(self._version().get("webSocketDebuggerUrl") or "")
        parsed = urlparse(endpoint)
        if parsed.scheme not in {"ws", "wss"} or parsed.hostname not in {
            "127.0.0.1",
            "localhost",
            "::1",
        }:
            raise CollectorError("Chrome returned a non-loopback CDP WebSocket URL")
        ws = websocket.create_connection(endpoint, timeout=5, origin=f"http://{self.host}:{self.port}")
        try:
            ws.send(json.dumps({"id": 1, "method": "Storage.getCookies"}))
            while True:
                payload = json.loads(ws.recv())
                if payload.get("id") == 1:
                    break
            if payload.get("error"):
                raise CollectorError(f"CDP Storage.getCookies failed: {payload['error'].get('message')}")
            cookies = payload.get("result", {}).get("cookies", [])
        finally:
            ws.close()
        pc = cookie_header(cookies, "s.weibo.com")
        mobile = cookie_header(cookies, "m.weibo.cn")
        if not pc or not mobile:
            raise LoginInvalid("dedicated Chrome profile has no PC or mobile Weibo cookies")
        return pc, mobile


def validate_login(pc_cookie: str, mobile_cookie: str) -> dict[str, Any]:
    try:
        with hotlist_client(pc_cookie) as http:
            count = len(fetch_hotlist(http))
    except Exception as exc:
        raise LoginInvalid(f"PC login check failed: {type(exc).__name__}: {exc}") from exc
    try:
        with mobile_client(mobile_cookie) as http:
            mobile_ok = check_mobile_login(http)
    except Exception as exc:
        raise LoginInvalid(f"mobile login check failed: {type(exc).__name__}: {exc}") from exc
    if not mobile_ok:
        raise LoginInvalid("mobile /api/config reports login=false")
    return {"pc_hotlist_count": count, "mobile_login": True}


def notify(title: str, message: str) -> None:
    subprocess.run(
        [
            "/usr/bin/osascript",
            "-e",
            "on run argv",
            "-e",
            "display notification (item 2 of argv) with title (item 1 of argv)",
            "-e",
            "end run",
            title,
            message,
        ],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


@dataclass
class Config:
    repo_root: Path
    cdp_port: int = 9223
    pages: int = 1
    max_topics: int = 0
    jitter: bool = True
    min_metrics_rate: float = 0.70
    min_posts_rate: float = 0.70
    min_ai_rate: float = 0.50
    heartbeat_seconds: int = 300
    collection_timeout: int = 4 * 60 * 60
    pages_timeout: int = 20 * 60

    @property
    def state_root(self) -> Path:
        return Path.home() / "Library/Application Support/weibo-hot-hub"

    @property
    def lock_path(self) -> Path:
        return self.state_root / "collector.lock"


def remote_complete(repo_root: Path, key: str, *, fetch: bool = True) -> bool:
    if fetch:
        _run(["git", "fetch", "--quiet", "origin", "main"], cwd=repo_root)
    return all(
        _run(["git", "cat-file", "-e", f"origin/main:{path}"], cwd=repo_root, check=False).returncode
        == 0
        for path in archive_paths(key)
    )


def cloud_archive_active(repo_root: Path, repo: str) -> bool:
    result = _run(
        [
            "gh",
            "run",
            "list",
            "--repo",
            repo,
            "--workflow",
            "hourly.yml",
            "--limit",
            "20",
            "--json",
            "status",
        ],
        cwd=repo_root,
    )
    return any(item.get("status") != "completed" for item in json.loads(result.stdout or "[]"))


class CommitLease:
    def __init__(self, repo_root: Path, repo: str, sha: str, context: str) -> None:
        self.repo_root = repo_root
        self.repo = repo
        self.sha = sha
        self.context = context

    def update(self, state: str, detail: str) -> None:
        stamp = datetime.now(BEIJING).isoformat(timespec="seconds")
        description = f"{detail}; {stamp}"[:140]
        _run(
            [
                "gh",
                "api",
                "--method",
                "POST",
                f"repos/{self.repo}/statuses/{self.sha}",
                "-f",
                f"state={state}",
                "-f",
                f"context={self.context}",
                "-f",
                f"description={description}",
            ],
            cwd=self.repo_root,
        )


def _run_collector(
    worktree: Path,
    config: Config,
    pc_cookie: str,
    mobile_cookie: str,
    lease: CommitLease,
) -> None:
    env = os.environ.copy()
    env["WEIBO_COOKIE"] = pc_cookie
    env["WEIBO_MOBILE_COOKIE"] = mobile_cookie
    env["PYTHONPATH"] = str(worktree / "src")
    command = [
        sys.executable,
        "-m",
        "weibo_hot_hub.hourly",
        "--pages",
        str(config.pages),
        "--max-topics",
        str(config.max_topics),
    ]
    process = subprocess.Popen(
        command,
        cwd=worktree,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    started = time.monotonic()
    heartbeat = started + config.heartbeat_seconds
    while process.poll() is None:
        time.sleep(min(5, config.heartbeat_seconds))
        now = time.monotonic()
        if now - started > config.collection_timeout:
            process.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=10)
            if process.poll() is None:
                process.kill()
            raise CollectorError("hourly collector timed out")
        if now >= heartbeat:
            lease.update("pending", "macOS collector lease heartbeat")
            heartbeat = now + config.heartbeat_seconds
    stdout, stderr = process.communicate()
    if stdout.strip():
        log("collector summary: " + stdout.strip()[-500:])
    if process.returncode:
        raise CollectorError(
            f"hourly collector exited {process.returncode}: {redact(stderr.strip())[-1000:]}"
        )


def smoke(config: Config) -> int:
    os.umask(0o077)
    with process_lock(config.lock_path):
        pc_cookie, mobile_cookie = CdpCookies(port=config.cdp_port).read()
        login = validate_login(pc_cookie, mobile_cookie)
        key = hour_key()
        temp_root = Path(tempfile.mkdtemp(prefix="weibo-hot-hub-smoke-"))
        try:
            env = os.environ.copy()
            env["WEIBO_COOKIE"] = pc_cookie
            env["WEIBO_MOBILE_COOKIE"] = mobile_cookie
            env["PYTHONPATH"] = str(config.repo_root / "src")
            result = _run(
                [
                    sys.executable,
                    "-m",
                    "weibo_hot_hub.hourly",
                    "--data-root",
                    str(temp_root / "data"),
                    "--pages",
                    "1",
                    "--max-topics",
                    "1",
                ],
                cwd=config.repo_root,
                env=env,
                timeout=20 * 60,
            )
            if result.stdout.strip():
                log("smoke summary: " + result.stdout.strip()[-500:])
            validate_login(pc_cookie, mobile_cookie)
            report = validate_outputs(
                temp_root,
                key,
                min_metrics_rate=1.0,
                min_posts_rate=1.0,
                min_ai_rate=1.0,
            )
            log(
                f"smoke passed: pc_hotlist={login['pc_hotlist_count']} "
                f"metrics={report['metrics']:.0%} posts={report['posts']:.0%} ai={report['ai']:.0%}"
            )
            return 0
        finally:
            pc_cookie = ""
            mobile_cookie = ""
            shutil.rmtree(temp_root, ignore_errors=True)


def _rate(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def validate_outputs(
    worktree: Path,
    key: str,
    *,
    min_metrics_rate: float,
    min_posts_rate: float,
    min_ai_rate: float,
) -> dict[str, Any]:
    hotlist_path, run_path = [worktree / path for path in archive_paths(key)]
    if not hotlist_path.is_file() or not run_path.is_file():
        raise CollectorError("hotlist or run record is missing")
    hotlist = json.loads(hotlist_path.read_text())
    report = json.loads(run_path.read_text())
    if hotlist.get("count", 0) < 10 or len(hotlist.get("topics", [])) < 10:
        raise CollectorError("hotlist validation failed: fewer than 10 topics")
    topics = report.get("topics") or []
    selected = int(report.get("selected_count") or 0)
    if not topics or len(topics) != selected:
        raise CollectorError("run validation failed: topic count mismatch")
    metrics = sum(item.get("metrics") == "saved" for item in topics)
    posts = sum(item.get("posts") == "saved" for item in topics)
    ai = sum(item.get("ai") in {"saved", "unchanged", "refused"} for item in topics)
    rates = {
        "metrics": _rate(metrics, selected),
        "posts": _rate(posts, selected),
        "ai": _rate(ai, selected),
    }
    thresholds = {
        "metrics": min_metrics_rate,
        "posts": min_posts_rate,
        "ai": min_ai_rate,
    }
    failures = "\n".join(
        str(value)
        for item in topics
        for key_name, value in item.items()
        if key_name.endswith("_error")
    ).lower()
    marker = next((item for item in FATAL_MARKERS if item in failures), None)
    if marker:
        raise CollectorError(f"fatal upstream signal detected in run report: {marker}")
    below = [name for name, value in rates.items() if value < thresholds[name]]
    if below:
        rendered = ", ".join(f"{name}={rates[name]:.0%}" for name in below)
        raise CollectorError(f"success-rate validation failed: {rendered}")
    return {"hotlist": hotlist["count"], "selected": selected, **rates}


def _changed_paths(worktree: Path) -> list[str]:
    output = _run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=worktree
    ).stdout
    return [line[3:] for line in output.splitlines() if len(line) > 3]


def _commit_and_push(worktree: Path, repo_root: Path, key: str) -> str:
    unexpected = [
        path
        for path in _changed_paths(worktree)
        if not (path == "README.md" or path.startswith("data/"))
    ]
    if unexpected:
        raise CollectorError(f"collector changed unexpected paths: {', '.join(unexpected[:5])}")
    _run(["git", "add", "data", "README.md"], cwd=worktree)
    _run(
        [
            "git",
            "-c",
            "user.name=weibo-hot-hub local collector",
            "-c",
            "user.email=local-collector@users.noreply.github.com",
            "commit",
            "-m",
            f"data: hourly archive {key.replace('/', '-')}",
        ],
        cwd=worktree,
    )
    _run(["git", "fetch", "--quiet", "origin", "main"], cwd=worktree)
    if remote_complete(worktree, key, fetch=False):
        raise RemoteAlreadyComplete("remote completed this hour while local collection ran")
    _run(["git", "rebase", "origin/main"], cwd=worktree)
    _run(["git", "fetch", "--quiet", "origin", "main"], cwd=worktree)
    if remote_complete(worktree, key, fetch=False):
        raise RemoteAlreadyComplete("remote completed this hour before local push")
    _run(["git", "push", "origin", "HEAD:main"], cwd=worktree)
    return _run(["git", "rev-parse", "HEAD"], cwd=worktree).stdout.strip()


def verify_pages(config: Config, repo: str, sha: str, key: str) -> None:
    deadline = time.monotonic() + config.pages_timeout
    run_id = ""
    while time.monotonic() < deadline:
        result = _run(
            [
                "gh",
                "run",
                "list",
                "--repo",
                repo,
                "--workflow",
                "deploy-pages.yml",
                "--commit",
                sha,
                "--limit",
                "1",
                "--json",
                "databaseId,status,conclusion",
            ],
            cwd=config.repo_root,
            check=False,
        )
        if result.returncode == 0:
            rows = json.loads(result.stdout or "[]")
            if rows:
                run_id = str(rows[0]["databaseId"])
                if rows[0]["status"] == "completed":
                    if rows[0]["conclusion"] != "success":
                        raise CollectorError(f"Pages workflow {run_id} did not succeed")
                    break
        time.sleep(15)
    else:
        raise CollectorError("timed out waiting for Pages workflow")

    owner, name = repo.split("/", 1)
    base = f"https://{owner.lower()}.github.io/{name}/"
    expected_date, expected_hour = key.rsplit("/", 1)[0].replace("/", "-"), key.rsplit("/", 1)[1]
    last_error = ""
    while time.monotonic() < deadline:
        try:
            manifest_response = httpx.get(base + "site-data/manifest.json", timeout=15)
            home_response = httpx.get(base, timeout=15)
            manifest_response.raise_for_status()
            home_response.raise_for_status()
            manifest = manifest_response.json()
            if (
                manifest.get("latest_date") == expected_date
                and str(manifest.get("latest_hour")).zfill(2) == expected_hour
                and home_response.text.strip()
            ):
                log(f"Pages verified: workflow={run_id} manifest={expected_date}T{expected_hour}")
                return
            last_error = "manifest has not reached the collected hour"
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
        time.sleep(15)
    raise CollectorError(f"Pages verification timed out: {last_error}")


@contextlib.contextmanager
def process_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    handle = path.open("a+")
    os.chmod(path, 0o600)
    try:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise CollectorError("another local collector process holds the lock") from exc
        yield
    finally:
        fcntl.flock(handle, fcntl.LOCK_UN)
        handle.close()


def collect(config: Config) -> int:
    os.umask(0o077)
    with process_lock(config.lock_path):
        if config.jitter:
            delay = random.randint(20, 180)
            log(f"schedule jitter: {delay}s")
            time.sleep(delay)
        key = hour_key()
        log(f"checking Beijing hour {key}")
        if remote_complete(config.repo_root, key):
            log("remote hour is already complete; nothing to do")
            return 0

        repo = repository_name(config.repo_root)
        if cloud_archive_active(config.repo_root, repo):
            log("Hourly Archive is already queued or running; cloud owns this hour")
            return 0
        base_sha = _run(["git", "rev-parse", "origin/main"], cwd=config.repo_root).stdout.strip()
        lease = CommitLease(config.repo_root, repo, base_sha, lease_context(key))
        lease.update("pending", "macOS collector lease started")
        temp_root = Path(tempfile.mkdtemp(prefix="weibo-hot-hub-"))
        worktree = temp_root / "repo"
        added = False
        pc_cookie = ""
        mobile_cookie = ""
        try:
            cdp = CdpCookies(port=config.cdp_port)
            pc_cookie, mobile_cookie = cdp.read()
            login = validate_login(pc_cookie, mobile_cookie)
            log(f"login valid: pc_hotlist={login['pc_hotlist_count']} mobile=true")
            _run(["git", "worktree", "add", "--detach", str(worktree), "origin/main"], cwd=config.repo_root)
            added = True
            _run_collector(worktree, config, pc_cookie, mobile_cookie, lease)
            validate_login(pc_cookie, mobile_cookie)
            report = validate_outputs(
                worktree,
                key,
                min_metrics_rate=config.min_metrics_rate,
                min_posts_rate=config.min_posts_rate,
                min_ai_rate=config.min_ai_rate,
            )
            log(
                "output valid: "
                f"hotlist={report['hotlist']} metrics={report['metrics']:.0%} "
                f"posts={report['posts']:.0%} ai={report['ai']:.0%}"
            )
            try:
                sha = _commit_and_push(worktree, config.repo_root, key)
            except RemoteAlreadyComplete as exc:
                lease.update("success", "remote archive won race; local discarded")
                log(str(exc))
                return 0
            verify_pages(config, repo, sha, key)
            lease.update("success", "local archive pushed and Pages verified")
            notify("微博本地采集成功", f"北京时间 {key} 已归档并发布")
            return 0
        except LoginInvalid:
            with contextlib.suppress(Exception):
                lease.update("failure", "local collector failed: LoginInvalid")
            raise
        except Exception as exc:
            with contextlib.suppress(Exception):
                lease.update("failure", f"local collector failed: {type(exc).__name__}")
            notify("微博本地采集已停止", "登录或采集验收失败，云端稍后兜底")
            raise
        finally:
            pc_cookie = ""
            mobile_cookie = ""
            if added:
                _run(
                    ["git", "worktree", "remove", "--force", str(worktree)],
                    cwd=config.repo_root,
                    check=False,
                )
            shutil.rmtree(temp_root, ignore_errors=True)


def status(config: Config) -> int:
    print(f"repo={config.repo_root}")
    print(f"hour={hour_key()}")
    print(f"cdp=http://127.0.0.1:{config.cdp_port}")
    try:
        CdpCookies(port=config.cdp_port).verify_loopback_listener()
        print("cdp_listener=loopback")
    except Exception as exc:
        print(f"cdp_listener=unavailable ({exc})")
    try:
        complete = remote_complete(config.repo_root, hour_key())
        print(f"remote_current_hour={'complete' if complete else 'missing'}")
    except Exception as exc:
        print(f"remote_current_hour=unknown ({redact(str(exc))})")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="macOS CDP-backed local collector")
    parser.add_argument(
        "command",
        choices=("run", "smoke", "check-login", "status"),
        nargs="?",
        default="run",
    )
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--cdp-port", type=int, default=int(os.environ.get("WEIBO_CDP_PORT", "9223")))
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--max-topics", type=int, default=0)
    parser.add_argument("--no-jitter", action="store_true")
    args = parser.parse_args()
    config = Config(
        repo_root=args.repo_root.resolve(),
        cdp_port=args.cdp_port,
        pages=args.pages,
        max_topics=args.max_topics,
        jitter=not args.no_jitter,
    )
    try:
        if args.command == "status":
            raise SystemExit(status(config))
        if args.command == "check-login":
            pc, mobile = CdpCookies(port=config.cdp_port).read()
            result = validate_login(pc, mobile)
            print(f"pc=valid hotlist={result['pc_hotlist_count']} mobile=valid")
            return
        if args.command == "smoke":
            raise SystemExit(smoke(config))
        raise SystemExit(collect(config))
    except LoginInvalid as exc:
        notify("微博登录已失效", "请重新登录专用 Chrome；本地采集已停止，云端稍后兜底")
        log(str(exc))
        raise SystemExit(3) from exc
    except CollectorError as exc:
        log(str(exc))
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
