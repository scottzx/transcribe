import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTranscription } from './runner.js';
import type { TranscribeOptions } from './types.js';

export function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pkgPath = path.resolve(__dirname, '../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version || '0.1.0';
    }
  } catch {}
  return '0.1.0';
}

export function printHelp(): void {
  console.log(`
@1agents/transcribe v${getVersion()}
端侧极速语音转写与字幕生成引擎 (Metal/Vulkan/CPU 加速 + DreamMate 能力网格)

用法:
  transcribe <音频或视频文件路径> [选项]
  transcribe serve [选项]
  npx @1agents/transcribe <音频文件路径> [选项]

转写选项:
  -o, --output <路径>       输出目录或文件名 (默认保存在源文件同级目录)
  -f, --format <格式>       输出格式：srt, vtt, txt, all (默认: all)
  -l, --lang <语种>         识别语种提示：zh (默认), en, yue, ja, ko
  --no-itn                  关闭逆文本规整 (数字与日期规范化)
  -m, --model <路径>        显式指定自定义 GGUF 模型路径
  -v, --version             显示当前版本号
  -h, --help                显示帮助说明

服务模式 (DreamMate Network ASR 节点):
  transcribe serve          启动本地 HTTP ASR 服务并向 dreammate-node 报备能力
  -p, --port <端口>         指定监听端口 (默认: 7782)
  --host <地址>             绑定主机地址 (默认: 127.0.0.1)
  --no-report               仅启动 HTTP 服务，不向本机 dreammate-node 报备

示例:
  transcribe interview.mp3
  transcribe podcast.m4a -o ./subtitles/ -f srt
  transcribe serve --port 7782
`);
}

export async function runCLI(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    return;
  }

  if (argv.includes('-v') || argv.includes('--version')) {
    console.log(`@1agents/transcribe v${getVersion()}`);
    return;
  }

  // 子命令：serve
  if (argv[0] === 'serve') {
    let port: number | undefined;
    let host: string | undefined;
    let report = true;

    for (let i = 1; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '-p' || arg === '--port') {
        const val = parseInt(argv[++i], 10);
        if (!isNaN(val)) port = val;
      } else if (arg === '--host') {
        host = argv[++i];
      } else if (arg === '--no-report') {
        report = false;
      } else if (arg === '-h' || arg === '--help') {
        console.log(`
用法:
  transcribe serve [选项]

选项:
  -p, --port <端口>    服务端口 (默认: 7782)
  --host <地址>        绑定主机地址 (默认: 127.0.0.1)
  --no-report          不向本机 dreammate-node 报备
`);
        return;
      }
    }

    const { serveTranscribe } = await import('./server.js');
    try {
      await serveTranscribe({ port, host, report });
    } catch (err: any) {
      console.error(`❌ 服务启动失败: ${err.message || err}`);
      process.exit(1);
    }
    return;
  }

  let audioPath: string | undefined;
  const options: TranscribeOptions = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--output') {
      options.output = argv[++i];
    } else if (arg === '-f' || arg === '--format') {
      const fmt = argv[++i]?.toLowerCase();
      if (fmt === 'srt' || fmt === 'vtt' || fmt === 'txt' || fmt === 'all') {
        options.format = fmt;
      }
    } else if (arg === '-l' || arg === '--lang') {
      options.lang = argv[++i];
    } else if (arg === '-m' || arg === '--model') {
      options.model = argv[++i];
    } else if (arg === '--no-itn') {
      options.itn = false;
    } else if (!arg.startsWith('-') && !audioPath) {
      audioPath = arg;
    }
    i++;
  }

  if (!audioPath) {
    console.error('❌ 错误：必须提供音频文件路径。');
    printHelp();
    process.exit(1);
  }

  try {
    const result = await runTranscription(audioPath, options);
    console.log(`\n🎉 转写完成！共 ${result.itemCount} 句字幕，耗时 ${result.elapsedSec.toFixed(1)}s (加速比: ${result.speedFactor.toFixed(1)}x)`);
    if (result.files.srt) console.log(`   - SRT: ${result.files.srt}`);
    if (result.files.vtt) console.log(`   - VTT: ${result.files.vtt}`);
    if (result.files.txt) console.log(`   - TXT: ${result.files.txt}`);
  } catch (err: any) {
    console.error(`\n❌ 转写失败: ${err.message || err}`);
    process.exit(1);
  }
}
