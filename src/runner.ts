import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import type { TranscribeOptions, TranscribeResult } from './types.js';
import { ensureModel, getModelById, resolveEngine, resolveSelectedModel } from './model.js';
import { runFunasrTranscription } from './funasr.js';

export function findNativeBinary(): string | null {
  const isWindows = process.platform === 'win32';
  const binName = isWindows ? 'transcribe-cli.exe' : 'transcribe-cli';

  // 1. 优先检查环境变量
  if (process.env.TRANSCRIBE_BIN_PATH && fs.existsSync(process.env.TRANSCRIBE_BIN_PATH)) {
    return process.env.TRANSCRIBE_BIN_PATH;
  }

  // 2. 检查标准路径
  const searchPaths = [
    path.join(os.homedir(), '.local', 'bin', binName),
    '/usr/local/bin/' + binName,
    '/opt/homebrew/bin/' + binName,
    path.join(os.homedir(), 'Documents', '01-开发项目', 'mac_app', 'TranscribeKit', '.build', 'arm64-apple-macosx', 'release', binName)
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

export async function runTranscription(
  audioPath: string,
  options: TranscribeOptions = {}
): Promise<TranscribeResult> {
  const fullAudioPath = path.resolve(audioPath.replace(/^~/, os.homedir()));
  if (!fs.existsSync(fullAudioPath)) {
    throw new Error(`输入音频文件不存在: ${audioPath}`);
  }

  if (resolveEngine(options) === 'funasr') {
    return runFunasrTranscription(fullAudioPath, options);
  }

  const selected = resolveSelectedModel(options);
  const specifiedPath = options.model && !getModelById(options.model) ? options.model : undefined;
  const modelPath = await ensureModel(specifiedPath, selected);

  // 2. 定位原生二进制
  const binaryPath = findNativeBinary();
  if (!binaryPath) {
    throw new Error(
      `未检测到原生转写引擎二进制 (transcribe-cli)。\n` +
      `请确保已在系统中构建 TranscribeKit 或将二进制安装至 ~/.local/bin/transcribe-cli。`
    );
  }

  const outDir = options.output
    ? path.resolve(options.output.replace(/^~/, os.homedir()))
    : path.dirname(fullAudioPath);

  fs.mkdirSync(outDir, { recursive: true });

  const format = options.format === 'chars' || options.format === 'jsonl' ? 'all' : (options.format || 'all');
  const args = [
    fullAudioPath,
    '-o', outDir,
    '-f', format,
    '-m', modelPath
  ];

  if (options.lang) {
    args.push('-l', options.lang);
  }
  if (options.itn === false) {
    args.push('--no-itn');
  }

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      stdoutData += text;
      if (process.env.TRANSCRIBE_INVOKE === '1' || options.quiet) {
        process.stderr.write(text);
      } else {
        process.stdout.write(text);
      }
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString();
      stderrData += text;
      process.stderr.write(text);
    });

    proc.on('close', (code) => {
      const elapsedSec = (Date.now() - startTime) / 1000;
      if (code !== 0) {
        return reject(new Error(`transcribe-cli 进程异常退出 (code: ${code})`));
      }

      const baseName = path.basename(fullAudioPath, path.extname(fullAudioPath));
      const srtPath = path.join(outDir, `${baseName}.srt`);
      const vttPath = path.join(outDir, `${baseName}.vtt`);
      const txtPath = path.join(outDir, `${baseName}.txt`);

      const files: TranscribeResult['files'] = {};
      if (fs.existsSync(srtPath)) files.srt = srtPath;
      if (fs.existsSync(vttPath)) files.vtt = vttPath;
      if (fs.existsSync(txtPath)) files.txt = txtPath;

      let durationSec = 0;
      let itemCount = 0;

      // 从输出文本中解析时长与句数
      const durMatch = stdoutData.match(/音频时长:\s*([\d.]+)\s*秒/);
      if (durMatch) durationSec = parseFloat(durMatch[1]);

      const itemMatch = stdoutData.match(/总字幕条目:\s*(\d+)\s*句/);
      if (itemMatch) itemCount = parseInt(itemMatch[1], 10);

      const speedFactor = durationSec > 0 && elapsedSec > 0 ? durationSec / elapsedSec : 0;

      resolve({
        audioPath: fullAudioPath,
        durationSec,
        elapsedSec,
        speedFactor,
        itemCount,
        engine: 'gguf',
        modelId: selected.id,
        files
      });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}
