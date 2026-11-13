#!/usr/bin/env bash
# episode-draft.yml's narration stage (C8): voices episodes/$ISSUE into $OMNIBUS_MEDIA_ROOT/$ISSUE/voice (the folder
# the render job lays out, which voice.json records as its media root) and hands the takes, the manifest and the
# report to $STAGE (default /home/runner/stage/narration).
#
# The committed manifest is removed before voicing, and pipefail makes a failing voice_episode fail the stage
# through its tee: a voicing that fails leaves no voice.json, here or in the hand-off, never the laptop's.
# PYTHON names the interpreter (tests point it at a stand-in).
set -euo pipefail
: "${ISSUE:?}" "${OMNIBUS_MEDIA_ROOT:?}"
STAGE="${STAGE:-/home/runner/stage/narration}"
PY="${PYTHON:-python}"
bash scripts/ci/meter.sh mark narration
manifest="episodes/$ISSUE/audio/voice.json"
rm -f "$manifest" "$STAGE/voice.json"
mkdir -p "$STAGE/reports"
"$PY" -m studio.news.voice_episode "episodes/$ISSUE" --media-root "$OMNIBUS_MEDIA_ROOT/$ISSUE/voice" --threads 4 \
  | tee "$STAGE/reports/narration.json"
test -s "$manifest"
cp -r "$OMNIBUS_MEDIA_ROOT/$ISSUE/voice" "$STAGE/media"
cp "$manifest" "$STAGE/voice.json"
du -sh "$STAGE"
