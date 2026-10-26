#!/usr/bin/env bash
set -euo pipefail
REPO="softm/matjiphannun"
command -v gh >/dev/null || { echo 'GitHub CLI(gh)가 필요합니다: https://cli.github.com/'; exit 1; }
gh auth status >/dev/null
cd "$(dirname "$0")"
if [ ! -d .git ]; then git init -b main; fi
git add .
if ! git diff --cached --quiet; then git commit -m 'feat: initial 맛집한눈 PWA and source-backed insights'; fi
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public --source . --remote origin --push
else
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/${REPO}.git"
  git push -u origin main
fi
cat <<END
완료: https://github.com/${REPO}
GitHub Pages: Settings > Pages > Source=GitHub Actions 를 선택하십시오.
예정 웹 주소: https://softm.github.io/matjiphannun/
END
