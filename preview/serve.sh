#!/bin/sh
# Runs the editor in your browser with a demo journal (no Heptabase needed):
#   ./preview/serve.sh  →  http://localhost:8765/stage.html  (or /card.html for the bare card)
set -e
cd "$(dirname "$0")/.."
OUT=build/preview
rm -rf "$OUT" && mkdir -p "$OUT"
bun install --silent
bun build src/editor.js --outfile "$OUT/editor.js" --format=iife >/dev/null
cp -R src/fonts "$OUT/"
sed 's#<script src="editor.js"></script>#<script src="host.js"></script><script src="editor.js"></script>#' src/index.html > "$OUT/card.html"
cp preview/host.js preview/demo-journal.json preview/stage.html preview/social.html preview/video.html assets/icon-1024.png docs/social-preview.png docs/screenshot-shortcuts.png "$OUT/"
echo "Preview: http://localhost:8765/stage.html"
cd "$OUT" && exec python3 -m http.server 8765
