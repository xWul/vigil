# Analyzer config stored in userData per-repo, not in the git repository

Static analyzer configuration (thresholds, enable/disable per pass) is stored as JSON
in Electron's `userData` directory, keyed by repo identifier (`{platform}/{owner}/{repo}`),
rather than in a `.vigilrc` file committed to the repository being reviewed.

## Context

Vigil has read-only access to repositories — it can fetch file content via the platform API
and via `RepoCache`, but it cannot commit or push. A `.vigilrc` file in the repo root would
be the natural home for project-level analysis conventions, but writing it back requires
git commit + push flows that don't exist in Vigil today.

## Decision

Config lives in `userData`. The workspace UI edits it directly with no git involvement.
An "Export as .vigilrc" button copies the current config as JSON to the clipboard so teams
can commit it to their repo manually. Auto-reading `.vigilrc` from the repo at review time
is deferred to a future phase (requires one extra `getFileContent` API call per review and
merge logic for the two-source read order).

## Considered alternatives

- **Auto-read from repo now**: adds an API call per review, parse-error handling for
  malformed committed JSON, and a two-source merge algorithm. Deferred — deliver the
  config UI first, add team sharing once it proves useful.
- **Two-layer config (global user defaults + per-repo overrides)**: full VSCode model.
  Rejected because solo users don't need global defaults separate from per-project config,
  and the merge UI ("this value is overridden by the repo") adds meaningful complexity.
- **Config in the global Settings screen**: requires a repo picker (a concept Vigil doesn't
  have today). Config is per-repo and contextual — the natural access point is the workspace,
  while the user is reviewing a PR from that repo.
