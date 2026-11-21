#!/usr/bin/env bash
# episode-draft.yml's R2 calls (C8), through the AWS CLI on the runner against the account's R2 endpoint. Needs
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (the R2 token) and R2_ACCOUNT_ID, set on the calling step only.
#   scripts/ci/r2.sh put <dir> <prefix>   # refused (exit 2) past budget.yaml's cap for render/, else synced
#   scripts/ci/r2.sh get <prefix> <dir>
#   scripts/ci/r2.sh rm <prefix>
set -euo pipefail
B=omnibus-capture
EP="https://${R2_ACCOUNT_ID:?}.r2.cloudflarestorage.com"
export AWS_DEFAULT_REGION=auto
case "${1:-}" in
  put)
    listed=$(aws s3 ls "s3://$B/render/" --recursive --summarize --endpoint-url "$EP" | awk '/Total Size:/{print $3}')
    node scripts/episode-draft.mjs r2-cap "$2" --listed "${listed:-0}"
    aws s3 sync "$2" "s3://$B/$3" --only-show-errors --endpoint-url "$EP" ;;
  get) aws s3 sync "s3://$B/$2" "$3" --only-show-errors --endpoint-url "$EP" ;;
  rm) aws s3 rm "s3://$B/$2" --recursive --only-show-errors --endpoint-url "$EP" ;;
  *) echo "usage: r2.sh put <dir> <prefix> | get <prefix> <dir> | rm <prefix>" >&2; exit 2 ;;
esac
