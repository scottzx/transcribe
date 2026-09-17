#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const report = {
  cli: {
    command: null,
    version: null,
    inPath: false,
  },
  nativeEngine: {
    path: null,
    detected: false,
  },
  model: {
    cacheDir: process.env.TRANSCRIBE_MODELS_DIR || path.join(os.homedir(), '.transcribe_models'),
    fileName: 'SenseVoiceSmall-Q8_0.gguf',
    exists: false,
    sizeBytes: 0,
    sizeMB: 0,
  }
};

// 1. 检查 CLI (transcribe / 1transcribe)
for (const cmd of ['transcribe', '1transcribe']) {
  try {
    const out = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    if (out) {
      report.cli.command = cmd;
      report.cli.inPath = true;
      try {
        report.cli.version = execSync(`${cmd} --version`, { encoding: 'utf-8' }).trim();
      } catch {}
      break;
    }
  } catch {}
}

// 2. 检查原生二进制
const isWindows = process.platform === 'win32';
const binName = isWindows ? 'transcribe-cli.exe' : 'transcribe-cli';
const searchPaths = [
  process.env.TRANSCRIBE_BIN_PATH,
  path.join(os.homedir(), '.local', 'bin', binName),
  '/usr/local/bin/' + binName,
  '/opt/homebrew/bin/' + binName,
  path.join(os.homedir(), 'Documents', '01-开发项目', 'mac_app', 'TranscribeKit', '.build', 'arm64-apple-macosx', 'release', binName)
].filter(Boolean);

for (const p of searchPaths) {
  if (fs.existsSync(p)) {
    report.nativeEngine.path = p;
    report.nativeEngine.detected = true;
    break;
  }
}

// 3. 检查模型状态
const modelFile = path.join(report.model.cacheDir, report.model.fileName);
if (fs.existsSync(modelFile)) {
  const stat = fs.statSync(modelFile);
  report.model.exists = true;
  report.model.sizeBytes = stat.size;
  report.model.sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
}

const isJson = process.argv.includes('--json');
if (isJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('=== @1agents/transcribe 诊断报告 ===');
  console.log(`[CLI 状态]`);
  console.log(`  - 存在于 PATH: ${report.cli.inPath ? '✅ 是 (' + report.cli.command + ')' : '❌ 否 (可通过 npm i -g @1agents/transcribe 安装)'}`);
  if (report.cli.version) console.log(`  - 当前版本: ${report.cli.version}`);

  console.log(`\n[原生 ASR 引擎]`);
  console.log(`  - 状态: ${report.nativeEngine.detected ? '✅ 已定位' : '⚠️ 未找到 (默认从 ~/.local/bin/transcribe-cli 查找)'}`);
  if (report.nativeEngine.path) console.log(`  - 引擎路径: ${report.nativeEngine.path}`);

  console.log(`\n[SenseVoice 模型]`);
  console.log(`  - 缓存目录: ${report.model.cacheDir}`);
  console.log(`  - 模型文件: ${report.model.fileName}`);
  console.log(`  - 状态: ${report.model.exists ? '✅ 已就绪 (' + report.model.sizeMB + ' MB)' : '⏳ 尚未下载 (首次运行 CLI 时将自动从 ModelScope 极速拉取)'}`);
  console.log('====================================');
}
