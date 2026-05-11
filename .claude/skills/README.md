# Claude Code Skills

This directory contains [Claude Code](https://www.anthropic.com/claude-code)
skills that travel with this repository. Skills are reusable patterns
of interaction that Claude Code can invoke during a session.

Project-scoped skills (in `.claude/skills/`) take precedence over
user-scoped skills (in `~/.claude/skills/`).

## Installed skills

### `grill-with-docs`

A structured interview pattern for stress-testing plans before
implementation. Source:
[mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs).

**When to invoke:**

- Writing a new spec under `docs/specs/`.
- Stress-testing a plan before committing to an implementation
  approach.
- Resolving fuzzy or overloaded domain language.
- Considering whether a decision warrants an ADR.

**What it does:**

- Interviews the user one question at a time.
- Challenges terminology against `CONTEXT.md`.
- Stress-tests relationships with concrete scenarios.
- Updates `CONTEXT.md` and `docs/adr/` inline as decisions
  crystallize.
- Applies a strict three-rule criteria for ADR creation:
  hard-to-reverse, surprising-without-context, real-trade-off.

**How to invoke:** In Claude Code, say something like
*"Use grill-with-docs to stress-test my plan for [X]."*
Claude Code will load the skill and switch into interrogation mode.

## Adding a new skill

To add a skill to this directory:

1. Create a subdirectory: `.claude/skills/your-skill-name/`
2. Add a `SKILL.md` with frontmatter (`name`, `description`, and
   optionally `disable-model-invocation`).
3. Add any supporting files the skill references.
4. Document it in this README.
5. Add a `CHANGELOG.md` entry.

## License notes

Third-party skills are used under their respective licenses. See the
source repository linked next to each skill above for details.
