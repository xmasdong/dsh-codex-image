# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-16

### Added

- Initial release: `dsh-codex-image-bridge` plugin for DeepSeek Harness.
- Four native tools: `codex_image_auth_status`, `codex_image_generate`, `codex_image_edit`, `codex_image_describe`.
- Generated images are committed to the harness attachment store and shown inline in the GUI tool result.
- Schemastery `Config` schema with environment fallbacks (`CODEX_THREAD_MODEL`, `CODEX_COMMAND`, `CODEX_IMAGE_SANDBOX`, `CODEX_VISION_MODEL`).
- Official composition-bundle format (`dsh.bundle` manifest, pre-built `lib/` entry) — installable via npm, GitHub, or tarball.
- Offline smoke test (`scripts/smoke.mjs`), TypeScript type checking, and a GitHub Actions CI workflow.
