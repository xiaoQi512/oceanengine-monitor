"""
多 Agent 并行协作协调器 v3

v2 命令(保留): prepare / merge / status / cleanup
v3 新增命令:
  plan <task-id>           阶段 0+1: 需求 + 设计 + 并行审查 + 修订
  code <task-id>           阶段 2:   编码 + 自调试 + DSV4 自审查(不阻塞)
  review <task-id>         阶段 3:   Code Review(并行双维)
  test <task-id>           阶段 4:   测试 + 文档
  deliver <task-id>        阶段 5:   合并 + 归档 + 通知(deliver 是 merge 的超集)
  all "任务描述"            一键串联: prepare→plan→code→review→test→deliver

用法示例:
  # 单任务全流程
  python orchestrate_v3.py all "给 demo/calc.py 加一个 power(a,b) 幂运算函数"

  # 分阶段执行
  python orchestrate_v3.py prepare "给 demo/calc.py 加 power 函数"
  python orchestrate_v3.py plan task-1
  python orchestrate_v3.py code task-1
  python orchestrate_v3.py review task-1
  python orchestrate_v3.py test task-1
  python orchestrate_v3.py deliver task-1

依赖: OpenCode CLI (opencode run -m <model> -p "<prompt>")
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# 复用 v2 的基础函数
from orchestrate import (
    PROJECT_ROOT, WORKTREE_PARENT, PYTHON, COMMIT_PATTERN,
    run, parse_tasks, extract_files, check_parallelizable,
    generate_task_md, cmd_prepare as v2_prepare,
    cmd_merge as v2_merge, cmd_status as v2_status, cmd_cleanup as v2_cleanup,
)

# ============================================================
# v3 配置
# ============================================================

PROMPTS_DIR = PROJECT_ROOT / "prompts"

# 模型路由(与 opencode.json 对应)
MODEL_ROUTING = {
    "stage_0_pm":              "volcengine-plan/glm-5.2",           # GLM-5.2 1M
    "stage_1_architect":       "opencode-go/minimax-m3",            # M3
    "stage_1_reviewer_a":      "volcengine-plan/deepseek-v4-pro",   # DSV4 1M
    "stage_1_reviewer_b":      "opencode-go/qwen3.7-max",           # Qwen
    "stage_1_revise":          "opencode-go/minimax-m3",            # M3
    "stage_2_coder":           "opencode-go/minimax-m3",            # M3
    "stage_2_debug_upgrade":   "volcengine-plan/deepseek-v4-pro",   # DSV4 1M
    "stage_2_self_review":     "volcengine-plan/deepseek-v4-pro",   # DSV4 1M
    "stage_3_reviewer_quality":"volcengine-plan/deepseek-v4-pro",   # DSV4 1M
    "stage_3_reviewer_arch":   "opencode-go/minimax-m3",            # M3
    "stage_3_p0_audit":        "opencode-go/qwen3.7-max",           # Qwen
    "stage_4_tester":          "opencode-go/minimax-m3",            # M3
    "stage_4_documenter":      "opencode-go/minimax-m3",            # M3
    "stage_5_release":         "volcengine-plan/glm-5.2",           # GLM-5.2 1M
}

# 7 月 1 日后 fallback(火山方舟优惠到期)
FALLBACK_AFTER_0701 = {
    "volcengine-plan/glm-5.2":          "opencode-go/minimax-m3",
    "volcengine-plan/deepseek-v4-pro":  "opencode-go/deepseek-v4-pro",
}

# OpenCode CLI 超时(秒)
OPENCODE_TIMEOUT = 600


# ============================================================
# 工具函数
# ============================================================

def get_worktree_path(task_id: str) -> Path:
    """根据 task-id 获取 worktree 路径"""
    return WORKTREE_PARENT / f"worktree-{task_id}"


def load_prompt(name: str) -> str:
    """加载提示词模板"""
    p = PROMPTS_DIR / f"{name}.md"
    if not p.exists():
        raise FileNotFoundError(f"提示词模板不存在: {p}")
    return p.read_text(encoding="utf-8")


def call_opencode(model: str, prompt: str, cwd: Path = None, timeout: int = None) -> str:
    """
    调用 OpenCode CLI 非交互模式
    返回: 模型输出的纯文本
    """
    # Windows 下 subprocess 不继承 bash PATH，需显式注入
    opencode_bin = r"C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2"
    env = os.environ.copy()
    env["PATH"] = opencode_bin + os.pathsep + env.get("PATH", "")
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    cmd = [
        os.path.join(opencode_bin, "opencode.cmd"),
        "run",
        "-m", model,
        "--format", "json",
        prompt,
    ]
    r = subprocess.run(
        cmd, cwd=str(cwd or PROJECT_ROOT),
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
        timeout=timeout or OPENCODE_TIMEOUT,
        env=env,
    )
    if r.returncode != 0:
        print(f"  [ERROR] opencode 返回 {r.returncode}")
        if r.stderr:
            print(f"  stderr: {r.stderr[:500]}")
        return ""
    # JSON 格式输出解析(取最后一条 message)
    try:
        lines = [l for l in r.stdout.splitlines() if l.strip().startswith("{")]
        if lines:
            last = json.loads(lines[-1])
            return last.get("content", "") or last.get("text", "") or r.stdout
    except (json.JSONDecodeError, IndexError):
        pass
    return r.stdout


def ensure_artifacts_dir(wt_path: Path):
    """创建 artifacts 目录结构"""
    for sub in ["plan", "code", "review", "test"]:
        (wt_path / "artifacts" / sub).mkdir(parents=True, exist_ok=True)


def write_artifact(wt_path: Path, stage: str, filename: str, content: str):
    """写入阶段产物"""
    p = wt_path / "artifacts" / stage / filename
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    print(f"  📄 {p.relative_to(wt_path)}")


def read_artifact(wt_path: Path, stage: str, filename: str) -> str:
    """读取阶段产物"""
    p = wt_path / "artifacts" / stage / filename
    if not p.exists():
        return ""
    return p.read_text(encoding="utf-8")


def print_stage_header(stage: str, title: str):
    print("\n" + "=" * 60)
    print(f"  {stage}: {title}")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)


# ============================================================
# 阶段 0+1: plan (需求 + 设计 + 并行审查 + 修订)
# ============================================================

def cmd_plan(task_id: str):
    """阶段 0+1: 需求分析 + 设计 + 并行审查 + 修订"""
    t0 = time.time()
    print_stage_header("PLAN", f"任务 {task_id}")

    wt_path = get_worktree_path(task_id)
    if not wt_path.exists():
        print(f"[ERROR] worktree 不存在: {wt_path}")
        print(f"  请先运行: python orchestrate_v3.py prepare \"任务描述\"")
        return 1

    ensure_artifacts_dir(wt_path)
    task_md = (wt_path / "TASK.md").read_text(encoding="utf-8")

    # --- 阶段 0(可选): 需求分析 ---
    print("\n[阶段 0] 需求分析 (PM: GLM-5.2)")
    is_complex = len(task_md) > 500 or "多模块" in task_md or "跨系统" in task_md
    if is_complex:
        prompt = load_prompt("pm_prd").replace("{TASK_MD}", task_md)
        prd = call_opencode(MODEL_ROUTING["stage_0_pm"], prompt, cwd=wt_path)
        if prd:
            write_artifact(wt_path, "plan", "PRD.md", prd)
        else:
            print("  ⚠️ PM 输出为空,跳过 PRD,直接用 TASK.md")
            prd = task_md
    else:
        print("  简单任务,跳过 PRD,直接用 TASK.md")
        prd = task_md

    # --- 阶段 1 Step 1: M3 出设计方案 v1 ---
    print("\n[阶段 1.1] 设计方案 v1 (Architect: M3)")
    prompt = load_prompt("architect_design").replace("{PRD}", prd)
    design_v1 = call_opencode(MODEL_ROUTING["stage_1_architect"], prompt, cwd=wt_path)
    if not design_v1:
        print("  ❌ Architect 输出为空,中止")
        return 1
    write_artifact(wt_path, "plan", "design-v1.md", design_v1)

    # --- 阶段 1 Step 2: 并行审查 ---
    print("\n[阶段 1.2] 并行审查 (DSV4 + Qwen)")

    # DSV4 审查
    print("  → DSV4 审查中...")
    prompt_dsv4 = load_prompt("reviewer_dsv4_design").replace("{DESIGN}", design_v1)
    review_dsv4 = call_opencode(MODEL_ROUTING["stage_1_reviewer_a"], prompt_dsv4, cwd=wt_path)
    if review_dsv4:
        write_artifact(wt_path, "plan", "review-dsv4.md", review_dsv4)

    # Qwen 审查(微量)
    print("  → Qwen 审查中...")
    prompt_qwen = load_prompt("reviewer_qwen_design").replace("{DESIGN}", design_v1)
    review_qwen = call_opencode(MODEL_ROUTING["stage_1_reviewer_b"], prompt_qwen, cwd=wt_path)
    if review_qwen:
        write_artifact(wt_path, "plan", "review-qwen.md", review_qwen)

    # --- 阶段 1 Step 3: M3 综合修订 ---
    print("\n[阶段 1.3] 综合修订定稿 (Architect: M3)")
    prompt = (load_prompt("architect_revise")
              .replace("{DESIGN_V1}", design_v1)
              .replace("{REVIEW_DSV4}", review_dsv4 or "(无)")
              .replace("{REVIEW_QWEN}", review_qwen or "(无)"))
    design_final = call_opencode(MODEL_ROUTING["stage_1_revise"], prompt, cwd=wt_path)
    if not design_final:
        print("  ⚠️ 修订输出为空,使用 design-v1 作为定稿")
        design_final = design_v1
    write_artifact(wt_path, "plan", "design-final.md", design_final)

    elapsed = time.time() - t0
    print(f"\n✅ PLAN 完成 ({elapsed:.1f}s)")
    print(f"  下一步: python orchestrate_v3.py code {task_id}")
    return 0


# ============================================================
# 阶段 2: code (编码 + 自调试 + DSV4 自审查)
# ============================================================

def cmd_code(task_id: str):
    """阶段 2: 编码 + 自调试 + DSV4 自审查(不阻塞)"""
    t0 = time.time()
    print_stage_header("CODE", f"任务 {task_id}")

    wt_path = get_worktree_path(task_id)
    design = read_artifact(wt_path, "plan", "design-final.md")
    if not design:
        print("[ERROR] 找不到 design-final.md,请先运行 plan")
        return 1

    max_retries = 3
    success = False

    for attempt in range(1, max_retries + 1):
        model_key = "stage_2_coder" if attempt <= 2 else "stage_2_debug_upgrade"
        model = MODEL_ROUTING[model_key]
        print(f"\n[编码尝试 {attempt}/{max_retries}] 模型: {model}")

        if attempt == 1:
            prompt = load_prompt("engineer_code").replace("{DESIGN}", design)
        else:
            prev_error = read_artifact(wt_path, "code", "debug-log.md")
            prompt = (load_prompt("engineer_debug")
                      .replace("{DESIGN}", design)
                      .replace("{PREV_ERROR}", prev_error[-2000:]))

        call_opencode(model, prompt, cwd=wt_path)

        # 跑测试
        print(f"  运行 pytest...")
        r = subprocess.run(
            [PYTHON, "-m", "pytest", "demo/", "-v", "--tb=short"],
            cwd=str(wt_path), capture_output=True, text=True,
            encoding="utf-8", errors="replace",
        )
        passed = r.stdout.count("PASSED")
        failed = r.stdout.count("FAILED")

        if failed == 0 and passed > 0:
            print(f"  ✅ {passed} passed")
            # commit
            run(["git", "add", "-A"], cwd=wt_path)
            run(["git", "commit", "-m", f"feat({task_id}): implement"], cwd=wt_path)
            write_artifact(wt_path, "code", "commits.log",
                           f"attempt {attempt}: feat({task_id}): implement\n")
            success = True
            break
        else:
            print(f"  ❌ {passed} passed, {failed} failed")
            write_artifact(wt_path, "code", "debug-log.md",
                           f"=== Attempt {attempt} ({model}) ===\n{r.stdout[-2000:]}\n")

    if not success:
        print(f"\n⚠️ 自调试 {max_retries} 次失败,需人工介入")
        return 1

    # --- DSV4 自审查(不阻塞) ---
    print("\n[阶段 2 末] DSV4 自审查 (不阻塞)")
    prompt = load_prompt("self_review")
    self_review = call_opencode(
        MODEL_ROUTING["stage_2_self_review"], prompt, cwd=wt_path
    )
    if self_review:
        write_artifact(wt_path, "code", "self-review.md", self_review)
        print("  📝 自审查备注已写入,供阶段 3 参考(不阻塞)")
    else:
        print("  ⚠️ 自审查输出为空,跳过")

    elapsed = time.time() - t0
    print(f"\n✅ CODE 完成 ({elapsed:.1f}s)")
    print(f"  下一步: python orchestrate_v3.py review {task_id}")
    return 0


# ============================================================
# 阶段 3: review (Code Review 并行双维)
# ============================================================

def cmd_review(task_id: str):
    """阶段 3: Code Review(DSV4 质量/安全 + M3 架构对齐)"""
    t0 = time.time()
    print_stage_header("REVIEW", f"任务 {task_id}")

    wt_path = get_worktree_path(task_id)
    design = read_artifact(wt_path, "plan", "design-final.md")
    self_review = read_artifact(wt_path, "code", "self-review.md")

    # DSV4 审查(质量/安全)
    print("\n[3.1] DSV4 审查 (质量/安全/逐行)")
    prompt = (load_prompt("reviewer_code_dsv4")
              .replace("{DESIGN}", design)
              .replace("{SELF_REVIEW}", self_review or "(无自审查备注)"))
    review_dsv4 = call_opencode(
        MODEL_ROUTING["stage_3_reviewer_quality"], prompt, cwd=wt_path
    )
    if review_dsv4:
        write_artifact(wt_path, "review", "review-dsv4.md", review_dsv4)

    # M3 审查(架构对齐)
    print("\n[3.2] M3 审查 (架构对齐)")
    prompt = (load_prompt("reviewer_code_m3")
              .replace("{DESIGN}", design)
              .replace("{SELF_REVIEW}", self_review or "(无)"))
    review_m3 = call_opencode(
        MODEL_ROUTING["stage_3_reviewer_arch"], prompt, cwd=wt_path
    )
    if review_m3:
        write_artifact(wt_path, "review", "review-m3.md", review_m3)

    # 汇总
    combined = f"# Code Review 汇总\n\n## DSV4 审查\n{review_dsv4 or '(空)'}\n\n## M3 审查\n{review_m3 or '(空)'}\n"
    write_artifact(wt_path, "review", "review-final.md", combined)

    # 检查 P0
    has_p0 = "P0" in (review_dsv4 or "") or "P0" in (review_m3 or "")
    if has_p0:
        print("\n⚠️ 检测到 P0 级问题!")
        print("  → 可选: python orchestrate_v3.py review --qwen-audit " + task_id)
        print("  → 或回退: python orchestrate_v3.py code " + task_id)
    else:
        print("\n✅ 无 P0 问题")

    elapsed = time.time() - t0
    print(f"\n✅ REVIEW 完成 ({elapsed:.1f}s)")
    print(f"  下一步: python orchestrate_v3.py test {task_id}")
    return 0


# ============================================================
# 阶段 4: test (测试 + 文档)
# ============================================================

def cmd_test(task_id: str):
    """阶段 4: 测试 + 文档"""
    t0 = time.time()
    print_stage_header("TEST", f"任务 {task_id}")

    wt_path = get_worktree_path(task_id)
    design = read_artifact(wt_path, "plan", "design-final.md")

    # 测试生成
    print("\n[4.1] 测试用例生成 (Tester: M3)")
    prompt = load_prompt("tester").replace("{DESIGN}", design)
    call_opencode(MODEL_ROUTING["stage_4_tester"], prompt, cwd=wt_path)

    # 跑测试
    print("  运行 pytest...")
    r = subprocess.run(
        [PYTHON, "-m", "pytest", "demo/", "-v", "--tb=short"],
        cwd=str(wt_path), capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    passed = r.stdout.count("PASSED")
    failed = r.stdout.count("FAILED")
    write_artifact(wt_path, "test", "test-report.md",
                   f"passed: {passed}\nfailed: {failed}\n\n{r.stdout[-2000:]}")

    if failed > 0:
        print(f"  ❌ {passed} passed, {failed} failed → 回退到编码阶段")
        return 1
    print(f"  ✅ {passed} passed")

    # 文档生成
    print("\n[4.2] 文档生成 (Documenter: M3)")
    prompt = load_prompt("documenter").replace("{DESIGN}", design)
    call_opencode(MODEL_ROUTING["stage_4_documenter"], prompt, cwd=wt_path)

    elapsed = time.time() - t0
    print(f"\n✅ TEST 完成 ({elapsed:.1f}s)")
    print(f"  下一步: python orchestrate_v3.py deliver {task_id}")
    return 0


# ============================================================
# 阶段 5: deliver (合并 + 归档)
# ============================================================

def cmd_deliver(task_id: str):
    """阶段 5: 合并 + 归档"""
    t0 = time.time()
    print_stage_header("DELIVER", f"任务 {task_id}")

    wt_path = get_worktree_path(task_id)

    # 交付归档(GLM-5.2 生成影响面分析)
    print("\n[5.1] 交付归档 (Release: GLM-5.2)")
    artifacts_summary = ""
    for stage in ["plan", "code", "review", "test"]:
        d = wt_path / "artifacts" / stage
        if d.exists():
            for f in d.iterdir():
                artifacts_summary += f"- {stage}/{f.name}\n"

    prompt = load_prompt("release").replace("{ARTIFACTS}", artifacts_summary or "(无)")
    release_note = call_opencode(
        MODEL_ROUTING["stage_5_release"], prompt, cwd=wt_path
    )
    if release_note:
        write_artifact(wt_path, "plan", "release-note.md", release_note)

    # 合并(复用 v2 的 merge 逻辑)
    print("\n[5.2] 合并到主分支")
    branch = f"feature/task-1-{task_id.replace('task-', '')}"
    # 简化:直接调 v2_merge
    r = run(["git", "merge", branch, "--no-edit"])
    if r.returncode == 0:
        print(f"  ✅ {branch} 合并成功")
    else:
        print(f"  ❌ 合并失败: {r.stderr.strip()}")
        run(["git", "merge", "--abort"])
        return 1

    # 全量测试
    print("\n[5.3] 全量测试")
    r = subprocess.run(
        [PYTHON, "-m", "pytest", "demo/", "-v", "--tb=short"],
        cwd=PROJECT_ROOT, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    passed = r.stdout.count("PASSED")
    failed = r.stdout.count("FAILED")
    print(f"  {'✅' if failed == 0 else '❌'} {passed} passed, {failed} failed")

    elapsed = time.time() - t0
    print(f"\n✅ DELIVER 完成 ({elapsed:.1f}s)")
    print(f"\n  Git log:")
    r = run(["git", "log", "--oneline", "-5"])
    for line in r.stdout.splitlines():
        print(f"    {line}")
    return 0


# ============================================================
# all: 一键串联
# ============================================================

def cmd_all(task_desc: str):
    """一键串联: prepare→plan→code→review→test→deliver"""
    t0 = time.time()
    print_stage_header("ALL", "全流程串联")

    # prepare
    print("\n>>> [1/6] PREPARE")
    if v2_prepare(task_desc) != 0:
        return 1

    # 获取 task_id(单任务)
    tasks = parse_tasks(task_desc)
    task_id = tasks[0]["id"]

    # plan
    print("\n>>> [2/6] PLAN")
    if cmd_plan(task_id) != 0:
        return 1

    # code
    print("\n>>> [3/6] CODE")
    if cmd_code(task_id) != 0:
        return 1

    # review
    print("\n>>> [4/6] REVIEW")
    if cmd_review(task_id) != 0:
        return 1

    # test
    print("\n>>> [5/6] TEST")
    if cmd_test(task_id) != 0:
        return 1

    # deliver
    print("\n>>> [6/6] DELIVER")
    if cmd_deliver(task_id) != 0:
        return 1

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"  🎉 全流程完成! 耗时 {elapsed:.1f}s")
    print(f"{'=' * 60}")
    return 0


# ============================================================
# 主入口
# ============================================================

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 0

    cmd = sys.argv[1]

    # v2 命令(透传)
    if cmd == "prepare":
        if len(sys.argv) < 3:
            print("用法: python orchestrate_v3.py prepare \"任务1 || 任务2\"")
            return 1
        return v2_prepare(" ".join(sys.argv[2:]))
    elif cmd == "merge":
        return v2_merge()
    elif cmd == "status":
        return v2_status()
    elif cmd == "cleanup":
        return v2_cleanup()

    # v3 新增命令
    elif cmd == "plan":
        if len(sys.argv) < 3:
            print("用法: python orchestrate_v3.py plan <task-id>")
            return 1
        return cmd_plan(sys.argv[2])
    elif cmd == "code":
        if len(sys.argv) < 3:
            print("用法: python orchestrate_v3.py code <task-id>")
            return 1
        return cmd_code(sys.argv[2])
    elif cmd == "review":
        if len(sys.argv) < 3:
            print("用法: python orchestrate_v3.py review <task-id>")
            return 1
        return cmd_review(sys.argv[2])
    elif cmd == "test":
        if len(sys.argv) < 3:
            print("用法: python orchestrate_v3.py test <task-id>")
            return 1
        return cmd_test(sys.argv[2])
    elif cmd == "deliver":
        if len(sys.argv) < 3:
            print("用法: python orchestrate_v3.py deliver <task-id>")
            return 1
        return cmd_deliver(sys.argv[2])
    elif cmd == "all":
        if len(sys.argv) < 3:
            print("用法: python orchestrate_v3.py all \"任务描述\"")
            return 1
        return cmd_all(" ".join(sys.argv[2:]))
    else:
        print(f"未知命令: {cmd}")
        print(__doc__)
        return 1


if __name__ == "__main__":
    sys.exit(main())
