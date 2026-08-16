# Contributing

Thanks for taking the time to contribute! This project follows the usual
open-source etiquette: be kind, be precise, and keep the bar high.

## Development Setup

```bash
bash setup.sh        # symlink DSH fallback packages into node_modules
npm run typecheck    # tsc --noEmit
npm run smoke        # offline smoke test (no Codex connection needed)
```

For real end-to-end verification you need a working Codex app-server login;
see the skill's SKILL.md (`node <skill-dir>/scripts/cli.mjs auth`).

## What to Keep in Mind

- **No secrets, no local paths.** Never commit absolute machine paths,
  tokens, or account data. The live profile patch
  (`~/.dsh/profiles/*/cordis.patch.yml`) is machine-local and must not be
  committed — use the generic `<REPO-ROOT>` placeholder in `cordis.patch.yml`
  instead.
- **Schema first.** Tool parameters and outputs are declared through
  `defineTool`'s schema DSL; the canonical output value must match
  `output.schema` exactly (`additionalProperties: false`).
- **Pure render.** `output.render` is a pure projection from the validated
  value; keep side effects (file writes, attachment saves) inside `execute`.
- **Strict mode.** Only native `imageGeneration` / `image_generation_call`
  counts as success. Do not weaken this without a very good reason.
- **Tests.** The offline smoke test must keep passing; add assertions when
  you change tool contracts.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add codex_image_upscale tool
fix: handle null account in auth output
docs: clarify outputDir resolution
test: assert edit parameters contract
```

## Code of Conduct

Be respectful and constructive. Harassment of any kind is not tolerated.
