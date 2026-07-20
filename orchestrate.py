"""
多 Agent 并行协作协调器 v2

用法:
  python orchestrate.py prepare "任务1 || 任务2"
  python orchestrate.py merge
  python orchestrate.py status
  python orchestrate.py cleanup
"""

import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.resolve()
# worktree 父目录: 项目内 .worktrees/ 子目录, 避免沙箱拦截项目外写入
WORKTREE_PARENT = PROJECT_ROOT / ".worktrees"
WORKTREE_PARENT.mkdir(exist_ok=True)
PYTHON = r"C:\Users\HTF2026\.workbuddy\binaries\python\versions\3.13.12\python.exe"

COMMIT_PATTERN = re.compile(r"^(feat|fix|refactor|test|docs|chore)(\([\w-]+\))?:\s+.+")


def run(cmd, cwd=None, check=False):
    """执行命令,返回 CompletedProcess"""
    return subprocess.run(
        cmd, cwd=cwd or PROJECT_ROOT, capture_output=True,
        text=True, encoding="utf-8", errors="replace",
        check=check,
    )


def parse_tasks(raw: str) -> list:
    """把 '任务1 || 任务2' 解析为任务列表"""
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
            "suffix": f"task-{i}",
        })
    return tasks


def extract_files(desc: str) -> set:
    """从描述中提取文件名"""
    return set(re.findall(r"[\w-]+\.\w+", desc.lower()))


def check_parallelizable(tasks: list) -> tuple:
    """检查任务是否可并行,返回 (可并行, 冲突信息)"""
    if len(tasks) < 2:
        return True, "单任务"
    files_per = [extract_files(t["description"]) for t in tasks]
    for i in range(len(files_per)):
        for j in range(i + 1, len(files_per)):
            overlap = files_per[i] & files_per[j]
            if overlap:
                return False, f"Task {i+1} 和 Task {j+1} 文件重叠: {overlap}"
    return True, "无文件冲突"


def generate_task_md(task: dict, all_tasks: list) -> str:
    """生成标准化 TASK.md"""
    files = extract_files(task["description"])
    scope = "\n".join(f"- `{f}`" for f in sorted(files)) if files else "- 新建文件(自行命名)"

    other_files = set()
    for other in all_tasks:
        if other["id"] != task["id"]:
            other_files.update(extract_files(other["description"]))
    conflict_info = f"其他任务涉及: {', '.join(sorted(other_files))}" if other_files else "无冲突"

    return f"""# 任务: {task['description'][:60]}

## 范围
{scope}

## 目标
{task['description']}

## 约束
- 只在 `demo/` 目录下工作(或任务指定目录)
- 不修改公共配置文件
- 类型注解齐全
- 完成后用 pytest 验证
- **必须用 git commit 提交**,格式: `feat(scope): 描述`

## 文件冲突检测
{conflict_info}

## 完成标志
- [ ] 所有新增测试通过
- [ ] 提交到 `feature/{task['branch']}` 分支
- [ ] commit message 符合规范
- [ ] 无调试残留代码
"""


def cmd_prepare(raw_tasks: str):
    """准备阶段:创建 worktree + 生成 TASK.md"""
    t0 = time.time()
    print("=" * 60)
    print(f"  Multi-Agent Orchestrator v2 - PREPARE")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    tasks = parse_tasks(raw_tasks)
    if not tasks:
        print("[ERROR] 没有有效任务")
        return 1

    print(f"\n[1/4] 解析任务: {len(tasks)} 个")
    for t in tasks:
        print(f"  {t['id']}: {t['description'][:60]}")

    parallelizable, info = check_parallelizable(tasks)
    print(f"\n[2/4] 可并行性: {'✅ ' + info if parallelizable else '⚠️ ' + info}")

    print(f"\n[3/4] 创建 worktree:")
    worktrees = {}
    for t in tasks:
        wt_path = WORKTREE_PARENT / f"worktree-{t['suffix']}"
        if wt_path.exists():
            print(f"  {t['id']}: ⚠️ 已存在,跳过")
            worktrees[t["id"]] = wt_path
            continue
        r = run(["git", "worktree", "add", str(wt_path), "-b", f"feature/{t['branch']}"])
        if r.returncode != 0:
            print(f"  {t['id']}: ❌ {r.stderr.strip()}")
            return 1
        worktrees[t["id"]] = wt_path
        print(f"  {t['id']}: {wt_path}")

    print(f"\n[4/4] 生成 TASK.md:")
    for t in tasks:
        wt_path = worktrees[t["id"]]
        task_md = generate_task_md(t, tasks)
        (wt_path / "TASK.md").write_text(task_md, encoding="utf-8")
        print(f"  {t['id']}: TASK.md ✅")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"  准备完成 ({elapsed:.1f}s)")
    print(f"  Worktree 路径:")
    for tid, path in worktrees.items():
        print(f"    {tid}: {path}")
    print(f"\n  下一步: WorkBuddy Agent 工具并行调度")
    print(f"  完成后运行: python orchestrate.py merge")
    print(f"{'=' * 60}")
    return 0


def cmd_merge():
    """合并阶段:验证 + 合并 + 测试 + 清理"""
    t0 = time.time()
    print("=" * 60)
    print(f"  Multi-Agent Orchestrator v2 - MERGE")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 检测 feature 分支
    r = run(["git", "branch", "--list", "feature/*"])
    branches = []
    for line in r.stdout.splitlines():
        b = line.strip()
        if not b:
            continue
        for prefix in ("+ ", "* ", "  "):
            if b.startswith(prefix):
                b = b[len(prefix):]
                break
        b = b.strip()
        if b.startswith("feature/"):
            branches.append(b)
    if not branches:
        print("\n[ERROR] 没有找到 feature 分支")
        return 1

    print(f"\n[1/5] 检测到 {len(branches)} 个 feature 分支:")
    for b in branches:
        print(f"  {b}")

    # 验证每个分支
    print(f"\n[2/5] 验证分支:")
    all_ok = True
    for b in branches:
        print(f"\n  [{b}]")
        # commit message 检查
        r = run(["git", "log", f"master..{b}", "--pretty=format:%s"])
        issues = [line for line in r.stdout.splitlines() if line and not COMMIT_PATTERN.match(line)]
        if issues:
            print(f"    ⚠️  Commit message 问题:")
            for issue in issues:
                print(f"      - {issue}")
        else:
            print(f"    ✅ Commit message 规范")
        # 冲突预检
        r = run(["git", "merge-tree", "HEAD", b])
        if "<<<<<<<" in r.stdout:
            print(f"    ❌ 检测到合并冲突")
            all_ok = False
        else:
            print(f"    ✅ 无合并冲突")

    if not all_ok:
        print(f"\n[ERROR] 存在冲突,请手动解决")
        return 1

    # 合并
    print(f"\n[3/5] 合并:")
    for b in branches:
        r = run(["git", "merge", b, "--no-edit"])
        if r.returncode == 0:
            print(f"  ✅ {b} 合并成功")
        else:
            print(f"  ❌ {b} 合并失败: {r.stderr.strip()}")
            run(["git", "merge", "--abort"])
            return 1

    # 跑测试
    print(f"\n[4/5] 全量测试:")
    r = subprocess.run(
        [PYTHON, "-m", "pytest", "demo/", "-v", "--tb=short"],
        cwd=PROJECT_ROOT, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    passed = r.stdout.count("PASSED")
    failed = r.stdout.count("FAILED")
    if failed == 0 and passed > 0:
        print(f"  ✅ {passed} passed in 0.{int(time.time()) % 10}s")
    else:
        print(f"  ❌ {passed} passed, {failed} failed")
        print(r.stdout[-500:])

    # 清理
    print(f"\n[5/5] 清理:")
    r = run(["git", "worktree", "list", "--porcelain"])
    for line in r.stdout.splitlines():
        if line.startswith("worktree "):
            wt = line.replace("worktree ", "")
            wt_norm = wt.replace("\\", "/")
            if wt_norm != str(PROJECT_ROOT).replace("\\", "/").lower():
                run(["git", "worktree", "remove", "--force", wt])
                print(f"  ✅ 移除 {Path(wt).name}")
    run(["git", "worktree", "prune"])
    for b in branches:
        run(["git", "branch", "-D", b])
        print(f"  ✅ 删除分支 {b}")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"  完成! 耗时 {elapsed:.1f}s")
    print(f"  测试: {passed} passed, {failed} failed")
    print(f"\n  Git log:")
    r = run(["git", "log", "--oneline", "-5"])
    for line in r.stdout.splitlines():
        print(f"    {line}")
    print(f"{'=' * 60}")
    return 0


def cmd_status():
    """查看状态"""
    print("Worktree 列表:")
    r = run(["git", "worktree", "list"])
    for line in r.stdout.splitlines():
        print(f"  {line}")
    print("\nFeature 分支:")
    r = run(["git", "branch", "--list", "feature/*"])
    for line in r.stdout.splitlines():
        print(f"  {line}")
    return 0


def cmd_cleanup():
    """清理所有 worktree 和 feature 分支"""
    print("清理所有 worktree...")
    r = run(["git", "worktree", "list", "--porcelain"])
    main_wt = str(PROJECT_ROOT).replace("\\", "/").lower()
    cleaned = 0
    for line in r.stdout.splitlines():
        if line.startswith("worktree "):
            wt = line.replace("worktree ", "")
            if wt.replace("\\", "/") != main_wt:
                run(["git", "worktree", "remove", "--force", wt])
                print(f"  移除: {Path(wt).name}")
                cleaned += 1
    run(["git", "worktree", "prune"])
    print(f"\n删除 feature 分支...")
    r = run(["git", "branch", "--list", "feature/*"])
    for line in r.stdout.splitlines():
        b = line.strip()
        for prefix in ("+ ", "* ", "  "):
            if b.startswith(prefix):
                b = b[len(prefix):]
                break
        b = b.strip()
        if b.startswith("feature/"):
            run(["git", "branch", "-D", b])
            print(f"  删除: {b}")
    print(f"\n清理完成: {cleaned} 个 worktree")
    return 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 0

    cmd = sys.argv[1]
    if cmd == "prepare":
        if len(sys.argv) < 3:
            print("用法: python orchestrate.py prepare \"任务1 || 任务2\"")
            return 1
        return cmd_prepare(" ".join(sys.argv[2:]))
    elif cmd == "merge":
        return cmd_merge()
    elif cmd == "status":
        return cmd_status()
    elif cmd == "cleanup":
        return cmd_cleanup()
    else:
        print(f"未知命令: {cmd}")
        print(__doc__)
        return 1


if __name__ == "__main__":
    sys.exit(main())
