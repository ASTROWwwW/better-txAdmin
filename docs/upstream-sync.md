# Taking changes from upstream

This fork follows upstream txAdmin by taking changes one at a time, never by merging a whole branch.

## Why not merge `develop`

`develop` is where upstream builds v9 (the "gen9" / enhanced line). Its history is mostly `wip:` commits that depend on one another and on a different runtime layout (standalone runtime, new FXServer binary names, a new NUI/web split). On 2026-10-29 it was 26 commits ahead of this fork's base: 25 of them `wip:` or squashed v9 work, plus a license year bump. Merging it would bring a half finished rewrite into a tree that is meant to stay on the stable v8 line.

`master` is the stable line. `enhanced` is the branch of the enhanced builds: besides v9 work it carries fixes that are not on `master` yet (the `wmic` removal and the Windows Server distro fix of this fork were taken from there), so check both.

## The digest

```bash
scripts/upstream-digest.sh              # develop, only what is not taken yet
scripts/upstream-digest.sh master       # the stable line
scripts/upstream-digest.sh enhanced --since=2026-09-01
scripts/upstream-digest.sh develop --all   # also lists what was already taken
```

It fetches the `upstream` remote (`git remote add upstream https://github.com/tabarra/txadmin` if it is missing; it also unshallows a shallow clone, without which the comparison is wrong) and lists the upstream commits this branch does not contain. A commit is marked `taken` when its sha is quoted in a commit message of this branch, which is what `git cherry-pick -x` writes, or when git finds an identical patch.

Run it now and then, and after upstream publishes a release.

## Triage

| What the commit is | What to do |
|---|---|
| `fix(...)` on `master` or `enhanced`, security or crash fixes | Take it. |
| `feat(...)` that is self contained | Take it if wanted, with its tests. |
| `wip:` on `develop`, anything that mentions gen9, standalone runtime, new binary names | Skip, it is v9 work. |
| Dependency bumps | Skip unless a bump is wanted for its own sake (the maintainer did not want them in citizenfx/txAdmin#1152 either). |
| Locale updates | Take with `node scripts/locale-utils.js rebase` after. |

Example: `8dadafd9 fix(core): fixed linux paths` looks like a fix but only changes how the gen9 binary is started, so it is skipped.

## How to take one

1. `git cherry-pick -x <sha>` keeps the author and writes the `(cherry picked from commit ...)` trailer the digest looks for. If a conflict has to be resolved by hand, keep the trailer. If the change is ported by hand instead, quote the upstream sha (7 characters are enough) in the commit message.
2. Write or keep the tests first. Run the repo command: `npm run test --workspaces` with the `.env` from `.github/workflows/run-tests.yml`, and `npm run typecheck`.
3. If the change adds a guard (a check that refuses something), prove the test fails when the guard is removed.
4. Do not take dependency bumps, lockfile churn or version changes with it.
5. Re-run the digest: the commit must now show as `taken`.

## Not taken, on purpose

- The v9 `wip:` line on `develop` (see above).
- The dependency bumps of citizenfx/txAdmin#1152, only its session cookie change was taken, rewritten.
- Anything depending on `txEnv.fxsIsGen9`.
