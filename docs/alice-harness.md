# Alice Harness injection

Alice Project provides CLI runtime capabilities and companion Skills independently
of the Workspace Harness. Workspace CLI switches and Skill inclusion preferences
are separate; only copied Skill files need an explicit Workspace update. Chat template versions, AutoQuant source pins, and
Auto Prediction source pins do not version this injection layer.

## Version authority

`default/alice-harness.json` declares the Project's injection release version.
Its effective revision appends a content fingerprint of the complete owned Skill
trees only. CLI implementation/registry changes do not change this file-bundle
revision; update the Skills documentation and its release when the contract changes. Updating these assets does not require
bumping a Chat/AQ/AP template version.

Each newly created Workspace records accepted state at
`.alice/alice-harness-version.json` (schemaVersion, template=alice-harness,
appliedVersion, appliedAt, source, per-Skill skillVersions and optional upgrade commit). It is local
bookkeeping excluded from Workspace Git, alongside the compressed three-way
baseline and recovery journal under `.alice/alice-harness-upgrade/`.
The actual executable/tool implementation remains provided by the running
Project. The accepted revision does not pin an old binary. Status surfaces show
accepted and available revisions separately.

## Ownership

Alice Harness owns complete trees for `alice`, `alice-analysis`, `alice-uta`,
`traderhub`, and `self-scheduling`, plus removal/reconciliation of legacy
`alice-workspace` copies. `.agents/skills` is primary and `.claude/skills` is its
runtime mirror; old `.pi/skills` duplicates are included only for reconciliation.
Template-declared instructions, README and other bundled Skills remain template
owned. Existing template baselines may contain these trees, but template plans
exclude Alice-owned paths. Source upgrades remain ordinary upstream Git merges
and do not advance Alice injection metadata.

## Workspace configuration

`.alice/alice-harness-config.json` is Workspace-owned, tracked configuration.
Omitted CLI entries are enabled. A CLI-wide disable wins over group switches:

```json
{
  "schemaVersion": 1,
  "skills": { "traderhub": false },
  "cli": {
    "alice": { "groups": { "rss": false } },
    "alice-uta": { "enabled": false }
  }
}
```

First-version granularity is CLI and command group. The gateway reads current
configuration for both discovery and invocation, including the legacy Workspace
export. Disabled tools return 403; malformed configuration fails closed with a
configuration error. This is customization of Workspace capabilities, not a
sandbox against an Agent allowed to edit its own files. UTA permission and
trading-write authority remain unchanged.

Saving configuration applies CLI switches immediately but does not overwrite
Skill files. `skills` is an optional name-to-boolean inclusion map. Omitted
entries follow the template's original default (`injectTools`, plus the always
included self-scheduling Skill); explicit inclusion/exclusion overrides that
default. CLI switches never add or remove Skills, and excluding a Skill never
disables commands. A later update reconciles excluded files, with local edits
requiring review rather than silent deletion. Exclusions remain in effect until
the Workspace changes its preference. They never remove the Project prototype:
re-enabling a Skill restores its files on the next update, even at the same bundle
revision and with its CLI disabled.

## Independent upgrade

Project Settings → Workspace injection owns the Project CLI catalog, source Skills
browser, Workspace update inventory and batch updates. Batch updates use the
displayed digests and skip busy/conflicting entries; each Workspace succeeds or
fails independently. Workspace details owns CLI/Skill preferences and a link to
Project management. Unversioned matching files need only a baseline/version
record; differing files enter the same update review. The Project catalog API is `/api/workspaces/alice-harness/catalog`. Per-Workspace
APIs are `/api/workspaces/:id/alice-harness`,
`PUT .../alice-harness/config`, and `GET/POST .../alice-harness-upgrade`.
The CLI offers `alice harness upgrade` and `alice harness upgrade --apply`, with
`--id` for a peer and the same per-file conflict flags as template upgrades.

The shared managed-file engine provides checkout serialization, active-Session
and staged-index blockers, exact preview digests, atomic file replacements,
Git commit, rollback and committed-transaction recovery. Configuration is part
of the preview digest and never overwritten by upgrade. Both upgrade layers
recover before scheduled work starts.

Existing Workspaces are unversioned until explicitly adopted. First preview
uses the legacy root-commit baseline; unknown or customized content is preserved
or reviewed as a conflict. No startup rewrite or bulk migration changes user
files. First successful adoption creates a missing default configuration through the same reviewed transaction and records the independent baseline and revision.

## Skill prototypes and Workspace copies

Settings → Workspace injection opens a Workspace-first Skill list with injected
and Project versions beside each status. Select a Workspace, search Skills and
expand a row for file comparison. The separate Project prototype view remains
read-only; full-bundle batch updates live under a disclosure. Project
sources remain visible when a Workspace excludes or removes its copy. Each
prototype shows installed state, local customization, source changes and missing
or divergent runtime mirrors. File comparison loads on demand; unverified and
truncated entries remain explicit. Catalog responses carry summaries rather
than repeating every Workspace file body.

Install, remove, update and restore operate on a **single Skill**. Each action
previews exact files and commits its retention preference together with those
files under the existing checkout lease/journal. CLI switches are preserved.
Update uses three-way comparison; restore explicitly replaces the selected
Skill with the Project prototype after review. Both `.agents` and `.claude`
copies belong to that identity; local divergence is displayed, not silently
assumed equal. A restore reconciles both copies to the prototype.

Scoped operations merge only that Skill into the stored baseline and leave the
whole-bundle applied revision unchanged. Other Skill baselines are retained;
only a whole-bundle update records the Project bundle revision. This avoids
claiming that installing one Skill updated the rest of a Workspace. On legacy
Workspaces, scoped adoption records an `unversioned` bundle until the bundle is
reviewed. Each retained Skill also records its accepted Project revision and timestamp
in `skillVersions[name] = { version, appliedAt }`. Scoped operations update only
that entry; removal clears it. Full injection records every retained Skill.
The UI displays the release and a short fingerprint, with the full value on hover.
Older records without per-Skill metadata show an unknown injected version, even
when current files match. Local edits remain a separate status; the recorded
revision describes the accepted source baseline. The journal carries scoped
revision metadata so committed recovery preserves the same bookkeeping.

`GET /api/workspaces/:id/alice-harness/skills/:skill` supplies a detailed copy
comparison. The existing upgrade preview accepts `?skill=<name>&action=<action>`;
apply supplies the same `{ skill, action }` as `projection`, plus the exact plan
digest and conflict resolutions. Supported actions are `install`, `update`,
`remove` and `restore`. Preview is read-only; stale files or config invalidate
apply. Failures before commit restore both files and preferences.
