# @1agents/transcribe

<p align="left">
  <a href="https://www.npmjs.com/package/@1agents/transcribe"><img src="https://img.shields.io/npm/v/@1agents/transcribe.svg?style=flat-square" alt="npm version"></a>
  <a href="https://github.com/scottzx/transcribe/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="license"></a>
  <a href="https://modelscope.cn/models/scott887/SenseVoiceSmall-Q8_0.gguf"><img src="https://img.shields.io/badge/ModelScope-scott887-orange.svg?style=flat-square" alt="modelscope"></a>
  <a href="https://modelscope.cn/models/scott887/speech"><img src="https://img.shields.io/badge/FunASR-speech-blue.svg?style=flat-square" alt="funasr-speech"></a>
</p>

Ultra-fast, on-device Speech-to-Text (ASR) engine and CLI with **Apple Silicon Metal acceleration**, **FunASR verbatim (字级) transcripts**, **ModelScope China CDN auto-download**, and **multi-format subtitle exports** (`.srt`, `.vtt`, `.txt`, `.chars.jsonl`).

端侧极速语音识别与字幕生成工具：内置 SenseVoice GGUF 极速引擎与 FunASR Paraformer 高精度逐字稿，ModelScope 镜像按需下载模型，零云端 API 成本，隐私 100% 本地闭环。

---

## ✨ 核心特性 / Features

* 🚀 **极速离线推理**：SenseVoice GGUF 在 Apple Silicon 上跑出 **30x+ 实时加速比**（20 秒音频转写仅需 0.7 秒）。
* 🎯 **FunASR 高精度逐字稿**：`--engine funasr` 使用 Seaco Paraformer，原生字级毫秒时间戳（比 GGUF 更适合中文精修 / 去语气词）。
* 📦 **ModelScope 极速镜像分发**：GGUF 走 [`scott887/SenseVoiceSmall-Q8_0.gguf`](https://modelscope.cn/models/scott887/SenseVoiceSmall-Q8_0.gguf)；FunASR 四件套走 [`scott887/speech`](https://modelscope.cn/models/scott887/speech)，软链到仓库根目录 `models/`。
* 📝 **多格式字幕与逐字稿**：`.srt` / `.vtt` / `.txt`，以及 FunASR 的 `.chars.jsonl` 字级逐字稿。
* 🔒 **100% 本地隐私安全**：无需上传音频到任何第三方服务器，不消耗任何大模型 Token。
* 🌐 **多语种与数字规整 (ITN)**：精通中、英、粤、日、韩五语，内置逆文本规整，数字与日期自动规范化。

---

## ⚡️ 快速上手 / Quick Start

无需安装，使用 `npx` 直接转写任意音视频文件：

```bash
npx @1agents/transcribe meeting.mp3
```

或者全局安装命令行工具：

```bash
npm install -g @1agents/transcribe

# 安装后直接使用 transcribe 或 1transcribe 命令
transcribe podcast.m4a -o ./output/ -f srt
```

---

## 📖 CLI 命令行选项 / Usage

```bash
transcribe <音频文件路径> [选项]
```

| 参数 | 简写 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `--output` | `-o` | 音频同级目录 | 输出目录或文件名 |
| `--format` | `-f` | `all` | 导出格式：`srt`, `vtt`, `txt`, `chars`, `all` |
| `--engine` | `-e` | `gguf` | 推理引擎：`gguf`（极速）或 `funasr`（高精度逐字稿） |
| `--model` | `-m` | 按引擎 | 模型 ID（`sensevoice-small-q8` / `funasr-paraformer`）或本地路径 |
| `--lang` | `-l` | `zh` | 语种提示：`zh` (中文), `en`, `yue` (粤语), `ja`, `ko` |
| `--no-itn` | | 开启 | 关闭逆文本规整 / FunASR 标点 |
| `--chars-out` | | | FunASR 字级逐字稿 JSONL 路径 |
| `--sentences-out` | | | FunASR 句级 JSONL 路径 |
| `--no-diarize` | | 开启说话人 | 关闭 FunASR CampPlus 说话人分离 |
| `--version` | `-v` | | 查看当前工具版本 |
| `--help` | `-h` | | 查看帮助菜单 |

### 使用范例

```bash
# 1. 默认转写：自动生成 .srt, .vtt, .txt 三种格式
transcribe interview.mp3

# 2. 仅导出 SRT 格式到指定目录
transcribe podcast.m4a -o ~/Desktop/Subtitles/ -f srt

# 3. 指定转写粤语
transcribe voice_note.wav -l yue

# 4. FunASR 高精度逐字稿（字级时间戳）
transcribe interview.mp3 --engine funasr
transcribe interview.mp3 -m funasr-paraformer -f chars

# 5. 查看本地模型
transcribe models
```

FunASR 首次使用需安装 Python 环境并把模型软链到仓库根目录 `models/`：

```bash
transcribe setup-funasr
# 或复用已有 FunASR venv
transcribe setup-funasr --link-venv /path/to/.venv
```

---

## 💻 编程式调用 / Programmatic API

你也可以在 Node.js / TypeScript 项目中直接导入使用：

```typescript
import { transcribe, resolveModel, ensureModel, MODELS } from '@1agents/transcribe';

// 1. 执行音视频转写
const result = await transcribe('path/to/audio.mp3', {
  format: 'srt',
  lang: 'zh',
  output: './subtitles'
});

console.log(`转写完成！耗时: ${result.elapsedSec}s，字幕共 ${result.itemCount} 条`);
console.log(`SRT 文件路径: ${result.files.srt}`);

// 3. FunASR 字级逐字稿
const verbatim = await transcribe('path/to/audio.mp3', {
  engine: 'funasr',
  format: 'chars',
});
console.log(`逐字稿: ${verbatim.files.chars}`);

// 2. 预先拉取/确保模型就绪
const modelPath = await ensureModel();
console.log(`模型已就绪: ${modelPath}`);
```

---

## 🌐 DreamMate Network 服务模式 (ASR 能力节点)

`transcribe` 现已深度整合 **DreamMate Network v0.5.0** 规范。你可以一键将当前机器启动为一个常驻 ASR 引擎服务，并自动向本机 `dreammate-node`（:36908）进行能力报备与心跳探活：

```bash
# 启动常驻服务 (默认监听 7782 端口，并自动向 dreammate-node 报备)
transcribe serve

# 自定义端口或指定主机
transcribe serve --port 7785 --host 0.0.0.0

# 纯本地调试模式 (不向 node agent 报备)
transcribe serve --no-report
```

### 接入收益与大模型调度
1. **两阶段渐进式发现（Progressive Discovery）**：
   通过自声明 `asr.transcribe` 与 `asr.info` 契约及 JSON Schema 参数定义，大模型只需调用 `dreammate_list_capabilities` 与 `dreammate_inspect` 即可按需加载参数，彻底杜绝全局提示词上下文膨胀。
2. **通用分布式执行器（Universal RPC Dispatcher）**：
   大模型在任意客户端发起 `dreammate_invoke({ service_id: "transcribe", capability: "asr.transcribe", params: { audio_path: "/path/to/audio.mp3" } })`，即可跨节点透明调度本机的端侧转写引擎！
3. **HTTP 契约端点**：
   - `GET /health`：存活探测心跳，供 node-agent 定期检查。
   - `GET /manifest`：返回符合规范的节点能力清单与方法描述。
   - `POST /invoke`：Universal RPC 分发入口，接收 `{ capability, params }`。
   - `POST /transcribe`：RESTful 风格直接转写调用。


---

## 🧠 推荐模型矩阵 / Supported Models

| 模型 ID | 引擎 | 说明 | 推荐场景 | 镜像源 |
| :--- | :--- | :--- | :--- | :--- |
| `sensevoice-small-q8`（默认） | `gguf` | SenseVoice Small Q8_0 (~241MB) | 五语极速转写、播客、口播 | [scott887/SenseVoiceSmall-Q8_0.gguf](https://modelscope.cn/models/scott887/SenseVoiceSmall-Q8_0.gguf) |
| `funasr-paraformer` | `funasr` | Seaco Paraformer + FSMN-VAD + 标点 + CampPlus | **中文逐字稿**、字级精修、去语气词 | [scott887/speech](https://modelscope.cn/models/scott887/speech) |

模型统一存放在本仓库根目录 **`models/`**（可用 `TRANSCRIBE_MODELS_DIR` 覆盖）。旧路径 `~/.transcribe_models/` 中的 GGUF 会在首次解析时自动迁移过来。

FunASR 四件套从 [`scott887/speech`](https://modelscope.cn/models/scott887/speech) 一次拉取（ASR `model.pt` 约 990MB，含 VAD / 标点 / CampPlus），软链到 `models/{seaco_paraformer,fsmn_vad,punc_ct,campplus}`。

---

## 🤝 参与开源 / Contributing

欢迎贡献代码、提出 Issue 或 PR！

```bash
git clone https://github.com/scottzx/transcribe.git
cd transcribe
npm install
npm run build
npm test
```

---

## 📄 开源协议 / License

本项目基于 [MIT 许可证](LICENSE) 开源。
