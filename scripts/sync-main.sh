#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  echo "git is required" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this script from inside the repository" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes. Commit, stash, or discard them before syncing." >&2
  exit 1
fi

SYNC_BRANCH=${1:-}

echo "Fetching latest commits from origin..."
git fetch origin --prune

echo "Checking out main..."
if git show-ref --verify --quiet refs/heads/main; then
  git checkout main
else
  git checkout -B main origin/main
fi

echo "Resetting main to origin/main..."
git reset --hard origin/main

echo "Main is now up to date with origin/main."

if [[ -n "${SYNC_BRANCH}" ]]; then
  echo "Creating or resetting feature branch '${SYNC_BRANCH}' from main..."
  git checkout -B "${SYNC_BRANCH}" main
  echo "Switched to branch '${SYNC_BRANCH}'."
else
  echo "Stay on main or create a feature branch with: git checkout -b <branch-name>"
fi
