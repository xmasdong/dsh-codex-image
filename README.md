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

前置：本机已有 codex-image-bridge skill 的 `scripts/` 目录（`skillDir` 配置，默认 `~/.claude/skills/codex-image-bridge`），且 Codex app-server 可用（`node <skillDir>/scripts/cli.mjs auth` 能返回 account）。

本项目是官方组合包（bundle）格式，三种官方安装方式任选其一：

```bash
# 方式一：npm 发布包（安装的是预构建的 lib/，无需构建权限）
dsh plugin --profile web add dsh-codex-image-bridge

# 方式二：直接从 GitHub 安装（拉取源码；首次需在 pnpm-workspace.yaml 中
#         添加 allowBuilds 授权以运行 prepare 构建脚本，见下）
dsh plugin --profile web add github:xmasdong/dsh-codex-image#<commit-sha>

# 方式三：tarball（npm pack 产物，也无需构建权限）
npm pack
dsh plugin --profile web add ./dsh-codex-image-bridge-0.1.0.tgz
```

GitHub 安装的 `allowBuilds` 授权（写入该 profile 的 `pnpm-workspace.yaml`）：

```yaml
allowBuilds:
  dsh-codex-image-bridge: true
```

安装后插件自动追加进 profile 的 `dsh.profile.bundles`；`dsh plugin --profile web remove dsh-codex-image-bridge` 卸载。配置在 profile 的 `cordis.patch.yml` 中按 `id: codex-image-bridge` 覆盖（HMR 热生效）。

本地开发（不安装）时用 overlay：`dsh web --patch ./cordis.patch.yml`，插件行按源码绝对路径引用（见 `cordis.patch.yml` 头部注释）。

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
bash setup.sh        # 本地开发：把 $DSH_HOME/profiles/node_modules 符号链接进 node_modules
npm run typecheck    # tsc --noEmit
npm run build        # 构建 lib/（bundle 发布产物）
npm run smoke        # 离线冒烟：加载插件 + 断言 4 个工具注册（不连 Codex）
```

真实链路（需要 Codex 登录）验证方式见 `scripts/` 与 skill 的 SKILL.md。

## 发布（组合包）

```bash
npm login            # 一次即可
npm version patch    # 或 minor/major，自动打 tag
npm publish          # prepare 钩子自动构建 lib/ 后发布
```

包通过 `package.json` 的 `dsh.bundle.patch` 声明配置层，`cordis.patch.yml` 内按包名 `dsh-codex-image-bridge` 引用插件入口；用户安装后即获得 `codex_image_*` 四个工具。发布前建议先在临时 profile 验证：`dsh plugin --profile demo add ./` + `dsh --profile demo --dump-config`。

## 设计说明

- 输出用 `defineTool` 的 `output.schema` 声明规范值（JSON Schema），`output.render` 纯函数投影为模型内容（文本 + `image` 内容块）。
- 声明 `inject: ['tools', 'attachments']`：框架保证工具注册表与附件服务就绪后才 `apply`。
- 不声明 `timeoutMs`（工具级硬超时策略），生图时长交给 skill 内部的 turn 超时控制，避免中途强杀 Codex 线程。
- 安全：不读取/打印本地 token 文件；`tokenPresent=false` 不意味着不可生成；`codex.source` 非原生时明确报告而非假装成功。
