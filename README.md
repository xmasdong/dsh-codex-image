# dsh-codex-image-bridge

DeepSeek Harness 插件：把本机 `codex-image-bridge` skill（通过 Codex app-server / 受管 ChatGPT 登录生图）适配为 Harness 的四个原生工具。skill 是自包含的脚本包，本插件只需它的 `scripts/` 目录（见下方 `skillDir` 配置）。

基于官方文档 [《第一个插件》](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) 与 [《开发一个工具》](https://deepseek-harness.github.io/deepseek-harness/develop/basic/tool) 编写：插件是一个导出 `apply(ctx, config)` 的 TypeScript 模块，通过 `ctx.tools.register(defineTool(...))` 注册工具，配置用 Schemastery schema 校验。

## 注册的工具

| 工具 | 说明 |
| --- | --- |
| `codex_image_auth_status` | 检查 Codex app-server 受管登录是否可用（账户 / token 状态） |
| `codex_image_generate` | 用原生模型生成 PNG（严格模式：只认 `image_generation_call` / `imageGeneration`，工具回退不视为成功） |
| `codex_image_edit` | 以母图（mother image）为视觉参考重绘变体（参考图再生，非像素级就地编辑/蒙版） |
| `codex_image_describe` | 用 Codex vision 模型描述本地 PNG（纯文本，不生成图） |

生成/编辑结果除了写到磁盘，还会提交到 Harness 附件库（`ctx.attachments.saveImage`），因此 GUI 的工具结果里会**内嵌显示生成的图片**。

## 安装

前置：本机已有 `~/.claude/skills/codex-image-bridge`（含 `scripts/`），且 Codex app-server 可用（`node ~/.claude/skills/codex-image-bridge/scripts/cli.mjs auth` 能返回 account）。

```bash
# 1. 让插件的 @deepseek-ai/* 依赖可解析：
#    把 $DSH_HOME/profiles/node_modules 的包以符号链接暴露到本项目 node_modules，
#    保证与运行中的 harness 版本完全一致。
bash setup.sh

# 2. 注册到当前 profile（热重载，无需重启 GUI）：
#    把下面 insert 追加到 ~/.dsh/profiles/web/cordis.patch.yml
#    （也可以复制到任何 profile 或作为 --patch 覆盖层，见 cordis.patch.yml）
- insert:
    - id: codex-image-bridge
      name: '/absolute/path/to/dsh-codex-image/src/index.ts'
```

`cordis.patch.yml` 被 harness 的 patch-layer HMR 监听：保存后插件树自动重组，插件即被加载（Settings → 插件清单可见 `include:codex-image-bridge`）。

## 配置

在 patch 的 `config:` 中覆盖（默认值来自 Config schema 与环境变量回退）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `skillDir` | `~/.claude/skills/codex-image-bridge` | skill 目录（脚本从 `scripts/` 动态导入） |
| `outputDir` | `''` → `<skillDir>/outputs` | 生成 PNG 的落盘目录 |
| `threadModel` | `CODEX_THREAD_MODEL` → `gpt-5.5` | Codex 生图 thread 模型 |
| `timeoutMs` | `120000` | 单次生图/编辑 turn 超时 |
| `command` | `CODEX_COMMAND` → `codex` | Codex CLI 命令 |
| `sandbox` | `CODEX_IMAGE_SANDBOX` → `danger-full-access` | Codex thread 沙盒（匹配 App 原生生图链路） |
| `acceptToolImages` | `false` | 诊断用：接受工具回传的 PNG（非原生成功） |
| `visionModel` | `CODEX_VISION_MODEL` → `gpt-5.5` | describe 用模型 |
| `visionTimeoutMs` | `180000` | describe 超时 |

## 开发与验证

```bash
npm run typecheck   # tsc --noEmit
npm run smoke       # 离线冒烟：加载插件 + 断言 4 个工具注册（不连 Codex）
```

真实链路（需要 Codex 登录）验证方式见 `scripts/` 与 skill 的 SKILL.md。

## 设计说明

- 输出用 `defineTool` 的 `output.schema` 声明规范值（JSON Schema），`output.render` 纯函数投影为模型内容（文本 + `image` 内容块）。
- 声明 `inject: ['tools', 'attachments']`：框架保证工具注册表与附件服务就绪后才 `apply`。
- 不声明 `timeoutMs`（工具级硬超时策略），生图时长交给 skill 内部的 turn 超时控制，避免中途强杀 Codex 线程。
- 安全：不读取/打印本地 token 文件；`tokenPresent=false` 不意味着不可生成；`codex.source` 非原生时明确报告而非假装成功。
