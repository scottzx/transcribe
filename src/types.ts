export type AsrEngine = 'gguf' | 'funasr';

export type OutputFormat = 'srt' | 'vtt' | 'txt' | 'chars' | 'jsonl' | 'all';

export interface SubtitleItem {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  originalText: string;
  translatedText?: string;
}

export interface TranscribeOptions {
  output?: string;
  format?: OutputFormat;
  lang?: string;
  itn?: boolean;
  /** 模型 ID（如 funasr-paraformer）或 GGUF/目录路径 */
  model?: string;
  engine?: AsrEngine;
  threads?: number;
  quiet?: boolean;
  charsOut?: string;
  sentencesOut?: string;
  fillersOut?: string;
  assetId?: string;
  /** FunASR 说话人分离，默认 true */
  diarize?: boolean;
  python?: string;
}

export interface TranscribeResult {
  audioPath: string;
  durationSec: number;
  elapsedSec: number;
  speedFactor: number;
  itemCount: number;
  engine: AsrEngine;
  modelId: string;
  files: {
    srt?: string;
    vtt?: string;
    txt?: string;
    chars?: string;
    sentences?: string;
    fillers?: string;
  };
}

export interface ASRModelInfo {
  id: string;
  name: string;
  engine: AsrEngine;
  fileName?: string;
  sizeBytes?: number;
  sha256?: string;
  modelScopeURL?: string;
  huggingFaceURL?: string;
  supportsChars?: boolean;
}
