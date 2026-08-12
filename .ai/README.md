# AI Guidance Source

This directory is the source of truth for repository-specific AI guidance.

## Structure

- `project-guidance.md`: always-on repository context and safety boundaries.
- `skills/*/SKILL.md`: reusable workflows loaded when their descriptions match.
- `skills/*/agents/openai.yaml`: Codex skill-list metadata where provided.
- `agents/*.md`: read-only review-agent definitions.
- `meta/*.yaml`: generated-index descriptions and skill names.
- `generated-outputs.txt`: tracked manifest of paths owned by the sync script.
- `sync.sh`: publishes canonical content to supported assistant directories.

## Workflow

1. Edit canonical content under `.ai/`.
2. Keep skill frontmatter and matching `.ai/meta/*.yaml` aligned.
3. Run `bash .ai/sync.sh`.
4. Review canonical changes, generated root `AGENTS.md`, and local tool
   projections.
5. Validate changed skills and run `git diff --check`.

Do not edit generated `.codex`, `.claude`, `.cursor`, `.gemini`, `.roo`, or root
guidance directly. Tool-specific directories are gitignored local output; root
`AGENTS.md` is generated and tracked. Add repository-specific behavior to
canonical guidance rather than changing one generated copy.

Before generation, the sync script removes only paths listed in its previous
tracked `generated-outputs.txt` manifest, validates that every path is inside a
known generated namespace, and writes the new manifest. This prevents deleted
or renamed canonical guidance from remaining active as stale ignored output
without deleting unrelated configuration from shared tool directories.
