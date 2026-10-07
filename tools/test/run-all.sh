#!/usr/bin/env bash
# Run every test suite one at a time (the machine gets slow with several browsers at once).
#   tools/test/run-all.sh            # everything
#   tools/test/run-all.sh rush       # only files whose name contains "rush"
#   EXCLUDE=rush tools/test/run-all.sh   # everything except files containing "rush"
# Screenshots go to $SHOTS (default: a temp dir). Prints a pass/fail table at the end.
cd "$(dirname "$0")/../.." || exit 1
export SHOTS="${SHOTS:-$(mktemp -d)}"
export QUICK=1
filter="${1:-}"
files=(tools/test/smoke.test.js tools/test/net.test.js tools/test/app.test.js tools/test/migrate.test.js tools/test/all-games.test.js tools/test/games/*.test.js)
declare -a results
fail=0
for f in "${files[@]}"; do
  [[ -n "$filter" && "$f" != *"$filter"* ]] && continue
  [[ -n "${EXCLUDE:-}" && "$f" == *"$EXCLUDE"* ]] && continue
  start=$(date +%s)
  if [[ "$f" == *rush.test.js ]]; then
    # rush runs in two halves, like its author does
    ONLY=gen,split,leak,drop,dark timeout 2400 node "$f" > "$SHOTS/$(basename "$f").1.log" 2>&1 && \
    ONLY=race,brawl,tandem,pause,daily timeout 2400 node "$f" > "$SHOTS/$(basename "$f").2.log" 2>&1
  else
    timeout 2400 node "$f" > "$SHOTS/$(basename "$f").log" 2>&1
  fi
  code=$?
  secs=$(( $(date +%s) - start ))
  if [[ $code -eq 0 ]]; then results+=("PASS  ${secs}s  $f"); else results+=("FAIL  ${secs}s  $f   (log: $SHOTS/$(basename "$f")*.log)"); fail=1; fi
  echo "${results[-1]}"
done
echo; echo "== summary =="; printf '%s\n' "${results[@]}"
exit $fail
