export interface SubtitleItem {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  originalText: string;
  translatedText?: string;
}

export interface TranscribeOptions {
  output?: string;
  format?: 'srt' | 'vtt' | 'txt' | 'all';
  lang?: string;
  itn?: boolean;
  model?: string;
  threads?: number;
}

export interface TranscribeResult {
  audioPath: string;
  durationSec: number;
  elapsedSec: number;
  speedFactor: number;
  itemCount: number;
  files: {
    srt?: string;
    vtt?: string;
    txt?: string;
  };
}

export interface ASRModelInfo {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  modelScopeURL: string;
  huggingFaceURL: string;
}
