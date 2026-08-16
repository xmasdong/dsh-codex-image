/**
 * dsh-codex-image-bridge
 *
 * A DeepSeek Harness plugin that adapts the local `codex-image-bridge` skill
 * (see ~/.claude/skills/codex-image-bridge) to the harness tool registry.
 *
 * It registers four model-facing tools:
 *   - codex_image_auth_status  — check the Codex app-server managed login
 *   - codex_image_generate     — generate a PNG through Codex
 *   - codex_image_edit         — regenerate a variant from a source/mother image
 *   - codex_image_describe     — ask the Codex vision model to describe a PNG
 *
 * The generation/edit tools write the PNG to disk and additionally commit it
 * to the harness attachment store, so the GUI shows the image inline in the
 * tool result.
 *
 * Safety notes inherited from the skill:
 *   - never read or print local Codex token files
 *   - strict mode: only native image_generation_call / imageGeneration or the
 *     explicit built-in image_gen output counts as success (acceptToolImages
 *     stays false by default)
 *   - tokenPresent=false does not mean generation is impossible
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { AttachmentId, ImageMediaType } from '@deepseek-ai/dsh-attachment'

export const name = 'dsh-codex-image-bridge'

/** Services this plugin needs before it can register tools. */
export const inject = ['tools', 'attachments']

export interface Config {
  /** Directory containing the codex-image-bridge skill (SKILL.md + scripts/). */
  skillDir: string
  /** Where generated PNGs are written. Empty string derives `<skillDir>/outputs`. */
  outputDir: string
  /** Codex thread model used for generation/edit; empty falls back to CODEX_THREAD_MODEL, then gpt-5.5. */
  threadModel: string
  /** Timeout for one Codex generation/edit turn, in milliseconds. */
  timeoutMs: number
  /** Codex CLI command used to reach the app-server. */
  command: string
  /** Codex thread sandbox; must match the native app-server image path (danger-full-access). */
  sandbox: string
  /** Accept PNGs returned by other tools as generation success (diagnostics only). */
  acceptToolImages: boolean
  /** Codex vision model used by the describe tool. */
  visionModel: string
  /** Timeout for one describe turn, in milliseconds. */
  visionTimeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  skillDir: Schema.string().default(join(homedir(), '.claude', 'skills', 'codex-image-bridge')),
  outputDir: Schema.string().default(''),
  threadModel: Schema.string().default(process.env.CODEX_THREAD_MODEL ?? 'gpt-5.5'),
  timeoutMs: Schema.number().default(120000),
  command: Schema.string().default(process.env.CODEX_COMMAND ?? 'codex'),
  sandbox: Schema.string().default(process.env.CODEX_IMAGE_SANDBOX ?? 'danger-full-access'),
  acceptToolImages: Schema.boolean().default(false),
  visionModel: Schema.string().default(process.env.CODEX_VISION_MODEL ?? 'gpt-5.5'),
  visionTimeoutMs: Schema.number().default(180000),
})

// ---------------------------------------------------------------------------
// Typed views of the skill's untyped .mjs service layer
// ---------------------------------------------------------------------------

/** Free-form codex metadata; treated as opaque JSON in the canonical value. */
type CodexMeta = Record<string, JsonValue>

interface GeneratedImage {
  filePath: string
  uri: string
  mimeType: string
  width: number
  height: number
  sizeBytes: number
  sha256: string
  codex: Record<string, unknown>
}

interface AuthStatus {
  account: string | null
  authMethod: string | null
  requiresOpenaiAuth: boolean | null
  tokenPresent: boolean
  tokenLength: number | null
  userAgent: string | null
}

interface ImageService {
  getAuthStatus(options?: Record<string, unknown>): Promise<AuthStatus>
  generateImageFile(options?: Record<string, unknown>): Promise<GeneratedImage>
}

/** Durable attachment reference projected into the lossless canonical value. */
type AttachmentInfo = {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name: string
}

/** Canonical value of the generate/edit tools (matches the output schema exactly). */
type ImageOutput = {
  filePath: string
  uri: string
  mimeType: string
  width: number
  height: number
  sizeBytes: number
  sha256: string
  attachment?: AttachmentInfo
  codex: JsonValue
}

/** Canonical value of the auth tool (matches the output schema exactly). */
type AuthOutput = {
  ok: boolean
  /** Account descriptor: an object ({type, email, planType}) or null when signed out. */
  account: JsonValue
  authMethod: string | null
  requiresOpenaiAuth: boolean | null
  tokenPresent: boolean
  tokenLength: number | null
  userAgent: string | null
}

const serviceCache = new Map<string, Promise<ImageService>>()

function loadService(skillDir: string): Promise<ImageService> {
  let pending = serviceCache.get(skillDir)
  if (!pending) {
    const script = join(skillDir, 'scripts', 'image-service.mjs')
    pending = import(pathToFileURL(script).href) as Promise<ImageService>
    serviceCache.set(skillDir, pending)
  }
  return pending
}

const execFileAsync = promisify(execFile)

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function text(text: string): ContentBlock {
  return { type: 'text', text }
}

/** The generate/edit output schema, shared by both tools. */
const imageOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    filePath: { type: 'string', required: true },
    uri: { type: 'string', required: true },
    mimeType: { type: 'string', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    sizeBytes: { type: 'integer', required: true },
    sha256: { type: 'string', required: true },
    attachment: {
      type: 'object',
      additionalProperties: false,
      properties: {
        attachmentId: { type: 'string', required: true },
        mediaType: { type: 'string', required: true },
        bytes: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
        name: { type: 'string', required: true },
      },
    },
    codex: { type: 'json' },
  },
} as const

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export function apply(ctx: Context, config: Config) {
  const skillDir = resolve(config.skillDir)
  const outputDir = resolve(config.outputDir || join(skillDir, 'outputs'))
  const service = () => loadService(skillDir)
  const generationDefaults = () => ({
    threadModel: config.threadModel,
    timeoutMs: config.timeoutMs,
    command: config.command,
    sandbox: config.sandbox,
    acceptToolImages: config.acceptToolImages,
  })

  /** Shared body of generate and edit. */
  const runGeneration = async (
    args: { prompt: string; filename?: string; outputDir?: string; imagePath?: string },
    exec: { signal: AbortSignal },
  ): Promise<ImageOutput> => {
    if (exec.signal.aborted) {
      throw new Error('codex_image: cancelled before the Codex turn started')
    }
    const result = await service().then((mod) => mod.generateImageFile({
      ...generationDefaults(),
      prompt: args.prompt,
      imagePath: args.imagePath,
      outputDir: args.outputDir ? resolve(args.outputDir) : outputDir,
      filename: args.filename,
    }))
    const bytes = await readFile(result.filePath)
    let attachment: AttachmentInfo | undefined
    try {
      const ref = await ctx.attachments.saveImage({
        data: bytes,
        mediaType: 'image/png',
        name: basename(result.filePath),
      })
      attachment = {
        attachmentId: ref.attachmentId,
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        name: ref.name ?? basename(result.filePath),
      }
    } catch (error) {
      ctx.logger.warn(`[codex-image] attachment save failed: ${String(error)}`)
    }
    return {
      filePath: result.filePath,
      uri: result.uri,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
      ...(attachment ? { attachment } : {}),
      codex: result.codex as JsonValue,
    }
  }

  const renderImageOutput = (args: unknown, value: ImageOutput): ContentBlock[] => {
    const blocks: ContentBlock[] = []
    if (value.attachment) {
      blocks.push({
        type: 'image',
        attachment: {
          attachmentId: value.attachment.attachmentId as AttachmentId,
          mediaType: value.attachment.mediaType as ImageMediaType,
          bytes: value.attachment.bytes,
          width: value.attachment.width,
          height: value.attachment.height,
          name: value.attachment.name,
        },
      })
    }
    const meta = value.codex as unknown as CodexMeta
    const lines = [
      `Generated via Codex (${typeof meta.source === 'string' ? meta.source : 'unknown'}): ${value.filePath}`,
      `Dimensions: ${value.width} x ${value.height} — ${formatBytes(value.sizeBytes)}`,
      `sha256: ${value.sha256}`,
    ]
    if (typeof meta.revisedPrompt === 'string' && meta.revisedPrompt) {
      lines.push(`codex.revisedPrompt: ${meta.revisedPrompt}`)
    }
    if (typeof meta.model === 'string' && meta.model) {
      lines.push(`codex.model: ${meta.model}`)
    }
    blocks.push(text(lines.join('\n')))
    return blocks
  }

  // --- codex_image_auth_status -------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'codex_image_auth_status',
    description: 'Check whether the Codex app-server managed ChatGPT/Codex login is available for image generation. Returns the current account and token state.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          account: { type: 'json', required: true },
          authMethod: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          requiresOpenaiAuth: { oneOf: [{ type: 'boolean' }, { type: 'null' }], required: true },
          tokenPresent: { type: 'boolean', required: true },
          tokenLength: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
          userAgent: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
        },
      },
      render: (_args, value: AuthOutput) => {
        const account = value.account
        const accountText = account === null || account === undefined
          ? '(none)'
          : typeof account === 'string'
            ? account
            : typeof account === 'object'
              ? (account as { email?: unknown }).email ?? JSON.stringify(account)
              : String(account)
        const lines = [
          value.ok
            ? `Codex auth OK — account: ${accountText}`
            : `Codex auth NOT available — account: ${accountText}`,
          `tokenPresent: ${value.tokenPresent} (may be false even when generation works)`,
        ]
        if (value.authMethod) lines.push(`authMethod: ${value.authMethod}`)
        if (value.userAgent) lines.push(`userAgent: ${value.userAgent}`)
        return [text(lines.join('\n'))]
      },
    },
    async execute(_args, exec) {
      if (exec.signal.aborted) throw new Error('codex_image: cancelled before start')
      const status = await service().then((mod) => mod.getAuthStatus({
        command: config.command,
        timeoutMs: config.timeoutMs,
      }))
      return { ok: Boolean(status.account), ...status }
    },
  }))

  // --- codex_image_generate ----------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'codex_image_generate',
    description: 'Generate a PNG image through the Codex app-server using the machine\'s managed ChatGPT/Codex login. Native model image generation only; never treat tool/code output as success. The PNG is saved to disk and shown inline in the result.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'The image prompt. Be specific about style, subject, composition, and background (e.g. "full body demon silhouette, transparent background, no text").' },
      filename: { type: 'string', description: 'Output filename, e.g. "demon.png". A timestamped name is used when omitted.' },
      outputDir: { type: 'string', description: 'Directory for the generated file; defaults to the plugin configured outputDir.' },
    },
    output: {
      schema: imageOutputSchema,
      render: renderImageOutput,
    },
    async execute(args, exec) {
      return runGeneration(args, exec)
    },
  }))

  // --- codex_image_edit --------------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'codex_image_edit',
    description: 'Regenerate a PNG using a source (mother) image as visual reference through the Codex app-server. Reference-image regeneration, not pixel-level in-place editing or masked inpainting. Prompt should state what must stay unchanged and what may change.',
    parameters: {
      imagePath: { type: 'string', required: true, description: 'Path to the source PNG used as visual reference.' },
      prompt: { type: 'string', required: true, description: 'Edit prompt: name what must stay identical (identity, silhouette, palette, transparent background) and the exact change.' },
      filename: { type: 'string', description: 'Output filename, e.g. "frame-02.png". A timestamped name is used when omitted.' },
      outputDir: { type: 'string', description: 'Directory for the generated file; defaults to the plugin configured outputDir.' },
    },
    output: {
      schema: imageOutputSchema,
      render: renderImageOutput,
    },
    async execute(args, exec) {
      return runGeneration(args, exec)
    },
  }))

  // --- codex_image_describe ----------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'codex_image_describe',
    description: 'Ask the Codex vision model to read and describe a local PNG (screenshot, generated asset) via the managed ChatGPT/Codex login. Returns a plain-text description. Vision only — no image generation.',
    parameters: {
      imagePath: { type: 'string', required: true, description: 'Path to a local PNG image file to describe.' },
      prompt: { type: 'string', description: 'Optional question about the image; defaults to a detailed screenshot-description request.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [text(value)],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        throw new Error('codex_image: cancelled before start')
      }
      const script = join(skillDir, 'scripts', 'describe.mjs')
      const { stdout } = await execFileAsync(process.execPath, [
        script,
        resolve(args.imagePath),
        ...(args.prompt ? [args.prompt] : []),
      ], {
        cwd: process.cwd(),
        timeout: config.visionTimeoutMs + 15000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          CODEX_VISION_MODEL: config.visionModel,
          CODEX_VISION_TIMEOUT_MS: String(config.visionTimeoutMs),
        },
      })
      const description = String(stdout).trim()
      if (!description) {
        throw new Error('codex_image: vision returned an empty response')
      }
      return description
    },
  }))

  ctx.logger.info(`[${name}] loaded — skillDir: ${skillDir}, outputDir: ${outputDir}`)
}
