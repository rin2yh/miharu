# Custom Oxlint Rules

This directory contains Miharu's local Oxlint JavaScript plugin and its rule tests.

## prefer-table-driven-tests

The rule reports a warning when direct sibling tests in one describe callback have identical supported AST shapes and different primitive literal values. A test must use named Vitest imports, a static string title, an inline synchronous callback, and one expect call. Vitest calls are matched by resolved import binding, so aliases work and shadowed names are ignored. The warning is reported once at the second test in a matching group. The rule has no automatic fix.

The comparison keeps identifiers, operators, member names, and expression order. It normalizes only string, number, boolean, and null literal values. The supported AST node fields are listed explicitly in plugin.mjs; unsupported syntax is skipped.

The rule skips asynchronous callbacks, multi-statement test bodies, nested functions, assignments, updates, deletes, constructors, and common collection mutation methods. It cannot determine whether arbitrary function calls have side effects, so the warning remains advisory.

## Maintenance

- Keep custom rule source and test filenames in kebab-case.
- Register each rule in the root Oxlint configuration and choose its severity explicitly.
- Test positive and negative examples as independent table-driven cases using the configured Oxlint CLI.
- Assert diagnostic count and location so a warning in the wrong place cannot pass.
- Add cases for aliases and shadowed imports when changing Vitest call resolution.
- Document any syntax or side-effect checks added to or removed from the supported subset.
