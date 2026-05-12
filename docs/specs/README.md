# Feature Specifications

This directory contains specifications for non-trivial features of
Vigil. Each spec is written _before_ the feature is implemented and
describes goals, inputs, outputs, edge cases, and acceptance criteria.

See [`CLAUDE.md`](../../CLAUDE.md) § "What to do before writing code"
for when a spec is required.

## When to write a spec

Write a spec when a feature is non-trivial enough that "just code it"
risks shipping the wrong thing. Specifically:

- The feature touches more than one module.
- The feature has externally observable behavior with edge cases.
- The feature requires UI design or product decisions.
- The work will take more than a day or two.

Skip the spec for small, contained changes (bug fixes, refactors,
isolated utility functions, dependency bumps).

## Format

Each spec is a markdown file with sections like:

- **Goal** — what success looks like for this feature
- **Inputs** — what the feature receives
- **Outputs** — what it produces
- **Behavior** — how it works, including edge cases
- **Acceptance criteria** — a checklist that can be verified
- **Related** — links to relevant ADRs and other specs

See [`docs/adr/README.md`](../adr/README.md) for a comparison: ADRs
record _decisions_, specs record _features_.

## Index

| Spec                                        | Phase | Status                   |
| ------------------------------------------- | ----- | ------------------------ |
| [auth-azure-devops](./auth-azure-devops.md) | 1     | Ready for implementation |
| [observability](./observability.md)         | 1.5   | Ready for implementation |
