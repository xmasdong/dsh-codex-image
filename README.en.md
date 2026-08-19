# dsh-codex-image-bridge

> English | [中文](README.md)

Give [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) **vision**: the agent can not only read and write text — it can **generate images, edit images, and understand images**.

## What it does

| Capability | Tool | Description |
| --- | --- | --- |
| 🎨 **Generate** | `codex_image_generate` | Turn a plain-language prompt into a PNG (character art, icons, concept art, game assets…) |
| ✏️ **Edit** | `codex_image_edit` | Take an existing image, keep the subject/style intact, change only the details you specify, and produce a variant |
| 👁 **Understand** | `codex_image_describe` | Let the model "see" a local image: describe its content, spot rendering problems, answer questions about the picture |
| 🔌 **Check** | `codex_image_auth_status` | Verify the image service login so you know generation can start |

Generated/edited images appear **inline in the conversation result** and are also saved to disk (default `outputs/`) for later reuse or downstream pipelines.

## Installation

Prerequisites: image-service scripts available at `skillDir` (a directory containing `scripts/`, default `~/.claude/skills/codex-image-bridge`, configurable), and a valid service login (`node <skillDir>/scripts/cli.mjs auth` should return an `account`).

This project is an official composition bundle — pick any of the three official install paths:

```bash
# 1. npm package (pre-built lib/, no build permission needed)
dsh plugin --profile web add dsh-codex-image-bridge

# 2. Directly from GitHub (fetches source; first install needs an
#    allowBuilds entry in pnpm-workspace.yaml to run the prepare build)
dsh plugin --profile web add github:xmasdong/dsh-codex-image#<commit-sha>

# 3. tarball (npm pack output, also no build permission needed)
npm pack
dsh plugin --profile web add ./dsh-codex-image-bridge-0.1.0.tgz
```

GitHub installs require the following `allowBuilds` grant in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-codex-image-bridge: true
```

The bundle is appended to the profile's `dsh.profile.bundles` on install; `dsh plugin --profile web remove dsh-codex-image-bridge` uninstalls. Override configuration in the profile's `cordis.patch.yml` by row id `codex-image-bridge` (hot-reloaded by patch-layer HMR).

For local development without installing, use the overlay flow: `dsh web --patch ./cordis.patch.yml` with the plugin row referencing the source absolute path (see the header comment in `cordis.patch.yml`).

## Configuration

Override via `config:` in the patch entry (defaults come from the Config schema and environment fallbacks):

| Field | Default | Description |
| --- | --- | --- |
| `skillDir` | `~/.claude/skills/codex-image-bridge` | Local scripts directory (dynamically imported from `scripts/` at runtime) |
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
bash setup.sh        # dev only: symlink $DSH_HOME/profiles/node_modules into node_modules
npm run typecheck    # tsc --noEmit
npm run build        # build lib/ (bundle publish artifact)
npm run smoke        # offline smoke test: loads the plugin, asserts the 4 tools register (no Codex connection)
```

See `scripts/` and the skill's SKILL.md for real end-to-end verification (requires a Codex login).

## Publishing (composition bundle)

```bash
npm login            # once
npm version patch    # or minor/major; creates the git tag
npm publish          # the prepare hook builds lib/ before publishing
```

The package declares its config layer via `dsh.bundle.patch` in `package.json`; `cordis.patch.yml` references the plugin entry by package name (`dsh-codex-image-bridge`), so users get all four `codex_image_*` tools after install. Verify in a scratch profile before publishing: `dsh plugin --profile demo add ./` + `dsh --profile demo --dump-config`.

## Design Notes

- Outputs declare a canonical value with `output.schema` (JSON Schema); `output.render` is a pure projection to model content (text + `image` content block).
- `inject: ['tools', 'attachments']` — the framework guarantees both services are ready before `apply` runs.
- No tool-level `timeoutMs` is declared: generation duration is left to the skill's internal turn timeout rather than a hard harness abort, so a Codex thread is never killed mid-flight.
- Safety: never reads or prints local token files; `tokenPresent=false` does not mean generation is impossible; non-native `codex.source` results are reported honestly instead of being treated as success.

## License

[MIT](./LICENSE) © 2026 xmasdong
