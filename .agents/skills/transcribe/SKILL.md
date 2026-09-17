---
name: transcribe
description: >-
  基于 @1agents/transcribe 的本地端侧极速语音识别（ASR）、字幕生成与转写技能。
  当以下任一情况出现时激活本技能：
  1. 用户需要对本地音频（mp3, m4a, wav, flac, aac, ogg 等）进行离线语音转文字、提取逐字稿或生成带时间轴的字幕（SRT / VTT / TXT）；
  2. 用户询问或需要安装、配置、升级 @1agents/transcribe 或调用 transcribe / 1transcribe 命令行工具；
  3. 用户需要将播客单集、会议录音、视频配音等进行高效批量转写；
  4. 用户需要配置 ModelScope 模型源自动加速拉取、或配置跨平台原生推理后端（Apple Silicon Metal / Windows / Linux）。
  关键词：transcribe, 1transcribe, @1agents/transcribe, 转写, 语音识别, ASR, 字幕, srt, vtt, 逐字稿, sensevoice, 音频转文字, 播客转写, 离线识别
---

# @1agents/transcribe 端侧极速转写与字幕生成技能

本技能指导 Agent 如何安装、配置并使用开源端侧 ASR 转写工具 **[`@1agents/transcribe`](https://www.npmjs.com/package/@1agents/transcribe)**，在本地无网络泄露风险的前提下，实现 20x~35x 实时速度的高精度离线语音识别与字幕生成。

---

## 一、核心特性与架构

- **极速端侧推理**：基于优化量化的 SenseVoice-Small GGUF 模型，Apple Silicon (Metal) 下实测 **28.6x 实时吞吐**（20 秒音频仅需 0.7 秒完成）。
- **国内极速分发**：默认集成 **ModelScope（魔搭社区）** 国内直链，首次执行按需秒级下载并自动比对 SHA256 指纹，国内免翻墙、不卡顿。
- **纯粹隐私安全**：音频不经过任何云端 API，完全在宿主机本地内存与芯片完成计算。
- **双重 CLI 命名**：支持 `transcribe` 和 `1transcribe` 两个全局指令，与 1agents 工具生态无缝对齐。

---

## 二、安装与运行方式

`@1agents/transcribe` 支持免安装即用或全局安装：

### 方式 1：免安装立即执行 (npx)
无需提前全局安装，npm 会自动拉取最新包并在本地执行：
```bash
npx @1agents/transcribe <音频文件路径> [选项]
```

### 方式 2：全局安装 (推荐)
```bash
npm install -g @1agents/transcribe
```
安装后系统将拥有 `transcribe` 与 `1transcribe` 别名命令：
```bash
# 查看版本确认安装
transcribe --version
# 或
1transcribe --version
```

### 方式 3：更新到最新版本
```bash
npm install -g @1agents/transcribe@latest
```

---

## 三、命令行参数规范

```text
transcribe <input-audio-file> [options]
```

### 参数与选项
| 参数 / 选项 | 简写 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `<input>` | - | *(必需)* | 输入音频文件路径，支持 `~` 展开与各种主流格式（mp3, m4a, wav, aac, flac 等） |
| `--output <dir>` | `-o` | 音频同级目录 | 输出字幕与文本文件的保存目录（自动递归创建） |
| `--format <fmt>` | `-f` | `all` | 输出格式：可选 `srt`（字幕）、`vtt`（网络视频字幕）、`txt`（纯逐字稿）、`all`（三者全输出） |
| `--model <path>` | `-m` | 默认模型 | 自定义 GGUF 模型文件路径（未指定时自动从 ModelScope 拉取） |
| `--help` | `-h` | - | 显示帮助信息 |
| `--version` | `-v` | - | 输出当前 CLI 版本 |

---

## 四、常用工作流与实操范例

### 1. 基础音频单文件转写（默认输出 SRT + VTT + TXT）
```bash
transcribe ~/Downloads/interview.mp3
```

### 2. 仅生成带时间轴的 SRT 字幕至指定目录
```bash
transcribe /path/to/podcast.m4a -o ~/Documents/Subtitles/ -f srt
```

### 3. 提取纯文本逐字稿
```bash
transcribe /path/to/meeting_record.wav -o ./transcripts -f txt
```

### 4. 批量处理某个文件夹下的所有音频（Agent 辅助循环）
当用户需要批量转写目录下所有音频时，可在终端中执行安全循环：
```bash
for audio in ~/Downloads/podcasts/*.{mp3,m4a}; do
  [ -e "$audio" ] || continue
  echo "正在转写: $audio ..."
  transcribe "$audio" -o ~/Documents/Subtitles -f all
done
```

---

## 五、环境拓扑与跨平台原生引擎绑定

`@1agents/transcribe` 是轻量 Node.js / CLI 调度层，底层调度极速原生推理引擎。

### 1. 寻找原生二进制的默认策略
CLI 会按以下顺序检索原生执行引擎 `transcribe-cli`（Windows 下为 `transcribe-cli.exe`）：
1. 环境变量 `TRANSCRIBE_BIN_PATH` 指定的绝对路径；
2. 用户主目录：`~/.local/bin/transcribe-cli`；
3. 系统全局目录：`/usr/local/bin/transcribe-cli` 或 `/opt/homebrew/bin/transcribe-cli`；
4. 本地源码工程编译产物路径（适用于开发者调试）。

> [!TIP]
> 如果在非标准路径或 Windows/Linux 上，可通过设置环境变量指定原生二进制：
> ```bash
> export TRANSCRIBE_BIN_PATH="/custom/path/to/transcribe-cli"
> ```

### 2. 模型缓存存储
- 模型默认保存在：`~/.transcribe_models/SenseVoiceSmall-Q8_0.gguf`。
- 如果需要指定模型缓存目录，可配置环境变量：
  ```bash
  export TRANSCRIBE_MODELS_DIR="/Volumes/ExternalSSD/models"
  ```
- 托管镜像信息：
  - ModelScope：`scott887/SenseVoiceSmall-Q8_0.gguf`
  - 文件大小：约 241 MB
  - SHA256 校验码：`6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29`

---

## 六、Node.js / TypeScript SDK 编程调用

在其他自动化应用或 Node.js 项目中，可以直接以模块导入调用：

```typescript
import { runTranscription, ensureModel, resolveModel } from '@1agents/transcribe';

// 1. 确保模型就绪（若不存在自动从 ModelScope 下载）
const modelPath = await ensureModel();

// 2. 执行转写任务
const result = await runTranscription('/path/to/audio.mp3', {
  output: './dist_subtitles',
  format: 'all',
});

console.log(`转写完成！用时: ${result.durationMs}ms`);
console.log('生成产物:', result.outputFiles);
```

---

## 七、常见异常排查 (Troubleshooting)

1. **未检测到原生转写引擎 (`未检测到原生转写引擎二进制`)**：
   - 确认宿主机已安装原生二进制到 `~/.local/bin/transcribe-cli`，或运行 `which transcribe-cli` 确认。
   - macOS 用户可由本地 `TranscribeKit` 项目通过 `swift build -c release` 编译生成并软链至 `~/.local/bin/`。
2. **下载模型超时或网络抖动**：
   - 模型托管于阿里云 ModelScope 国内 CDN，如遇网络中断，直接重新执行命令，内部会自动断点探测与重新同步，下载完成后自动校验 SHA256。
3. **音频文件权限或路径包含空格**：
   - CLI 内部已进行全量安全路径转义与 `~` 目录展开，支持各种含空格的文件名（如 `My Podcast Episode 01.m4a`）。
