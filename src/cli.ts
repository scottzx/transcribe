import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTranscription } from './runner.js';
import { getModelsCacheDir, getPackageRoot, listModelStatus, migrateLegacyGguf, MODELS } from './model.js';
import type { OutputFormat, TranscribeOptions } from './types.js';

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
  -f, --format <格式>       输出格式：srt, vtt, txt, chars, all (默认: all)
  -e, --engine <引擎>       推理引擎：gguf (默认极速), funasr (高精度逐字稿)
  -m, --model <id|路径>     模型 ID 或路径：sensevoice-small-q8, funasr-paraformer
  -l, --lang <语种>         识别语种提示：zh (默认), en, yue, ja, ko
  --no-itn                  关闭逆文本规整 / FunASR 标点
  --chars-out <路径>        FunASR 字级逐字稿 JSONL
  --sentences-out <路径>    FunASR 句级 JSONL
  --fillers-out <路径>      FunASR 语气词摘要 JSON
  --asset-id <id>           逐字稿 asset 字段 (默认: meeting)
  --no-diarize              关闭 FunASR 说话人分离
  --python <路径>           FunASR Python 解释器
  -v, --version             显示当前版本号
  -h, --help                显示帮助说明

模型:
  transcribe models         列出可选用模型与本地就绪状态
  transcribe setup-funasr   安装 FunASR Python 环境并软链模型到 ./models

服务模式 (DreamMate Network ASR 节点):
  transcribe serve          启动本地 HTTP ASR 服务并向 dreammate-node 报备能力
  -p, --port <端口>         指定监听端口 (默认: 7782)
  --host <地址>             绑定主机地址 (默认: 127.0.0.1)
  --no-report               仅启动 HTTP 服务，不向本机 dreammate-node 报备
  transcribe register       免常驻模式：向本机 node agent 报备 CLI/Hybrid 能力后立即退出
  transcribe invoke         通用 CLI RPC 入口：从 stdin 或 --payload 读取 JSON 执行并纯净输出 JSON

示例:
  transcribe interview.mp3
  transcribe podcast.m4a -o ./subtitles/ -f srt
  transcribe interview.mp3 --engine funasr
  transcribe interview.mp3 -m funasr-paraformer -f chars
  transcribe models
  transcribe register
  transcribe invoke --payload '{"method":"asr.info"}'
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

  if (argv[0] === 'models') {
    printModels();
    return;
  }

  if (argv[0] === 'setup-funasr') {
    await runSetupFunasr(argv.slice(1));
    return;
  }

  // 子命令：register (免常驻单次报备)
  if (argv[0] === 'register') {
    let port: number | undefined;
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === '-p' || argv[i] === '--port') {
        const val = parseInt(argv[++i], 10);
        if (!isNaN(val)) port = val;
      }
    }

    const { getTranscribeRegistration } = await import('./server.js');
    const { reportToAgent } = await import('@1agents/dreammate-node/client');

    const reg = getTranscribeRegistration(port);
    const res = await reportToAgent(reg);
    if (res.ok) {
      console.log(`✅ 已成功向本机 node agent 报备能力: ${reg.id}`);
      console.log(`   执行模式: ${reg.execution} (CLI 优先调度，按需常驻)`);
      console.log(`   CLI 指令: ${reg.command}`);
      console.log(`   备用端口: ${reg.port}`);
      console.log(`   方法契约: ${Object.keys(reg.methods).join(', ')}`);
      return;
    } else {
      console.error(`❌ 报备失败: ${res.reason}。请确认本机 dreammate-node (36908) 是否运行。`);
      process.exit(1);
    }
  }

  // 子命令：invoke (DreamMate CLI RPC 调度器，stdout 纯净输出 JSON)
  if (argv[0] === 'invoke') {
    process.env.TRANSCRIBE_INVOKE = '1';
    // 将所有日志导向 stderr，确保 stdout 仅有最终的合法 JSON
    console.log = (...args: unknown[]) => console.error(...args);

    let rawInput = '';
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === '--payload' || argv[i] === '--params') {
        rawInput = argv[++i] || '';
      }
    }

    if (!rawInput && !process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      rawInput = Buffer.concat(chunks).toString('utf8');
    }

    let payload: any = {};
    if (rawInput.trim()) {
      try {
        payload = JSON.parse(rawInput.trim());
      } catch (err) {
        process.stderr.write(`❌ 无效的 JSON 输入: ${rawInput}\n`);
        process.stdout.write(JSON.stringify({ error: `invalid json: ${err}` }) + '\n');
        process.exit(1);
      }
    }

    const method = payload.method || payload.capability || 'asr.transcribe';
    const params = payload.params || {};

    const { getAsrEngineInfo } = await import('./server.js');

    if (method === 'asr.info' || method === 'info') {
      const info = getAsrEngineInfo();
      process.stdout.write(JSON.stringify(info) + '\n');
      return;
    }

    if (method === 'asr.transcribe' || method === 'transcribe') {
      const audioPath =
        params.audio_path || params.audioPath || params.file_path || params.filePath;
      if (!audioPath || typeof audioPath !== 'string') {
        process.stdout.write(
          JSON.stringify({ error: '缺少必填参数: audio_path (音频绝对文件路径)' }) + '\n',
        );
        process.exit(1);
      }

      const options: TranscribeOptions = {
        output: params.output_dir || params.outputDir || params.output,
        format: params.format,
        lang: params.lang,
        itn: params.itn !== false,
        model: params.model,
        engine: params.engine,
        charsOut: params.chars_out || params.charsOut,
        sentencesOut: params.sentences_out || params.sentencesOut,
        fillersOut: params.fillers_out || params.fillersOut,
        assetId: params.asset_id || params.assetId,
        diarize: params.diarize,
        python: params.python,
        quiet: true,
      };

      try {
        const result = await runTranscription(audioPath, options);
        process.stdout.write(JSON.stringify(result) + '\n');
        return;
      } catch (err: any) {
        process.stdout.write(JSON.stringify({ error: err.message || String(err) }) + '\n');
        process.exit(1);
      }
    }

    process.stdout.write(JSON.stringify({ error: `未知方法: ${method}` }) + '\n');
    process.exit(1);
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
      if (fmt === 'srt' || fmt === 'vtt' || fmt === 'txt' || fmt === 'chars' || fmt === 'jsonl' || fmt === 'all') {
        options.format = fmt as OutputFormat;
      }
    } else if (arg === '-e' || arg === '--engine') {
      const engine = argv[++i]?.toLowerCase();
      if (engine === 'gguf' || engine === 'funasr') {
        options.engine = engine;
      }
    } else if (arg === '-l' || arg === '--lang') {
      options.lang = argv[++i];
    } else if (arg === '-m' || arg === '--model') {
      options.model = argv[++i];
    } else if (arg === '--no-itn') {
      options.itn = false;
    } else if (arg === '--chars-out') {
      options.charsOut = argv[++i];
    } else if (arg === '--sentences-out') {
      options.sentencesOut = argv[++i];
    } else if (arg === '--fillers-out') {
      options.fillersOut = argv[++i];
    } else if (arg === '--asset-id') {
      options.assetId = argv[++i];
    } else if (arg === '--no-diarize') {
      options.diarize = false;
    } else if (arg === '--python') {
      options.python = argv[++i];
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
    console.log(`\n🎉 转写完成！引擎 ${result.engine}，共 ${result.itemCount} 句字幕，耗时 ${result.elapsedSec.toFixed(1)}s (加速比: ${result.speedFactor.toFixed(1)}x)`);
    if (result.files.srt) console.log(`   - SRT: ${result.files.srt}`);
    if (result.files.vtt) console.log(`   - VTT: ${result.files.vtt}`);
    if (result.files.txt) console.log(`   - TXT: ${result.files.txt}`);
    if (result.files.chars) console.log(`   - 逐字稿: ${result.files.chars}`);
    if (result.files.sentences) console.log(`   - 句级: ${result.files.sentences}`);
    if (result.files.fillers) console.log(`   - 语气词: ${result.files.fillers}`);
  } catch (err: any) {
    console.error(`\n❌ 转写失败: ${err.message || err}`);
    process.exit(1);
  }
}

export function printModels(): void {
  const ggufName = MODELS.find((m) => m.engine === 'gguf')?.fileName;
  if (ggufName) migrateLegacyGguf(ggufName);
  console.log(`模型缓存目录: ${getModelsCacheDir()}\n`);
  console.log('ID                       ENGINE   CHARS  READY  NAME');
  for (const row of listModelStatus()) {
    const chars = row.supportsChars ? 'yes' : 'no';
    const ready = row.ready ? 'yes' : 'no';
    console.log(
      `${row.id.padEnd(24)} ${row.engine.padEnd(8)} ${chars.padEnd(6)} ${ready.padEnd(6)} ${row.name}`,
    );
    if (row.resolvedPath) {
      console.log(`  → ${row.resolvedPath}`);
    }
  }
  console.log('\nFunASR 首次使用: transcribe setup-funasr');
  console.log(`可用 ID: ${MODELS.map((m) => m.id).join(', ')}`);
}

async function runSetupFunasr(argv: string[]): Promise<void> {
  const script = path.join(getPackageRoot(), 'scripts', 'setup-funasr.sh');
  if (!fs.existsSync(script)) {
    console.error(`❌ 未找到安装脚本: ${script}`);
    process.exit(1);
  }
  const code = await new Promise<number>((resolve, reject) => {
    const proc = spawn('bash', [script, ...argv], { stdio: 'inherit' });
    proc.on('close', (c) => resolve(c ?? 1));
    proc.on('error', reject);
  });
  process.exit(code);
}
