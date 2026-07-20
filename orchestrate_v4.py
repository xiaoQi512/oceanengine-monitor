"""
多 Agent 协作流水线 v4 (跨项目通用版)

修复 v3 的 9 个跨项目问题:
- worktree 放项目内 .worktrees/ (沙箱不拦)
- 自适应项目类型 (Python/Node/其他)
- 纯 ASCII 输出 (GBK 终端不崩)
- opencode.cmd 绝对路径 (PATH 不依赖)
- 日志写文件 UTF-8

用法(任意项目目录):
  python orchestrate_v4.py all "任务描述"
  python orchestrate_v4.py prepare "任务描述"
  python orchestrate_v4.py plan task-1
  python orchestrate_v4.py code task-1
  python orchestrate_v4.py review task-1
  python orchestrate_v4.py test task-1
  python orchestrate_v4.py deliver task-1
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# ============================================================
# 配置 (自适应)
# ============================================================

PROJECT_ROOT = Path.cwd().resolve()
WORKTREES_DIR = PROJECT_ROOT / ".worktrees"
REPORTS_DIR = PROJECT_ROOT / "reports"
LOG_FILE = PROJECT_ROOT / ".ma-pipeline.log"

PYTHON = r"C:\Users\HTF2026\.workbuddy\binaries\python\versions\3.13.12\python.exe"
OPENCODE_BIN = r"C:\Users\HTF2026\AppData\Roaming\npm\opencode.cmd"
OPENCODE_TIMEOUT = 900  # 15 分钟

PROMPTS_DIR = Path(__file__).parent / "prompts" if (Path(__file__).parent / "prompts").exists() else PROJECT_ROOT / "prompts"

COMMIT_PATTERN = re.compile(r"^(feat|fix|refactor|test|docs|chore)(\([\w-]+\))?:\s+.+")

# 模型路由 (V5 测试 + 3 模型全火山方舟)
MODEL_ROUTING = {
    "stage_0_pm":              "volcengine-plan/glm-5.2",
    "stage_1_architect":       "volcengine-plan/deepseek-v4-pro",
    "stage_1_reviewer_a":      "volcengine-plan/minimax-m3",
    "stage_1_revise":          "volcengine-plan/deepseek-v4-pro",
    "stage_2_coder":           "volcengine-plan/deepseek-v4-pro",
    "stage_2_debug_upgrade":   "volcengine-plan/minimax-m3",
    "stage_2_self_review":     "volcengine-plan/minimax-m3",
    "stage_3_reviewer_quality":"volcengine-plan/minimax-m3",
    "stage_3_reviewer_arch":   "volcengine-plan/deepseek-v4-pro",
    "stage_4_tester":          "volcengine-plan/minimax-m3",
    "stage_4_documenter":      "volcengine-plan/minimax-m3",
    "stage_5_release":         "volcengine-plan/glm-5.2",
}


# ============================================================
# 日志 (UTF-8 文件 + ASCII stdout)
# ============================================================

def log(msg: str, file: bool = True, stdout: bool = True):
    """双通道日志: stdout 纯 ASCII, 文件 UTF-8"""
    if stdout:
        # 替换 emoji 为 ASCII 标记
        ascii_msg = msg.replace("[OK]", "[OK]").replace("[FAIL]", "[FAIL]")
        for emoji, tag in [("✅","[OK]"), ("❌","[FAIL]"), ("⚠️","[WARN]"),
                           ("📄","[FILE]"), ("🎉","[DONE]"), ("→","->"),
                           ("🥇",""), ("🥈",""), ("🥉","")]:
            ascii_msg = ascii_msg.replace(emoji, tag)
        # 编码安全输出
        try:
            print(ascii_msg)
        except UnicodeEncodeError:
            print(ascii_msg.encode("ascii", "replace").decode())
    if file:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\n")


def print_header(stage: str, title: str):
    line = "=" * 60
    log(f"\n{line}\n  {stage}: {title}\n  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n{line}")


# ============================================================
# 项目类型自适应
# ============================================================

def detect_project_type() -> str:
    """检测项目类型,返回 'python' / 'node' / 'other'"""
    if (PROJECT_ROOT / "package.json").exists():
        return "node"
    if list(PROJECT_ROOT.glob("*.py")) or (PROJECT_ROOT / "pyproject.toml").exists():
        return "python"
    return "other"


def get_test_command(ptype: str) -> list:
    """根据项目类型返回测试命令"""
    if ptype == "python":
        return [PYTHON, "-m", "pytest", "-v", "--tb=short"]
    if ptype == "node":
        # 优先 npm test, 次选 node --check 关键文件
        if (PROJECT_ROOT / "package.json").exists():
            return ["cmd", "/c", "npm", "test"]
        return ["cmd", "/c", "node", "--check"]
    return ["cmd", "/c", "echo", "no-test"]


def get_worktree_path(task_id: str) -> Path:
    """worktree 放项目内 .worktrees/ 子目录 (沙箱不拦)"""
    return WORKTREES_DIR / f"worktree-{task_id}"


# ============================================================
# Git Worktree
# ============================================================

def run_git(args: list, cwd: Path = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=str(cwd or PROJECT_ROOT),
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )


def parse_tasks(raw: str) -> list:
    parts = re.split(r"\s*[|]{1,2}\s*", raw.strip())
    tasks = []
    for i, part in enumerate(parts, 1):
        part = part.strip()
        if not part:
            continue
        slug = re.sub(r"[^\w-]", "-", part.lower())[:30]
        slug = re.sub(r"-+", "-", slug).strip("-")
        tasks.append({
            "id": f"task-{i}",
            "description": part,
            "branch": f"task-{i}-{slug}",
        })
    return tasks


def generate_task_md(task: dict, ptype: str) -> str:
    test_cmd = "pytest" if ptype == "python" else ("npm test" if ptype == "node" else "echo no-test")
    return f"""# Task: {task['description'][:60]}

## Goal
{task['description']}

## Constraints
- Work in this worktree only
- Commit with: feat(scope): description
- Test command: {test_cmd}
- No debug remnants

## Done when
- [ ] Tests pass
- [ ] Committed to feature/{task['branch']}
- [ ] No conflicts
"""


def cmd_prepare(raw_tasks: str):
    print_header("PREPARE", raw_tasks[:60])
    t0 = time.time()
    tasks = parse_tasks(raw_tasks)
    if not tasks:
        log("[FAIL] No valid tasks")
        return 1

    ptype = detect_project_type()
    log(f"[1/3] Project type: {ptype}, tasks: {len(tasks)}")

    # 确保 git 初始化
    if not (PROJECT_ROOT / ".git").exists():
        log("[1/3] git init...")
        run_git(["init"])
        run_git(["config", "user.email", "ma@local"])
        run_git(["config", "user.name", "MA-Pipeline"])
        # .gitignore
        gi = PROJECT_ROOT / ".gitignore"
        if not gi.exists():
            gi.write_text("\n".join([".worktrees/", "reports/", ".ma-pipeline.log",
                                     "node_modules/", "__pycache__/", "*.pyc",
                                     ".env", ".workbuddy/"]), encoding="utf-8")
        run_git(["add", "-A"])
        run_git(["commit", "-m", "chore: init for ma-pipeline"])
        log("[1/3] git init done")

    WORKTREES_DIR.mkdir(parents=True, exist_ok=True)

    log("[2/3] Create worktrees:")
    for t in tasks:
        wt = get_worktree_path(t["id"])
        if wt.exists():
            log(f"  {t['id']}: exists, skip")
            continue
        r = run_git(["worktree", "add", str(wt), "-b", f"feature/{t['branch']}"])
        if r.returncode != 0:
            log(f"  {t['id']}: [FAIL] {r.stderr.strip()}")
            return 1
        log(f"  {t['id']}: {wt}")

    log("[3/3] Generate TASK.md:")
    for t in tasks:
        wt = get_worktree_path(t["id"])
        (wt / "TASK.md").write_text(generate_task_md(t, ptype), encoding="utf-8")
        log(f"  {t['id']}: TASK.md [OK]")

    log(f"\n[OK] PREPARE done ({time.time()-t0:.1f}s)")
    return 0


# ============================================================
# OpenCode CLI 调用
# ============================================================

def load_prompt(name: str) -> str:
    p = PROMPTS_DIR / f"{name}.md"
    if not p.exists():
        log(f"[WARN] Prompt not found: {p}")
        return ""
    return p.read_text(encoding="utf-8")


def call_opencode(model: str, prompt: str, cwd: Path = None, timeout: int = None) -> str:
    """调用 OpenCode CLI, 返回纯文本"""
    cmd = [OPENCODE_BIN, "run", "-m", model, "--dangerously-skip-permissions"]
    try:
        r = subprocess.run(
            cmd, cwd=str(cwd or PROJECT_ROOT),
            input=prompt,
            capture_output=True, text=True,
            encoding="utf-8", errors="replace",
            timeout=timeout or OPENCODE_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        log(f"  [FAIL] opencode timeout ({timeout or OPENCODE_TIMEOUT}s)")
        return ""
    except FileNotFoundError:
        log(f"  [FAIL] opencode not found: {OPENCODE_BIN}")
        return ""

    if r.returncode != 0:
        log(f"  [FAIL] opencode exit {r.returncode}")
        if r.stderr:
            log(f"  stderr: {r.stderr[:300]}")
        return ""

    # 清理状态行
    lines = []
    for line in r.stdout.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("> build") or s.startswith("! permission") or s.startswith("Error:"):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def ensure_artifacts(wt: Path):
    for sub in ["plan", "code", "review", "test"]:
        (wt / "artifacts" / sub).mkdir(parents=True, exist_ok=True)


def write_artifact(wt: Path, stage: str, name: str, content: str):
    p = wt / "artifacts" / stage / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    log(f"  [FILE] {p.relative_to(wt)}")


def read_artifact(wt: Path, stage: str, name: str) -> str:
    p = wt / "artifacts" / stage / name
    if not p.exists():
        return ""
    return p.read_text(encoding="utf-8")


# ============================================================
# 阶段实现
# ============================================================

def cmd_plan(task_id: str):
    print_header("PLAN", f"task {task_id}")
    t0 = time.time()
    wt = get_worktree_path(task_id)
    if not wt.exists():
        log(f"[FAIL] worktree not found: {wt}")
        log(f"  Run: python {Path(__file__).name} prepare \"task\"")
        return 1

    ensure_artifacts(wt)
    task_md = (wt / "TASK.md").read_text(encoding="utf-8")

    # Stage 0: PM (skip for simple)
    log("\n[0] PM (GLM-5.2)")
    is_complex = len(task_md) > 500
    if is_complex:
        prompt = load_prompt("pm_prd").replace("{task_content}", task_md)
        prd = call_opencode(MODEL_ROUTING["stage_0_pm"], prompt, cwd=wt)
        if prd:
            write_artifact(wt, "plan", "PRD.md", prd)
        else:
            log("  [WARN] PM empty, use TASK.md")
            prd = task_md
    else:
        log("  Simple task, skip PRD")
        prd = task_md

    # Stage 1.1: Architect design v1
    log("\n[1.1] Architect design v1 (DSV4)")
    prompt = load_prompt("architect_design").replace("{prd_content}", prd)
    design_v1 = call_opencode(MODEL_ROUTING["stage_1_architect"], prompt, cwd=wt)
    if not design_v1:
        log("  [FAIL] Architect empty, abort")
        return 1
    write_artifact(wt, "plan", "design-v1.md", design_v1)

    # Stage 1.2: Review (M3)
    log("\n[1.2] Review (M3)")
    prompt = load_prompt("reviewer_dsv4_design").replace("{design_v1}", design_v1)
    review_m3 = call_opencode(MODEL_ROUTING["stage_1_reviewer_a"], prompt, cwd=wt)
    if review_m3:
        write_artifact(wt, "plan", "review-m3.md", review_m3)

    # Stage 1.3: Revise (DSV4)
    log("\n[1.3] Revise (DSV4)")
    prompt = (load_prompt("architect_revise")
              .replace("{design_v1}", design_v1)
              .replace("{review_dsv4}", review_m3 or "(none)"))
    design_final = call_opencode(MODEL_ROUTING["stage_1_revise"], prompt, cwd=wt)
    if not design_final:
        log("  [WARN] Revise empty, use v1")
        design_final = design_v1
    write_artifact(wt, "plan", "design-final.md", design_final)

    log(f"\n[OK] PLAN done ({time.time()-t0:.1f}s)")
    return 0


def cmd_code(task_id: str):
    print_header("CODE", f"task {task_id}")
    t0 = time.time()
    wt = get_worktree_path(task_id)
    design = read_artifact(wt, "plan", "design-final.md")
    if not design:
        log("[FAIL] design-final.md not found, run plan first")
        return 1

    ptype = detect_project_type()
    test_cmd = get_test_command(ptype)
    max_retries = 3
    success = False

    for attempt in range(1, max_retries + 1):
        model_key = "stage_2_coder" if attempt <= 2 else "stage_2_debug_upgrade"
        model = MODEL_ROUTING[model_key]
        log(f"\n[attempt {attempt}/{max_retries}] model: {model}")

        if attempt == 1:
            prompt = load_prompt("engineer_code").replace("{design_final}", design)
        else:
            prev = read_artifact(wt, "code", "debug-log.md")
            prompt = (load_prompt("engineer_debug")
                      .replace("{design_final}", design)
                      .replace("{test_failure}", prev[-2000:]))

        call_opencode(model, prompt, cwd=wt)

        # Run test
        log(f"  Run test ({ptype})...")
        r = subprocess.run(
            test_cmd, cwd=str(wt),
            capture_output=True, text=True,
            encoding="utf-8", errors="replace",
            timeout=120,
        )
        passed = r.stdout.count("passed") + r.stdout.count("PASSED")
        failed = r.stdout.count("failed") + r.stdout.count("FAILED")

        if failed == 0 and (passed > 0 or "no-test" in " ".join(test_cmd)):
            log(f"  [OK] tests pass")
            run_git(["add", "-A"], cwd=wt)
            run_git(["commit", "-m", f"feat({task_id}): implement"], cwd=wt)
            write_artifact(wt, "code", "commits.log", f"attempt {attempt}: feat({task_id}): implement\n")
            success = True
            break
        else:
            log(f"  [FAIL] {passed} passed, {failed} failed")
            write_artifact(wt, "code", "debug-log.md",
                          f"=== Attempt {attempt} ({model}) ===\n{r.stdout[-2000:]}\n{r.stderr[-500:]}")

    if not success:
        log(f"\n[WARN] {max_retries} attempts failed, need manual")
        return 1

    # Self-review (M3, non-blocking)
    log("\n[code-end] Self-review (M3, non-blocking)")
    prompt = load_prompt("self_review")
    sr = call_opencode(MODEL_ROUTING["stage_2_self_review"], prompt, cwd=wt)
    if sr:
        write_artifact(wt, "code", "self-review.md", sr)
        log("  [FILE] self-review.md (non-blocking)")

    log(f"\n[OK] CODE done ({time.time()-t0:.1f}s)")
    return 0


def cmd_review(task_id: str):
    print_header("REVIEW", f"task {task_id}")
    t0 = time.time()
    wt = get_worktree_path(task_id)
    design = read_artifact(wt, "plan", "design-final.md")
    self_review = read_artifact(wt, "code", "self-review.md")

    # Collect src files
    src_files = ""
    for p in wt.rglob("*"):
        if p.is_file() and p.suffix in {".py", ".js", ".mjs", ".ts", ".go", ".java", ".rs", ".cjs"}:
            rel = p.relative_to(wt)
            if any(x in str(rel) for x in ["artifacts", "node_modules", "__pycache__", ".worktrees"]):
                continue
            try:
                src_files += f"\n## {rel}\n```\n{p.read_text(encoding='utf-8')}\n```\n"
            except Exception:
                pass

    # Reviewer A: M3 quality
    log("\n[3.1] Review quality (M3)")
    prompt = (load_prompt("reviewer_code_dsv4")
              .replace("{design_final}", design)
              .replace("{src_files}", src_files or "(none)")
              .replace("{self_review}", self_review or "(none)"))
    r_m3 = call_opencode(MODEL_ROUTING["stage_3_reviewer_quality"], prompt, cwd=wt)
    if r_m3:
        write_artifact(wt, "review", "review-m3.md", r_m3)

    # Reviewer B: DSV4 arch
    log("\n[3.2] Review arch (DSV4)")
    prompt = (load_prompt("reviewer_code_m3")
              .replace("{design_final}", design)
              .replace("{src_files}", src_files or "(none)"))
    r_dsv4 = call_opencode(MODEL_ROUTING["stage_3_reviewer_arch"], prompt, cwd=wt)
    if r_dsv4:
        write_artifact(wt, "review", "review-dsv4.md", r_dsv4)

    # Merge
    final = f"# Review Final\n\n## M3 (quality)\n{r_m3 or '(none)'}\n\n## DSV4 (arch)\n{r_dsv4 or '(none)'}"
    write_artifact(wt, "review", "review-final.md", final)

    log(f"\n[OK] REVIEW done ({time.time()-t0:.1f}s)")
    return 0


def cmd_test(task_id: str):
    print_header("TEST", f"task {task_id}")
    t0 = time.time()
    wt = get_worktree_path(task_id)
    design = read_artifact(wt, "plan", "design-final.md")

    # Collect src
    src_files = ""
    for p in wt.rglob("*"):
        if p.is_file() and p.suffix in {".py", ".js", ".mjs", ".ts", ".cjs"}:
            rel = p.relative_to(wt)
            if any(x in str(rel) for x in ["artifacts", "node_modules", "__pycache__", ".worktrees"]):
                continue
            try:
                src_files += f"\n## {rel}\n```\n{p.read_text(encoding='utf-8')}\n```\n"
            except Exception:
                pass

    # Tester
    log("\n[4.1] Tester (M3)")
    prompt = (load_prompt("tester")
              .replace("{design_final}", design)
              .replace("{src_files}", src_files or "(none)"))
    call_opencode(MODEL_ROUTING["stage_4_tester"], prompt, cwd=wt)

    # Run test
    ptype = detect_project_type()
    test_cmd = get_test_command(ptype)
    log(f"  Run test ({ptype})...")
    r = subprocess.run(
        test_cmd, cwd=str(wt),
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
        timeout=120,
    )
    passed = r.stdout.count("passed") + r.stdout.count("PASSED")
    failed = r.stdout.count("failed") + r.stdout.count("FAILED")
    write_artifact(wt, "test", "test-report.md", f"passed: {passed}\nfailed: {failed}\n\n{r.stdout[-2000:]}")
    log(f"  {'[OK]' if failed == 0 else '[FAIL]'} {passed} passed, {failed} failed")

    # Documenter
    log("\n[4.2] Documenter (M3)")
    test_report = read_artifact(wt, "test", "test-report.md")
    prompt = (load_prompt("documenter")
              .replace("{design_final}", design)
              .replace("{src_files}", src_files or "(none)")
              .replace("{test_report}", test_report or "(none)"))
    call_opencode(MODEL_ROUTING["stage_4_documenter"], prompt, cwd=wt)

    log(f"\n[OK] TEST done ({time.time()-t0:.1f}s)")
    return 0


def cmd_deliver(task_id: str):
    print_header("DELIVER", f"task {task_id}")
    t0 = time.time()
    wt = get_worktree_path(task_id)

    # Release note
    log("\n[5.1] Release note (GLM-5.2)")
    artifacts_summary = ""
    for stage in ["plan", "code", "review", "test"]:
        d = wt / "artifacts" / stage
        if d.exists():
            for f in d.iterdir():
                artifacts_summary += f"- {stage}/{f.name}\n"
    prompt = load_prompt("release").replace("{artifacts}", artifacts_summary or "(none)")
    rn = call_opencode(MODEL_ROUTING["stage_5_release"], prompt, cwd=wt)
    if rn:
        write_artifact(wt, "plan", "release-note.md", rn)

    # Merge
    log("\n[5.2] Merge to master")
    tasks = parse_tasks(task_id)  # 不对,task_id 不是 raw
    # 查 worktree 的 branch
    r = run_git(["worktree", "list", "--porcelain"])
    branch = ""
    for line in r.stdout.splitlines():
        if str(wt) in line or str(wt).replace("/", "\\") in line:
            # 下面的 branch 行
            pass
    # 简化:从 worktree 目录名推分支
    slug = task_id
    r = run_git(["branch", "--list", f"feature/task-*{slug}*"])
    for line in r.stdout.splitlines():
        b = line.strip().lstrip("* ").strip()
        if b.startswith("feature/"):
            branch = b
            break

    if not branch:
        log("  [FAIL] no feature branch found")
        return 1

    r = run_git(["merge", branch, "--no-edit"])
    if r.returncode == 0:
        log(f"  [OK] {branch} merged")
    else:
        log(f"  [FAIL] merge: {r.stderr.strip()}")
        run_git(["merge", "--abort"])
        return 1

    # Full test
    log("\n[5.3] Full test")
    ptype = detect_project_type()
    test_cmd = get_test_command(ptype)
    r = subprocess.run(
        test_cmd, cwd=str(PROJECT_ROOT),
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
        timeout=120,
    )
    passed = r.stdout.count("passed") + r.stdout.count("PASSED")
    failed = r.stdout.count("failed") + r.stdout.count("FAILED")
    log(f"  {'[OK]' if failed == 0 else '[FAIL]'} {passed} passed, {failed} failed")

    # Run report
    generate_run_report(task_id, t0)

    # Cleanup worktree
    log("\n[5.4] Cleanup worktree")
    run_git(["worktree", "remove", "--force", str(wt)])
    run_git(["worktree", "prune"])
    run_git(["branch", "-D", branch])
    log(f"  [OK] removed {wt.name}")

    log(f"\n[OK] DELIVER done ({time.time()-t0:.1f}s)")
    return 0


def generate_run_report(task_id: str, t0: float):
    """生成运行报告"""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_path = REPORTS_DIR / f"run-report-{ts}-{task_id}.md"

    wt = get_worktree_path(task_id)
    elapsed = time.time() - t0

    # 收集产物
    artifacts = []
    for stage in ["plan", "code", "review", "test"]:
        d = wt / "artifacts" / stage
        if d.exists():
            for f in sorted(d.iterdir()):
                size = f.stat().st_size if f.is_file() else 0
                artifacts.append(f"- {stage}/{f.name} ({size}B)")

    # git log
    r = run_git(["log", "--oneline", "-10"])
    git_log = r.stdout.strip()

    content = f"""# MA Pipeline Run Report

- **Task ID**: {task_id}
- **Time**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
- **Duration**: {elapsed:.1f}s ({elapsed/60:.1f}min)
- **Project**: {PROJECT_ROOT.name}
- **Project Type**: {detect_project_type()}

## Model Routing

| Stage | Role | Model |
|-------|------|-------|
| 0 PM | GLM-5.2 | volcengine-plan/glm-5.2 |
| 1 Architect | DSV4 | volcengine-plan/deepseek-v4-pro |
| 1 Reviewer | M3 | volcengine-plan/minimax-m3 |
| 2 Coder | DSV4 | volcengine-plan/deepseek-v4-pro |
| 2 Self-Review | M3 | volcengine-plan/minimax-m3 |
| 3 Reviewer | M3 + DSV4 | volcengine-plan/minimax-m3 + deepseek-v4-pro |
| 4 Tester | M3 | volcengine-plan/minimax-m3 |
| 5 Release | GLM-5.2 | volcengine-plan/glm-5.2 |

## Artifacts

{chr(10).join(artifacts) if artifacts else '(none)'}

## Git Log (last 10)

```
{git_log}
```

## Config

- OpenCode: {OPENCODE_BIN}
- Python: {PYTHON}
- Worktree: {wt}
- Prompts: {PROMPTS_DIR}

---
Generated by orchestrate_v4.py
"""
    report_path.write_text(content, encoding="utf-8")
    log(f"\n[FILE] Report: {report_path.relative_to(PROJECT_ROOT)}")


def cmd_all(task_desc: str):
    print_header("ALL", "full pipeline")
    t0 = time.time()

    if cmd_prepare(task_desc) != 0:
        return 1
    tasks = parse_tasks(task_desc)
    tid = tasks[0]["id"]

    if cmd_plan(tid) != 0:
        return 1
    if cmd_code(tid) != 0:
        return 1
    if cmd_review(tid) != 0:
        return 1
    if cmd_test(tid) != 0:
        return 1
    if cmd_deliver(tid) != 0:
        return 1

    elapsed = time.time() - t0
    log(f"\n{'='*60}\n  [DONE] All done! {elapsed:.1f}s ({elapsed/60:.1f}min)\n{'='*60}")
    return 0


# ============================================================
# 入口
# ============================================================

USAGE = """MA Pipeline v4 (cross-project)

Commands:
  all "task desc"         Full pipeline
  prepare "task desc"     Create worktree + TASK.md
  plan <task-id>          Design + review + revise
  code <task-id>          Code + self-debug + self-review
  review <task-id>        Code review (M3 + DSV4)
  test <task-id>          Test + docs
  deliver <task-id>       Merge + report + cleanup
  status                  Show worktrees
  cleanup                 Remove all worktrees

Usage:
  python orchestrate_v4.py all "add power function to calc.py"
  python orchestrate_v4.py prepare "task1 || task2"
  python orchestrate_v4.py plan task-1
"""


def cmd_status():
    r = run_git(["worktree", "list"])
    log("Worktrees:")
    for line in r.stdout.splitlines():
        log(f"  {line}")
    return 0


def cmd_cleanup():
    log("Cleanup worktrees...")
    r = run_git(["worktree", "list", "--porcelain"])
    count = 0
    for line in r.stdout.splitlines():
        if line.startswith("worktree ") and str(PROJECT_ROOT) not in line:
            wt = line.replace("worktree ", "")
            run_git(["worktree", "remove", "--force", wt])
            log(f"  removed: {Path(wt).name}")
            count += 1
    run_git(["worktree", "prune"])
    # 删 feature 分支
    r = run_git(["branch", "--list", "feature/*"])
    for line in r.stdout.splitlines():
        b = line.strip().lstrip("* ").strip()
        if b.startswith("feature/"):
            run_git(["branch", "-D", b])
            log(f"  branch: {b}")
    log(f"\n[OK] cleaned {count} worktrees")
    return 0


def main():
    if len(sys.argv) < 2:
        print(USAGE)
        return 0

    cmd = sys.argv[1]
    if cmd == "all":
        if len(sys.argv) < 3:
            print("Usage: python orchestrate_v4.py all \"task desc\"")
            return 1
        return cmd_all(" ".join(sys.argv[2:]))
    elif cmd == "prepare":
        if len(sys.argv) < 3:
            print("Usage: python orchestrate_v4.py prepare \"task desc\"")
            return 1
        return cmd_prepare(" ".join(sys.argv[2:]))
    elif cmd in ("plan", "code", "review", "test", "deliver"):
        if len(sys.argv) < 3:
            print(f"Usage: python orchestrate_v4.py {cmd} <task-id>")
            return 1
        fn = {"plan": cmd_plan, "code": cmd_code, "review": cmd_review,
              "test": cmd_test, "deliver": cmd_deliver}[cmd]
        return fn(sys.argv[2])
    elif cmd == "status":
        return cmd_status()
    elif cmd == "cleanup":
        return cmd_cleanup()
    else:
        print(f"Unknown: {cmd}")
        print(USAGE)
        return 1


if __name__ == "__main__":
    sys.exit(main())
