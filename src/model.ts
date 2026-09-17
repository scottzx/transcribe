import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { ASRModelInfo } from './types.js';

export const DEFAULT_MODEL: ASRModelInfo = {
  id: 'sensevoice-small-q8',
  name: 'SenseVoice Small (推荐)',
  fileName: 'SenseVoiceSmall-Q8_0.gguf',
  sizeBytes: 252684608,
  sha256: '6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29',
  modelScopeURL: 'https://modelscope.cn/api/v1/models/scott887/SenseVoiceSmall-Q8_0.gguf/repo?Revision=master&FilePath=SenseVoiceSmall-Q8_0.gguf',
  huggingFaceURL: 'https://huggingface.co/handy-computer/SenseVoiceSmall-gguf/resolve/main/SenseVoiceSmall-Q8_0.gguf'
};

export function getModelsCacheDir(): string {
  const home = os.homedir();
  return path.join(home, '.transcribe_models');
}

export function resolveModel(specifiedPath?: string, model: ASRModelInfo = DEFAULT_MODEL): string | null {
  if (specifiedPath) {
    const full = path.resolve(specifiedPath.replace(/^~/, os.homedir()));
    if (fs.existsSync(full)) {
      return full;
    }
  }

  // 1. 环境变量覆盖
  const envPath = process.env.TRANSCRIBE_MODEL_PATH;
  if (envPath && fs.existsSync(envPath)) {
    const stat = fs.statSync(envPath);
    if (stat.isDirectory()) {
      const candidate = path.join(envPath, model.fileName);
      if (fs.existsSync(candidate)) return candidate;
    } else {
      return envPath;
    }
  }

  // 2. 通用缓存目录 ~/.transcribe_models/
  const cacheDir = getModelsCacheDir();
  const cachedFile = path.join(cacheDir, model.fileName);
  if (fs.existsSync(cachedFile)) {
    return cachedFile;
  }

  // 3. 平台特定兼容目录 (macOS Application Support / .1agents)
  const legacyPaths = [
    path.join(os.homedir(), '.1agents', 'models', model.fileName),
    path.join(os.homedir(), 'Library', 'Application Support', 'TranscribeKit', 'models', model.fileName),
    path.join(os.homedir(), 'Library', 'Application Support', 'SmartSubtitlePlayer', 'models', model.fileName),
  ];

  for (const p of legacyPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

export async function ensureModel(specifiedPath?: string, model: ASRModelInfo = DEFAULT_MODEL): Promise<string> {
  const existing = resolveModel(specifiedPath, model);
  if (existing) {
    return existing;
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
    res = await fetch(model.huggingFaceURL);
    if (!res.ok) {
      throw new Error(`下载模型失败: HTTP ${res.status} ${res.statusText}`);
    }
  }

  const contentLength = Number(res.headers.get('content-length') || model.sizeBytes);
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
    if (now - lastPrint > 150 || downloaded === contentLength) {
      lastPrint = now;
      const pct = Math.min(100, (downloaded / contentLength) * 100);
      const curMB = (downloaded / 1024 / 1024).toFixed(1);
      const totalMB = (contentLength / 1024 / 1024).toFixed(1);
      const barLen = 28;
      const filled = Math.floor((pct / 100) * barLen);
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
