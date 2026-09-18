/**
 * @1agents/transcribe HTTP 服务与 DreamMate Network 能力网格适配器。
 *
 * 契约：
 *  - GET /health: 供 dreammate-node 探活心跳
 *  - GET /manifest: 返回符合 DreamMate 规范的服务与方法清单
 *  - POST /invoke: 供 dreammate_invoke 分布式 RPC 执行器调度
 *  - POST /transcribe: 直接执行本地音频转写
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { nodeIdentity } from '@1agents/dreammate-node';
import {
  reportAndHoldRegistration,
  loadSkillsFromDir,
  type Reachability,
  type SkillDescriptorWithSource as SkillDescriptor,
} from '@1agents/dreammate-node/client';
import { runTranscription, findNativeBinary } from './runner.js';
import { resolveModel, DEFAULT_MODEL, getModelsCacheDir } from './model.js';
import { getVersion } from './cli.js';
import type { TranscribeOptions, TranscribeResult } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SKILLS_DIR = path.resolve(__dirname, '../skills');

export type { SkillDescriptor };

export const DEFAULT_TRANSCRIBE_PORT = 7782;

export const ASR_CAPABILITIES = ['asr.transcribe', 'asr.info'] as const;

export interface ServerOptions {
  port?: number;
  host?: string;
  report?: boolean;
}

export const ASR_METHODS = {
  'asr.transcribe': {
    description: '对指定本地音频或视频进行离线极速转写，生成带有时间轴的字幕 (SRT/VTT) 或纯文本 (TXT)',
    parameters: {
      type: 'object',
      properties: {
        audio_path: {
          type: 'string',
          description: '本地音频或视频的绝对文件路径 (支持 mp3, m4a, wav, flac, aac, ogg, mp4, mkv 等)',
        },
        output_dir: {
          type: 'string',
          description: '可选，转写字幕与文本的输出目录。默认保存在音频同级目录',
        },
        format: {
          type: 'string',
          enum: ['srt', 'vtt', 'txt', 'all'],
          description: '可选，输出文件格式：srt, vtt, txt 或 all (默认: all)',
        },
        lang: {
          type: 'string',
          description: '可选，识别语种提示：zh (默认中文), en, yue (粤语), ja, ko',
        },
        itn: {
          type: 'boolean',
          description: '可选，是否开启逆文本规整 (数字与日期规范化)，默认 true',
        },
        model: {
          type: 'string',
          description: '可选，显式指定自定义 GGUF 模型路径',
        },
      },
      required: ['audio_path'],
    },
    returns: {
      type: 'object',
      description: '转写结果，包含音频时长、实际耗时、加速比、总字幕句数及生成的文件路径',
    },
  },
  'asr.info': {
    description: '获取当前本地 ASR 引擎状态、模型缓存、原生二进制与硬件推理加速情况',
    parameters: {
      type: 'object',
      properties: {},
    },
    returns: {
      type: 'object',
      description: '引擎与模型就绪状态',
    },
  },
};

export const getSkills = () => loadSkillsFromDir(SKILLS_DIR);
export const ASR_SKILLS = getSkills();

const json = (res: http.ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

const readBody = async (req: http.IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
};

export function getAsrEngineInfo() {
  const resolvedModel = resolveModel();
  const binary = findNativeBinary();
  return {
    service: 'transcribe',
    version: getVersion(),
    status: binary ? 'ready' : 'missing_binary',
    nativeBinary: binary,
    model: {
      name: DEFAULT_MODEL.name,
      fileName: DEFAULT_MODEL.fileName,
      resolvedPath: resolvedModel,
      isCached: Boolean(resolvedModel),
    },
    modelsCacheDir: getModelsCacheDir(),
    platform: process.platform,
    arch: process.arch,
    hardwareAcceleration: process.platform === 'darwin' && process.arch === 'arm64' ? 'Apple Silicon Metal' : 'CPU / Vulkan',
  };
}

export function createTranscribeServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const { pathname } = url;

      // 1. GET /health - 探活
      if (req.method === 'GET' && pathname === '/health') {
        const identity = await nodeIdentity().catch(() => ({ node_id: 'unknown', name: os.hostname() }));
        return json(res, 200, {
          status: 'ok',
          service: 'transcribe',
          version: getVersion(),
          node_id: identity.node_id,
          capabilities: [...ASR_CAPABILITIES],
          uptime: process.uptime(),
        });
      }

      // 2. GET /manifest - 服务清单
      if (req.method === 'GET' && pathname === '/manifest') {
        const host = req.headers.host ?? 'localhost';
        return json(res, 200, {
          id: 'transcribe',
          name: '本地端侧语音转写引擎',
          kind: 'generic',
          capabilities: [...ASR_CAPABILITIES],
          access: [{ protocol: 'http', base_url: `http://${host}` }],
          methods: ASR_METHODS,
          skills: ASR_SKILLS,
          info: getAsrEngineInfo(),
        });
      }

      // 3. POST /invoke - DreamMate Universal RPC Dispatcher
      if (req.method === 'POST' && pathname === '/invoke') {
        const raw = await readBody(req);
        let body: any = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return json(res, 400, { error: 'invalid json payload' });
        }

        const method = body.method ?? body.capability;
        const params = body.params ?? {};

        if (method === 'asr.info' || method === 'info') {
          return json(res, 200, getAsrEngineInfo());
        }

        if (method === 'asr.transcribe' || method === 'transcribe') {
          const audioPath =
            params.audio_path || params.audioPath || params.file_path || params.filePath;
          if (!audioPath || typeof audioPath !== 'string') {
            return json(res, 400, {
              error: '缺少必填参数: audio_path (音频绝对文件路径)',
            });
          }

          const options: TranscribeOptions = {
            output: params.output_dir || params.outputDir || params.output,
            format: params.format,
            lang: params.lang,
            itn: params.itn !== false,
            model: params.model,
          };

          const result = await runTranscription(audioPath, options);
          return json(res, 200, result);
        }

        return json(res, 404, {
          error: `未知方法: ${method}。支持的方法: ${Object.keys(ASR_METHODS).join(', ')}`,
        });
      }

      // 4. POST /transcribe - 直接转写调用
      if (req.method === 'POST' && pathname === '/transcribe') {
        const raw = await readBody(req);
        let body: any = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return json(res, 400, { error: 'invalid json payload' });
        }

        const audioPath = body.audio_path || body.audioPath || body.file_path || body.filePath;
        if (!audioPath || typeof audioPath !== 'string') {
          return json(res, 400, { error: '缺少必填字段: audio_path' });
        }

        const options: TranscribeOptions = {
          output: body.output_dir || body.outputDir || body.output,
          format: body.format,
          lang: body.lang,
          itn: body.itn !== false,
          model: body.model,
        };

        const result = await runTranscription(audioPath, options);
        return json(res, 200, result);
      }

      // 404 未知路由
      json(res, 404, { error: `no route: ${req.method} ${pathname}` });
    } catch (err: unknown) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

export async function serveTranscribe(options: ServerOptions = {}): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  const server = createTranscribeServer();
  const host = options.host ?? '127.0.0.1';
  const wantedPort = options.port ?? (process.env.TRANSCRIBE_PORT ? parseInt(process.env.TRANSCRIBE_PORT, 10) : DEFAULT_TRANSCRIBE_PORT);

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `端口 ${wantedPort} 已被占用。可换端口：--port <n>；或检查占用进程：lsof -nP -iTCP:${wantedPort} -sTCP:LISTEN`,
          ),
        );
      } else {
        reject(err);
      }
    });
    server.listen(wantedPort, host, resolve);
  });

  const { port } = server.address() as AddressInfo;
  const identity = await nodeIdentity().catch(() => ({ node_id: 'unknown', name: os.hostname() }));

  const reachability: Reachability =
    host === '127.0.0.1' || host === 'localhost' || host === '::1' ? 'localhost' : 'network';

  const reported =
    options.report === false
      ? undefined
      : await reportAndHoldRegistration({
          id: 'transcribe',
          name: '本地端侧语音转写引擎',
          kind: 'generic',
          port,
          reachability,
          health: '/health',
          methods: ASR_METHODS,
          skills: SKILLS_DIR,
          metadata: {
            version: getVersion(),
            hardware: process.platform === 'darwin' && process.arch === 'arm64' ? 'Metal' : 'CPU',
          },
        });

  console.log(`1transcribe serve — node ${identity.name} (${identity.node_id})`);
  console.log(`  HTTP: http://${host}:${port}/manifest`);
  console.log(`  Health: http://${host}:${port}/health`);
  console.log(`  Invoke: http://${host}:${port}/invoke`);
  console.log(`  capabilities: ${ASR_CAPABILITIES.join(', ')}`);

  if (reported) {
    console.log(
      reported.ok
        ? `  已向本机 node agent 报备（reachability=${reachability}，渐进式元工具可发现）`
        : `  未报备：${reported.reason}（node-agent 未就绪时不影响本服务独立提供能力）`,
    );
  }

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { server, port, close };
}
