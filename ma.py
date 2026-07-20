#!/usr/bin/env python3
"""
ma - 多 Agent 流水线一键启动(跨平台,纯 Python)
用法:
  python ma.py all "任务描述"
  python ma.py prepare "任务描述"
  python ma.py plan task-1
  python ma.py code task-1
  python ma.py review task-1
  python ma.py test task-1
  python ma.py deliver task-1
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

PYTHON = sys.executable
SKILL_DIR = Path.home() / ".workbuddy" / "skills" / "multi-agent-pipeline"


def init_project(project_dir: Path):
    """如果项目没有 orchestrate_v4.py,从 skill 复制"""
    needed = ["orchestrate_v4.py", "orchestrate.py", "prompts"]
    for item in needed:
        src = SKILL_DIR / item
        dst = project_dir / item
        if not dst.exists():
            if src.is_dir():
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
            print(f"[ma] init: copied {item}")
    print("[ma] ready")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    project_dir = Path.cwd()
    cmd_args = sys.argv[1:]

    # 如果当前目录没有 orchestrate_v4.py,初始化
    if not (project_dir / "orchestrate_v4.py").exists():
        init_project(project_dir)

    # 直接调 orchestrate_v4.py
    cmd = [PYTHON, "orchestrate_v4.py"] + cmd_args
    return subprocess.call(cmd, cwd=str(project_dir))


if __name__ == "__main__":
    sys.exit(main())
