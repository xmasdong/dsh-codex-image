# dsh-codex-image-bridge

> [English](README.en.md) | 中文

给 DeepSeek Harness 装上**视觉能力**：AI 助手不仅能读写文本，还能**生成图像、编辑图像、看懂图像**。

## 它能做什么

| 能力 | 工具 | 说明 |
| --- | --- | --- |
| 🎨 **生成图像** | `codex_image_generate` | 一句自然语言提示词，生成 PNG 图片（角色立绘、图标、概念图、游戏素材……） |
| ✏️ **编辑图像** | `codex_image_edit` | 以一张现有图片为基础，保持主体/风格不变，只修改指定细节，产出变体 |
| 👁 **看懂图像** | `codex_image_describe` | 让模型"看"一张本地图片：描述内容、检查渲染问题、回答关于画面细节的问题 |
| 🔌 **服务检查** | `codex_image_auth_status` | 检查图像服务登录状态，确认能否开始生成 |

生成/编辑的图片会**直接显示在会话结果里**，同时保存为本地文件（默认 `outputs/`），方便后续继续使用或交给其他流程。

## 安装

前置：图像服务脚本可用——`skillDir` 指向含 `scripts/` 的目录（默认 `~/.claude/skills/codex-image-bridge`，可配置），且服务登录有效（`node <skillDir>/scripts/cli.mjs auth` 能返回 account）。

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
| `skillDir` | `~/.claude/skills/codex-image-bridge` | 本地脚本目录（运行时从 `scripts/` 动态导入） |
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
