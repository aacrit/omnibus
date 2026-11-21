#!/usr/bin/env bash
# The episode-draft jobs' meter (C8): RAM and root-disk use sampled every 5 s, stage marks, and a summary table.
#   scripts/ci/meter.sh start <stage>   # starts the sampler (once per job) and marks the first stage
#   scripts/ci/meter.sh mark <stage>    # marks the next stage
#   scripts/ci/meter.sh report <job>    # appends the job's table to $GITHUB_STEP_SUMMARY
set -eu
METER="${METER:-$HOME/meter.log}"
case "${1:-}" in
  start)
    nohup bash -c 'while :; do echo "$(date +%s) $(free -m | awk "/^Mem:/{print \$3}") $(df -BM --output=used / | tail -1 | tr -dc 0-9)" >> "'"$METER"'"; sleep 5; done' > /dev/null 2>&1 &
    echo "$(date +%s) STAGE ${2:?stage}" >> "$METER" ;;
  mark)
    echo "$(date +%s) STAGE ${2:?stage}" >> "$METER" ;;
  report)
    [ -f "$METER" ] || exit 0
    echo "$(date +%s) STAGE end" >> "$METER"
    {
      echo "### ${2:-job} meter"; echo
      echo "| stage | wall | peak RAM used | peak root disk used |"; echo "|---|--:|--:|--:|"
      awk '$2=="STAGE"{ if (name!="") printf "| %s | %d s | %d MiB | %d MiB |\n", name, $1-t0, pm, pd; name=$3; t0=$1; pm=0; pd=0; next }
           { if ($2>pm) pm=$2; if ($3>pd) pd=$3 }' "$METER"
    } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}" ;;
  *) echo "usage: meter.sh start <stage> | mark <stage> | report <job>" >&2; exit 2 ;;
esac
