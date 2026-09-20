import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { TranscribeOptions, TranscribeResult } from './types.js';
import {
  ensureFunasrModels,
  getModelById,
  getPackageRoot,
  resolveSelectedModel,
} from './model.js';

export interface SentenceRow {
  i: number;
  asset?: string;
  text: string;
  start: number;
  end: number;
  spk?: number | null;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

export function formatSrtTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(Number(ms) || 0));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const milli = clamped % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(milli, 3)}`;
}

export function formatVttTimestamp(ms: number): string {
  return formatSrtTimestamp(ms).replace(',', '.');
}

export function sentencesToSrt(rows: SentenceRow[]): string {
  return rows
    .filter((r) => r.text)
    .map((r, idx) => `${idx + 1}\n${formatSrtTimestamp(r.start)} --> ${formatSrtTimestamp(r.end)}\n${r.text}\n`)
    .join('\n');
}

export function sentencesToVtt(rows: SentenceRow[]): string {
  const body = rows
    .filter((r) => r.text)
    .map((r) => `${formatVttTimestamp(r.start)} --> ${formatVttTimestamp(r.end)}\n${r.text}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export function sentencesToTxt(rows: SentenceRow[]): string {
  const text = rows.map((r) => r.text).filter(Boolean).join('\n');
  return text ? `${text}\n` : '';
}

export function parseJsonl<T>(text: string): T[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function findFunasrPython(specified?: string): string | null {
  const isWindows = process.platform === 'win32';
  const venvPython = isWindows
    ? path.join(getPackageRoot(), '.venv', 'Scripts', 'python.exe')
    : path.join(getPackageRoot(), '.venv', 'bin', 'python');

  const sharedVenv = isWindows
    ? path.join(os.homedir(), '.1agents', 'skill-manager', 'shared', 'funasr-local', '.venv', 'Scripts', 'python.exe')
    : path.join(os.homedir(), '.1agents', 'skill-manager', 'shared', 'funasr-local', '.venv', 'bin', 'python');

  const userVenv = isWindows
    ? path.join(os.homedir(), '.1agents', 'venvs', 'funasr', 'Scripts', 'python.exe')
    : path.join(os.homedir(), '.1agents', 'venvs', 'funasr', 'bin', 'python');

  const cwdVenv1 = path.join(process.cwd(), '.agents', 'skills', 'funasr-local', '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');
  const cwdVenv2 = path.join(process.cwd(), '.claude', 'skills', 'funasr-local', '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');
  const cwdVenv3 = path.join(process.cwd(), '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');

  const candidates = [
    specified,
    process.env.FUNASR_PYTHON,
    venvPython,
    sharedVenv,
    userVenv,
    cwdVenv1,
    cwdVenv2,
    cwdVenv3,
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    const full = p.replace(/^~/, os.homedir());
    if (fs.existsSync(full)) return full;
  }
  return null;
}

export function getAsrPyPath(): string {
  return path.join(getPackageRoot(), 'scripts', 'asr.py');
}

function writeFile(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, 'utf8');
}

export async function runFunasrTranscription(
  audioPath: string,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const fullAudioPath = path.resolve(audioPath.replace(/^~/, os.homedir()));
  const python = findFunasrPython(options.python);
  const asrPy = getAsrPyPath();
  if (!python) {
    throw new Error(
      `未找到 FunASR Python 环境。\n` +
        `请先运行: transcribe setup-funasr\n` +
        `或设置 FUNASR_PYTHON 指向已安装 funasr 的解释器。`,
    );
  }
  if (!fs.existsSync(asrPy)) {
    throw new Error(`未找到 FunASR 脚本: ${asrPy}`);
  }

  const modelOverride = options.model && !getModelById(options.model) ? options.model : undefined;
  const modelsDir = ensureFunasrModels(modelOverride);

  const outDir = options.output
    ? path.resolve(options.output.replace(/^~/, os.homedir()))
    : path.dirname(fullAudioPath);
  fs.mkdirSync(outDir, { recursive: true });

  const format = options.format || 'all';
  const baseName = path.basename(fullAudioPath, path.extname(fullAudioPath));
  const wantChars = format === 'all' || format === 'chars' || format === 'jsonl' || Boolean(options.charsOut);
  const wantSentences = format === 'all' || Boolean(options.sentencesOut);
  const wantSubtitles = format === 'all' || format === 'srt' || format === 'vtt' || format === 'txt';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-funasr-'));
  const charsPath = options.charsOut
    ? path.resolve(options.charsOut.replace(/^~/, os.homedir()))
    : wantChars
      ? path.join(outDir, `${baseName}.chars.jsonl`)
      : path.join(tmpDir, `${baseName}.chars.jsonl`);
  const sentencesPath = options.sentencesOut
    ? path.resolve(options.sentencesOut.replace(/^~/, os.homedir()))
    : wantSentences || wantSubtitles
      ? path.join(wantSentences ? outDir : tmpDir, `${baseName}.sentences.jsonl`)
      : path.join(tmpDir, `${baseName}.sentences.jsonl`);
  const fillersPath = options.fillersOut
    ? path.resolve(options.fillersOut.replace(/^~/, os.homedir()))
    : format === 'all'
      ? path.join(outDir, `${baseName}.fillers.json`)
      : undefined;

  const args = [
    asrPy,
    '--audio', fullAudioPath,
    '--chars-out', charsPath,
    '--sentences-out', sentencesPath,
    '--asset-id', options.assetId || 'meeting',
    '--models-dir', modelsDir,
  ];
  if (fillersPath) args.push('--fillers-out', fillersPath);
  if (options.diarize === false) args.push('--no-diarize');
  if (options.itn === false) args.push('--no-punc');

  const startTime = Date.now();

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(python, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TRANSCRIBE_MODELS_DIR: modelsDir,
      },
    });

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      if (process.env.TRANSCRIBE_INVOKE === '1' || options.quiet) {
        process.stderr.write(text);
      } else {
        process.stdout.write(text);
      }
    });

    proc.stderr.on('data', (d) => {
      process.stderr.write(d.toString());
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`FunASR 进程异常退出 (code: ${code})`));
      }
      resolve();
    });

    proc.on('error', reject);
  });

  const elapsedSec = (Date.now() - startTime) / 1000;
  const sentenceRows = fs.existsSync(sentencesPath)
    ? parseJsonl<SentenceRow>(fs.readFileSync(sentencesPath, 'utf8'))
    : [];

  const files: TranscribeResult['files'] = {};
  if (wantChars && fs.existsSync(charsPath)) files.chars = charsPath;
  if (wantSentences && fs.existsSync(sentencesPath)) files.sentences = sentencesPath;
  if (fillersPath && fs.existsSync(fillersPath)) files.fillers = fillersPath;

  if (wantSubtitles && sentenceRows.length > 0) {
    if (format === 'all' || format === 'srt') {
      const srtPath = path.join(outDir, `${baseName}.srt`);
      writeFile(srtPath, sentencesToSrt(sentenceRows));
      files.srt = srtPath;
    }
    if (format === 'all' || format === 'vtt') {
      const vttPath = path.join(outDir, `${baseName}.vtt`);
      writeFile(vttPath, sentencesToVtt(sentenceRows));
      files.vtt = vttPath;
    }
    if (format === 'all' || format === 'txt') {
      const txtPath = path.join(outDir, `${baseName}.txt`);
      writeFile(txtPath, sentencesToTxt(sentenceRows));
      files.txt = txtPath;
    }
  }

  let lastEnd = sentenceRows.reduce((max, r) => Math.max(max, Number(r.end) || 0), 0);
  let itemCount = sentenceRows.length;
  if (lastEnd === 0 && fs.existsSync(charsPath)) {
    const charRows = parseJsonl<{ end: number }>(fs.readFileSync(charsPath, 'utf8'));
    lastEnd = charRows.reduce((max, r) => Math.max(max, Number(r.end) || 0), 0);
    if (itemCount === 0) itemCount = charRows.length;
  }
  const durationSec = lastEnd > 0 ? lastEnd / 1000 : 0;
  const selected = resolveSelectedModel({ ...options, engine: 'funasr' });

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  return {
    audioPath: fullAudioPath,
    durationSec,
    elapsedSec,
    speedFactor: durationSec > 0 && elapsedSec > 0 ? durationSec / elapsedSec : 0,
    itemCount,
    engine: 'funasr',
    modelId: selected.id,
    files,
  };
}
