#!/usr/bin/env bash
# Download the MediaPipe Face Landmarker model into public/models/ so the app
# can run fully offline (no CDN call at runtime). Optional — the app also works
# by fetching the model from the official CDN on first load.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/public/models"
URL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

mkdir -p "$OUT"
echo "Downloading Face Landmarker model (~3.7 MB) …"
curl -L --fail -o "$OUT/face_landmarker.task" "$URL"
echo "Saved to $OUT/face_landmarker.task"
echo "Done. The app will now load the model locally instead of from the CDN."
