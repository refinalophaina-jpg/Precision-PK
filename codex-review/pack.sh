#!/usr/bin/env bash
# Build the review package as a single archive.
#   ./codex-review/pack.sh  ->  codex-review-package-YYYY-MM-DD.tar.gz
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="$(cd "$here/.." && pwd)"
lit="$(cd "$app/.." && pwd)/Literature"
out="$app/codex-review-package-$(date +%Y-%m-%d).tar.gz"
stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
pkg="$stage/codex-review-package"; mkdir -p "$pkg/app" "$pkg/Literature"

cp "$app/index.html" "$app"/*.cjs "$app/CLAUDE.md" "$app/README.md" "$pkg/app/"
mkdir -p "$pkg/app/docs/audit"
cp "$app/docs/"*.md "$pkg/app/docs/" 2>/dev/null || true
cp "$app/docs/audit/"*.cjs "$pkg/app/docs/audit/" 2>/dev/null || true
cp -R "$here" "$pkg/app/codex-review"
rm -f "$pkg/app/codex-review/pack.sh"
[ -d "$lit" ] && cp "$lit/"* "$pkg/Literature/" 2>/dev/null || true

# Snapshot the suites so the reviewer sees the expected baseline.
{
  echo "# Baseline suite output — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo; echo "commit: $(git -C "$app" rev-parse HEAD 2>/dev/null || echo 'n/a')"
  for f in phase2d_validation phase3_simulation phase4_regimen_validation; do
    echo; echo "## $f"; (cd "$app" && node "$f.cjs" 2>&1 | tail -12)
  done
  echo; echo "## phase2d_comprehensive_validation (scenarios 3 and 4 fail by design)"
  (cd "$app" && node phase2d_comprehensive_validation.cjs 2>&1 | tail -24)
} > "$pkg/app/codex-review/context/BASELINE.txt" 2>&1 || true

tar -czf "$out" -C "$stage" codex-review-package
echo "wrote $out"
echo "contents:"; tar -tzf "$out" | head -40
