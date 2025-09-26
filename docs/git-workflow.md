# Git workflow after merging PRs

codex/implement-user-capsule-upsert-service-1ryqf1
Keeping Codex in sync with GitHub’s `main` branch prevents the “same files keep coming back” merge conflicts you were seeing. Follow the Codex steps before starting a new task and repeat the local routine if you also work from a personal machine.

> **Shortcut:** Run `npm run sync:main` (or `npm run sync:main -- <feature-branch>`) inside the Codex terminal to fetch the latest commits, reset `main` to `origin/main`, and optionally create a fresh feature branch in one go. The script aborts if there are unstaged changes so you can stash or commit before syncing.


## Refresh the Codex workspace

1. In the Codex UI, open the branch selector (upper-right) and choose **Manual sync…** or **Sync from remote**.
2. Confirm the sync so Codex pulls the latest commits from GitHub. Wait for the status badge to report that `main` is up to date.
3. With `main` highlighted, select **Create branch from main**, give the feature branch a descriptive name, and continue with your task.
4. **Fallback CLI:** If the UI option is unavailable, run the following in the Codex terminal and then create the branch manually:
   ```bash
   git fetch origin
   git checkout main
   git reset --hard origin/main
   git checkout -b <new-branch-name>
   ```

Completing this sync step before each task ensures every PR starts from the current GitHub history.

## Local machine routine

codex/implement-user-capsule-upsert-service-1ryqf1

1. **Sync the local `main` branch**
   ```bash
   git fetch origin
   git checkout main
   git reset --hard origin/main
   ```
   This guarantees your local `main` matches GitHub.

2. **Create a fresh feature branch for the next task**
   ```bash
   git checkout -b <new-branch-name>
   ```
   Name the branch after the upcoming change (for example `feat/add-job-matching`).

3. **Verify the branch point**
   ```bash
   git status -sb
   git log --oneline -3
   ```
   Confirm that `HEAD` shows the latest merge commit from `main` and that no stray changes are staged.

4. **Push the branch before requesting a PR**
   ```bash
   git push -u origin <new-branch-name>
   ```
   If Codex creates the branch for you, double-check in the GitHub UI that it is based on the newest `main`.

codex/implement-user-capsule-upsert-service-1ryqf1
By repeating these routines you avoid add/add conflicts with files already merged into `main` and ensure follow-up PRs only contain new work.


