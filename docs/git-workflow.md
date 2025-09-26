# Git workflow after merging PRs

Follow these steps immediately after a pull request is merged so that new Codex branches always start from the latest `main` commit:

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

By repeating this routine you avoid add/add conflicts with files already merged into `main` and ensure follow-up PRs only contain the new work.
