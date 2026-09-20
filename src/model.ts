import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { ASRModelInfo, AsrEngine, TranscribeOptions } from './types.js';

export function getPackageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}

export const DEFAULT_MODEL: ASRModelInfo = {
  id: 'sensevoice-small-q8',
  name: 'SenseVoice Small Q8 (GGUF 极速)',
  engine: 'gguf',
  fileName: 'SenseVoiceSmall-Q8_0.gguf',
  sizeBytes: 252684608,
  sha256: '6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29',
  modelScopeURL: 'https://modelscope.cn/api/v1/models/scott887/SenseVoiceSmall-Q8_0.gguf/repo?Revision=master&FilePath=SenseVoiceSmall-Q8_0.gguf',
  huggingFaceURL: 'https://huggingface.co/handy-computer/SenseVoiceSmall-gguf/resolve/main/SenseVoiceSmall-Q8_0.gguf',
  supportsChars: false,
};

export const FUNASR_MODELSCOPE_REPO = 'scott887/speech';

export const FUNASR_PARAFORMER: ASRModelInfo = {
  id: 'funasr-paraformer',
  name: 'FunASR Seaco Paraformer (逐字稿推荐)',
  engine: 'funasr',
  supportsChars: true,
  modelScopeURL: `https://modelscope.cn/models/${FUNASR_MODELSCOPE_REPO}`,
};

export const MODELS: ASRModelInfo[] = [DEFAULT_MODEL, FUNASR_PARAFORMER];

export const FUNASR_COMPONENTS = [
  {
    key: 'asr',
    dirName: 'seaco_paraformer',
    modelScopeId: FUNASR_MODELSCOPE_REPO,
    bundleDir: 'iic--speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
    cacheNames: [
      'scott887--speech',
      'iic--speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
      'scott887--funasr-paraformer',
    ],
  },
  {
    key: 'vad',
    dirName: 'fsmn_vad',
    modelScopeId: 'damo/speech_fsmn_vad_zh-cn-16k-common-pytorch',
    bundleDir: 'damo--speech_fsmn_vad_zh-cn-16k-common-pytorch',
    cacheNames: ['damo--speech_fsmn_vad_zh-cn-16k-common-pytorch'],
  },
  {
    key: 'punc',
    dirName: 'punc_ct',
    modelScopeId: 'damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch',
    bundleDir: 'damo--punc_ct-transformer_zh-cn-common-vocab272727-pytorch',
    cacheNames: ['damo--punc_ct-transformer_zh-cn-common-vocab272727-pytorch'],
  },
  {
    key: 'spk',
    dirName: 'campplus',
    modelScopeId: 'damo/speech_campplus_sv_zh-cn_16k-common',
    bundleDir: 'damo--speech_campplus_sv_zh-cn_16k-common',
    cacheNames: ['damo--speech_campplus_sv_zh-cn_16k-common'],
  },
] as const;

export function getModelById(id: string): ASRModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function getModelsCacheDir(): string {
  if (process.env.TRANSCRIBE_MODELS_DIR) {
    return path.resolve(process.env.TRANSCRIBE_MODELS_DIR.replace(/^~/, os.homedir()));
  }
  return path.join(getPackageRoot(), 'models');
}

function legacyGgufPaths(fileName: string): string[] {
  return [
    path.join(os.homedir(), '.transcribe_models', fileName),
    path.join(os.homedir(), '.1agents', 'models', fileName),
    path.join(os.homedir(), 'Library', 'Application Support', 'TranscribeKit', 'models', fileName),
    path.join(os.homedir(), 'Library', 'Application Support', 'SmartSubtitlePlayer', 'models', fileName),
  ];
}

function expandUserPath(p: string): string {
  return path.resolve(p.replace(/^~/, os.homedir()));
}

/** 将旧缓存中的 GGUF 模型迁移到仓库根目录 models/ */
export function migrateLegacyGguf(fileName: string): string | null {
  const destDir = getModelsCacheDir();
  const dest = path.join(destDir, fileName);
  if (fs.existsSync(dest)) {
    return dest;
  }

  for (const src of legacyGgufPaths(fileName)) {
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    fs.mkdirSync(destDir, { recursive: true });
    try {
      fs.renameSync(src, dest);
    } catch {
      fs.copyFileSync(src, dest);
      try { fs.unlinkSync(src); } catch {}
    }
    return dest;
  }
  return null;
}

export function resolveModel(specifiedPath?: string, model: ASRModelInfo = DEFAULT_MODEL): string | null {
  if (specifiedPath && !getModelById(specifiedPath)) {
    const full = expandUserPath(specifiedPath);
    if (fs.existsSync(full)) {
      return full;
    }
  }

  const envPath = process.env.TRANSCRIBE_MODEL_PATH;
  if (envPath && fs.existsSync(envPath)) {
    const stat = fs.statSync(envPath);
    if (stat.isDirectory()) {
      const candidate = path.join(envPath, model.fileName || '');
      if (model.fileName && fs.existsSync(candidate)) return candidate;
    } else {
      return envPath;
    }
  }

  if (model.fileName) {
    migrateLegacyGguf(model.fileName);
    const cachedFile = path.join(getModelsCacheDir(), model.fileName);
    if (fs.existsSync(cachedFile)) {
      return cachedFile;
    }

    for (const p of legacyGgufPaths(model.fileName)) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

export async function ensureModel(specifiedPath?: string, model: ASRModelInfo = DEFAULT_MODEL): Promise<string> {
  const existing = resolveModel(specifiedPath, model);
  if (existing) {
    return existing;
  }

  if (!model.fileName || !model.modelScopeURL) {
    throw new Error(`模型 ${model.id} 无法自动下载，请先运行 transcribe setup-funasr 或指定本地路径`);
  }

  const cacheDir = getModelsCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });
  const destination = path.join(cacheDir, model.fileName);
  const tempDestination = path.join(cacheDir, `${model.fileName}.${Date.now()}.tmp`);

  console.log(`\n📦 本地未检测到模型 [${model.fileName}]`);
  console.log(`🌐 正在连接 ModelScope 镜像源极速拉取: ${model.modelScopeURL}`);

  let res: Response;
  try {
    res = await fetch(model.modelScopeURL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
  } catch (err) {
    console.log(`⚠️ ModelScope 源连接异常，尝试备用源 (HuggingFace)...`);
    if (!model.huggingFaceURL) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    res = await fetch(model.huggingFaceURL);
    if (!res.ok) {
      throw new Error(`下载模型失败: HTTP ${res.status} ${res.statusText}`);
    }
  }

  const contentLength = Number(res.headers.get('content-length') || model.sizeBytes || 0);
  if (!res.body) {
    throw new Error('下载响应体为空');
  }

  const fileStream = fs.createWriteStream(tempDestination);
  const hasher = crypto.createHash('sha256');

  let downloaded = 0;
  let lastPrint = 0;

  const nodeReadable = Readable.fromWeb(res.body as any);

  for await (const chunk of nodeReadable) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    downloaded += buffer.length;
    hasher.update(buffer);
    fileStream.write(buffer);

    const now = Date.now();
    if (now - lastPrint > 150 || (contentLength > 0 && downloaded === contentLength)) {
      lastPrint = now;
      const pct = contentLength > 0 ? Math.min(100, (downloaded / contentLength) * 100) : 0;
      const curMB = (downloaded / 1024 / 1024).toFixed(1);
      const totalMB = contentLength > 0 ? (contentLength / 1024 / 1024).toFixed(1) : '?';
      const barLen = 28;
      const filled = contentLength > 0 ? Math.floor((pct / 100) * barLen) : 0;
      const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barLen - filled));
      process.stderr.write(`\r📥 正在下载模型 [${bar}] ${pct.toFixed(0).padStart(3)}% (${curMB}MB / ${totalMB}MB)`);
    }
  }

  fileStream.end();
  process.stderr.write('\n');

  console.log('🔍 正在校验模型 SHA256 完整性...');
  const calculatedSha = hasher.digest('hex');

  if (model.sha256 && calculatedSha.toLowerCase() !== model.sha256.toLowerCase()) {
    fs.rmSync(tempDestination, { force: true });
    throw new Error(`模型校验失败！预期 SHA256 为 ${model.sha256}，实际为 ${calculatedSha}`);
  }

  fs.renameSync(tempDestination, destination);
  console.log(`✅ 模型下载与校验完成，已缓存至: ${destination}\n`);
  return destination;
}

export function resolveEngine(options: TranscribeOptions = {}): AsrEngine {
  if (options.engine === 'funasr' || options.engine === 'gguf') {
    return options.engine;
  }
  if (options.format === 'chars' || options.format === 'jsonl' || options.charsOut) {
    return 'funasr';
  }
  if (options.model) {
    const info = getModelById(options.model);
    if (info) return info.engine;
    if (options.model.toLowerCase().endsWith('.gguf')) return 'gguf';
    const full = expandUserPath(options.model);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      if (
        fs.existsSync(path.join(full, 'seaco_paraformer')) ||
        fs.existsSync(path.join(full, 'configuration.json'))
      ) {
        return 'funasr';
      }
    }
  }
  return 'gguf';
}

export function resolveSelectedModel(options: TranscribeOptions = {}): ASRModelInfo {
  if (options.model) {
    const byId = getModelById(options.model);
    if (byId) return byId;
  }
  return resolveEngine(options) === 'funasr' ? FUNASR_PARAFORMER : DEFAULT_MODEL;
}

export function getFunasrModelsDir(specified?: string): string {
  if (specified) {
    const full = expandUserPath(specified);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      const nested = path.join(full, 'seaco_paraformer');
      if (fs.existsSync(nested) || fs.existsSync(path.join(full, 'configuration.json'))) {
        return fs.existsSync(nested) ? full : path.dirname(full);
      }
      return full;
    }
  }

  const envDir = process.env.TRANSCRIBE_FUNASR_MODELS || process.env.TRANSCRIBE_MODEL_PATH;
  if (envDir && fs.existsSync(envDir) && fs.statSync(envDir).isDirectory()) {
    const nested = path.join(envDir, 'seaco_paraformer');
    if (fs.existsSync(nested)) return envDir;
  }

  return getModelsCacheDir();
}

export function funasrModelsReady(modelsDir?: string): boolean {
  const root = modelsDir || getFunasrModelsDir();
  return FUNASR_COMPONENTS.every((c) => fs.existsSync(path.join(root, c.dirName)));
}

function findFunasrPythonBin(): string | null {
  const isWindows = process.platform === 'win32';
  const venvPython = isWindows
    ? path.join(getPackageRoot(), '.venv', 'Scripts', 'python.exe')
    : path.join(getPackageRoot(), '.venv', 'bin', 'python');
  for (const p of [process.env.FUNASR_PYTHON, venvPython]) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

export function vendorFunasrModels(modelsDir?: string): boolean {
  const script = path.join(getPackageRoot(), 'scripts', 'vendor-models.sh');
  if (!fs.existsSync(script)) return false;
  const dest = modelsDir || getModelsCacheDir();
  fs.mkdirSync(dest, { recursive: true });
  const res = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TRANSCRIBE_MODELS_DIR: dest,
    },
  });
  if (res.stdout) process.stderr.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return res.status === 0 && funasrModelsReady(dest);
}

export function downloadFunasrModels(modelsDir?: string): boolean {
  const script = path.join(getPackageRoot(), 'scripts', 'download-funasr-models.py');
  const python = findFunasrPythonBin();
  if (!python || !fs.existsSync(script)) return false;
  const dest = modelsDir || getModelsCacheDir();
  fs.mkdirSync(dest, { recursive: true });
  console.log(`🌐 正在从 ModelScope 拉取 FunASR 模型: ${FUNASR_PARAFORMER.modelScopeURL}`);
  const res = spawnSync(python, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TRANSCRIBE_MODELS_DIR: dest,
    },
    stdio: 'inherit',
  });
  return res.status === 0 && funasrModelsReady(dest);
}

export function ensureFunasrModels(specified?: string): string {
  const dir = getFunasrModelsDir(specified);
  if (funasrModelsReady(dir)) return dir;
  const dest = getModelsCacheDir();
  vendorFunasrModels(dest);
  if (funasrModelsReady(dest)) return dest;
  downloadFunasrModels(dest);
  if (funasrModelsReady(dest)) return dest;
  throw new Error(
    `FunASR 模型未就绪（需要 ${FUNASR_COMPONENTS.map((c) => c.dirName).join(', ')}）。\n` +
      `ASR 镜像: ${FUNASR_PARAFORMER.modelScopeURL}\n` +
      `请先运行: transcribe setup-funasr\n` +
      `模型目录: ${dest}`,
  );
}

export function listModelStatus(): Array<ASRModelInfo & { ready: boolean; resolvedPath: string | null }> {
  return MODELS.map((model) => {
    if (model.engine === 'funasr') {
      const dir = getFunasrModelsDir();
      const ready = funasrModelsReady(dir);
      return { ...model, ready, resolvedPath: ready ? dir : null };
    }
    const resolved = resolveModel(undefined, model);
    return { ...model, ready: Boolean(resolved), resolvedPath: resolved };
  });
}
