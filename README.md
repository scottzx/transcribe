# @1agents/transcribe

<p align="left">
  <a href="https://www.npmjs.com/package/@1agents/transcribe"><img src="https://img.shields.io/npm/v/@1agents/transcribe.svg?style=flat-square" alt="npm version"></a>
  <a href="https://github.com/scottzx/transcribe/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="license"></a>
  <a href="https://modelscope.cn/models/scott887/SenseVoiceSmall-Q8_0.gguf"><img src="https://img.shields.io/badge/ModelScope-scott887-orange.svg?style=flat-square" alt="modelscope"></a>
</p>

Ultra-fast, on-device Speech-to-Text (ASR) engine and CLI with **Apple Silicon Metal acceleration**, **ModelScope China CDN auto-download**, and **multi-format subtitle exports** (`.srt`, `.vtt`, `.txt`).

端侧极速语音识别与字幕生成工具：内置 ModelScope 极速镜像源自动按需下载模型，基于 Metal 硬件加速（30x+ 实时转写），零云端 API 成本，隐私 100% 本地闭环。

---

## ✨ 核心特性 / Features

* 🚀 **极速离线推理**：在 Apple Silicon (M1/M2/M3/M4) 上跑出 **30x+ 实时加速比**（20 秒音频转写仅需 0.7 秒，1 小时播客不到 2 分钟）。
* 📦 **ModelScope 极速镜像分发**：首次运行自动从国内阿里云 OSS 骨干网（[`scott887/SenseVoiceSmall-Q8_0.gguf`](https://modelscope.cn/models/scott887/SenseVoiceSmall-Q8_0.gguf)）拉取模型，数秒即可下载完毕，并进行 SHA256 完整性校验，彻底告别海外下载断连。
* 📝 **多格式字幕与逐字稿**：一键生成带精准时间戳的 `.srt`、`.vtt` 字幕以及规整后的 `.txt` 纯文本。
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
| `--format` | `-f` | `all` | 导出格式：`srt`, `vtt`, `txt`, `all` |
| `--lang` | `-l` | `zh` | 语种提示：`zh` (中文), `en`, `yue` (粤语), `ja`, `ko` |
| `--no-itn` | | 开启 | 关闭逆文本规整（保留原始口语发音词） |
| `--model` | `-m` | 自动解析 | 显式指定自定义 GGUF 模型文件路径 |
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
```

---

## 💻 编程式调用 / Programmatic API

你也可以在 Node.js / TypeScript 项目中直接导入使用：

```typescript
import { transcribe, resolveModel, ensureModel } from '@1agents/transcribe';

// 1. 执行音视频转写
const result = await transcribe('path/to/audio.mp3', {
  format: 'srt',
  lang: 'zh',
  output: './subtitles'
});

console.log(`转写完成！耗时: ${result.elapsedSec}s，字幕共 ${result.itemCount} 条`);
console.log(`SRT 文件路径: ${result.files.srt}`);

// 2. 预先拉取/确保模型就绪
const modelPath = await ensureModel();
console.log(`模型已就绪: ${modelPath}`);
```

---

## 🧠 推荐模型矩阵 / Supported Models

工具默认采用兼顾极速与高精度的 **SenseVoice Small**：

| 模型 | 文件名 | 格式 | 推荐场景 | 镜像源 |
| :--- | :--- | :--- | :--- | :--- |
| **SenseVoice Small** (默认) | `SenseVoiceSmall-Q8_0.gguf` | Q8_0 (~241MB) | 中/英/粤/日/韩五语极速转写、视频口播、播客 | [ModelScope 托管](https://modelscope.cn/models/scott887/SenseVoiceSmall-Q8_0.gguf) |
| **SenseVoice Small (轻量)** | `SenseVoiceSmall-Q4_K_M.gguf` | Q4_K_M (~139MB) | 移动端、超轻量低显存场景 | 即将发布 |

模型文件在首次下载后将永久保存在系统的用户缓存目录：
* **macOS / Linux**: `~/.transcribe_models/`
* **Windows**: `%USERPROFILE%\.transcribe_models\`

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
