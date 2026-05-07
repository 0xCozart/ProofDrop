# Agent Instructions

Read `CLAUDE.md` in the project root for project-specific rules and constraints when it exists.
Read `docs/CODEBASE_MAP.md` for codebase orientation before searching broadly when it exists.

Machine-local tooling note: `ztk` is installed for testing only. Use `ztk run`
selectively for noisy inspection commands, but do not treat it as a default
Codex shell hook or a source of complete raw output.

<!-- apex-workflow:start -->
## Apex Workflow Harness

Use `$apex-workflow` for meaningful execution in this repo.

- Profile: `apex.workflow.json`
- Review `setup.reviewNeeded`, `setup.inferredPaths`, and `operatorCautions` before the first implementation slice.
- Select the lightest safe mode before implementation.
- For meaningful code-facing work, create or update a slice manifest under `tmp/apex-workflow/`.
- Use the configured tracker, code-intelligence, browser, and UI/UX adapters from the profile.
- Refresh this harness config from the repo root with:

```bash
node /home/sacred/code/apex-workflow/scripts/init-harness.mjs --target=. --yes --force
```

<!-- apex-workflow:end -->
