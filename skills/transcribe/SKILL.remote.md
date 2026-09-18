---
name: transcribe
description: 基于 @1agents/transcribe 的局域网/跨节点端侧语音识别与字幕生成技能（网络分布式 RPC 版）
---

# @1agents/transcribe 跨节点分布式转写技能指南

本技能指导 Agent 如何通过 **DreamMate Network 网关** 透明跨节点调用远程或本机设备上的 `transcribe` ASR 微服务。

## 一、两阶段发现流程

1. **第 1 步：服务发现**
   调用 `dreammate_list_services({ keyword: "transcribe" })` 或 `dreammate_list_nodes()` 确认提供 ASR 服务的设备节点。

2. **第 2 步：按需检索契约**
   调用 `dreammate_inspect({ service_id: "transcribe", method: "asr.transcribe" })` 获取最新参数 Schema。

## 二、通用调用范式 (dreammate_invoke)

### 1. 执行转写 (asr.transcribe)
```json
{
  "service_id": "transcribe",
  "method": "asr.transcribe",
  "params": {
    "audio_path": "/absolute/path/to/audio.mp3",
    "format": "all",
    "lang": "zh",
    "itn": true
  }
}
```

### 2. 查询 ASR 引擎与硬件加速就绪状态 (asr.info)
```json
{
  "service_id": "transcribe",
  "method": "asr.info",
  "params": {}
}
```
