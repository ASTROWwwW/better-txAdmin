#!/usr/bin/env bash
# Lists what upstream txAdmin has that this fork does not, so changes can be taken one by one.
#
#   scripts/upstream-digest.sh [branch] [--since=<date>] [--all]
#
# branch   upstream branch to compare with (default: develop)
# --since  only commits newer than the date, eg --since=2026-09-01
# --all    also list the commits already taken
#
# A commit counts as taken when its sha (7+ characters) is quoted anywhere in a commit message of this
# branch (the "(cherry picked from commit ...)" trailer of git cherry-pick -x, or "ported from b4f7551"),
# or when git finds an identical patch (git log --cherry-mark). Changes adapted by hand after a conflict
# keep the trailer, so they are still recognised.
# Needs the `upstream` remote (https://github.com/tabarra/txadmin, or citizenfx/txAdmin).
set -euo pipefail

branch="develop"
since=""
show_all=0
for arg in "$@"; do
    case "$arg" in
        --since=*) since="${arg#--since=}" ;;
        --all) show_all=1 ;;
        -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*) echo "unknown option: $arg" >&2; exit 2 ;;
        *) branch="$arg" ;;
    esac
done

if ! git remote get-url upstream >/dev/null 2>&1; then
    echo "No 'upstream' remote. Add it with: git remote add upstream https://github.com/tabarra/txadmin" >&2
    exit 1
fi
# A shallow clone has no merge base, which makes the comparison wrong, so get the whole history first
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    git fetch --quiet --unshallow upstream "$branch"
else
    git fetch --quiet upstream "$branch"
fi
ref="upstream/$branch"

taken_shas="$(git log --format=%B "$(git merge-base HEAD "$ref")..HEAD" | grep -oE '\b[0-9a-f]{7,40}\b' | sort -u || true)"
is_taken_by_trailer() {
    local sha="$1" t
    while read -r t; do
        if [ -n "$t" ] && { [[ "$sha" == "$t"* ]] || [[ "$t" == "$sha"* ]]; }; then return 0; fi
    done <<< "$taken_shas"
    return 1
}

# --cherry-mark marks with '=' the commits that have an equivalent patch on the other side
log_args=(--cherry-mark --right-only --no-merges --format='%m%x09%H%x09%as%x09%s')
if [ -n "$since" ]; then log_args+=("--since=$since"); fi

total=0
new=0
echo "# Upstream digest: $ref compared with $(git rev-parse --abbrev-ref HEAD)"
echo
echo "| status | commit | date | subject |"
echo "|---|---|---|---|"
while IFS=$'\t' read -r mark sha date subject; do
    [ -z "$sha" ] && continue
    total=$((total + 1))
    status="new"
    if [ "$mark" = "=" ] || is_taken_by_trailer "$sha"; then status="taken"; else new=$((new + 1)); fi
    if [ "$status" = "taken" ] && [ "$show_all" -eq 0 ]; then continue; fi
    printf '| %s | %s | %s | %s |\n' "$status" "${sha:0:8}" "$date" "${subject//|/\\|}"
done < <(git log "${log_args[@]}" "HEAD...$ref")
echo
echo "$new new of $total commits upstream that this branch does not contain."
