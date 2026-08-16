# dsh-codex-image-bridge

A [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) plugin that adapts the local `codex-image-bridge` skill (image generation through the Codex app-server / managed ChatGPT login) into four native harness tools. The skill is a self-contained bundle of scripts — this plugin only needs a checkout of its `scripts/` directory (see `skillDir` below).

Built following the official docs — [Your First Plugin](https://deepseek-harness.github.io/deepseek-harness/develop/basic/), [Developing a Tool](https://deepseek-harness.github.io/deepseek-harness/develop/basic/tool), [Plugin Configuration](https://deepseek-harness.github.io/deepseek-harness/develop/basic/config): a plugin is a TypeScript module exporting `apply(ctx, config)` that registers capabilities through `ctx.tools.register(defineTool(...))`; configuration is validated with a Schemastery schema.

## Tools

| Tool | Description |
| --- | --- |
| `codex_image_auth_status` | Check whether the Codex app-server managed login is available (account / token state) |
| `codex_image_generate` | Generate a PNG through native model image generation (strict mode: only `image_generation_call` / `imageGeneration` counts as success; tool/code fallbacks are never treated as success) |
| `codex_image_edit` | Regenerate a variant using a source (mother) image as visual reference (reference-image regeneration, not pixel-level in-place editing or masked inpainting) |
| `codex_image_describe` | Ask the Codex vision model to describe a local PNG (plain text; no generation) |

Generated/edited images are written to disk **and** committed to the harness attachment store (`ctx.attachments.saveImage`), so the GUI shows the image inline in the tool result.

## Installation

Prerequisites: a local `codex-image-bridge` skill checkout with `scripts/` (the skill is self-contained — see its SKILL.md), and a working Codex app-server login (`node <skill-dir>/scripts/cli.mjs auth` should return an `account`).

```bash
# 1. Make the plugin's @deepseek-ai/* imports resolvable:
#    symlinks the DSH flat fallback ($DSH_HOME/profiles/node_modules) into
#    this project's node_modules, matching the running harness versions exactly.
bash setup.sh

# 2. Register the plugin in the live profile (hot-reloaded, no restart):
#    append the insert below to ~/.dsh/profiles/web/cordis.patch.yml
#    (or use it as a --patch overlay — see cordis.patch.yml)
- insert:
    - id: codex-image-bridge
      name: '/absolute/path/to/dsh-codex-image/src/index.ts'
```

`cordis.patch.yml` is watched by the harness patch-layer HMR: saving it re-composes the plugin tree and loads the plugin immediately (Settings → plugin inventory shows `include:codex-image-bridge`).

## Configuration

Override via `config:` in the patch entry (defaults come from the Config schema and environment fallbacks):

| Field | Default | Description |
| --- | --- | --- |
| `skillDir` | `~/.claude/skills/codex-image-bridge` | Skill directory (scripts are dynamically imported from `scripts/`) |
| `outputDir` | `''` → `<skillDir>/outputs` | Where generated PNGs are written |
| `threadModel` | `CODEX_THREAD_MODEL` → `gpt-5.5` | Codex thread model for generation/edit |
| `timeoutMs` | `120000` | Timeout for one generation/edit turn |
| `command` | `CODEX_COMMAND` → `codex` | Codex CLI command |
| `sandbox` | `CODEX_IMAGE_SANDBOX` → `danger-full-access` | Codex thread sandbox (must match the App's native image path) |
| `acceptToolImages` | `false` | Diagnostics only: accept tool-returned PNGs (not native success) |
| `visionModel` | `CODEX_VISION_MODEL` → `gpt-5.5` | Vision model used by the describe tool |
| `visionTimeoutMs` | `180000` | Timeout for one describe turn |

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run smoke       # offline smoke test: loads the plugin, asserts the 4 tools register (no Codex connection)
```

See `scripts/` and the skill's SKILL.md for real end-to-end verification (requires a Codex login).

## Design Notes

- Outputs declare a canonical value with `output.schema` (JSON Schema); `output.render` is a pure projection to model content (text + `image` content block).
- `inject: ['tools', 'attachments']` — the framework guarantees both services are ready before `apply` runs.
- No tool-level `timeoutMs` is declared: generation duration is left to the skill's internal turn timeout rather than a hard harness abort, so a Codex thread is never killed mid-flight.
- Safety: never reads or prints local token files; `tokenPresent=false` does not mean generation is impossible; non-native `codex.source` results are reported honestly instead of being treated as success.

## License

[MIT](./LICENSE) © 2026 xmasdong
