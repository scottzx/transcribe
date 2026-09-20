import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  DEFAULT_MODEL,
  FUNASR_PARAFORMER,
  getModelById,
  getModelsCacheDir,
  getPackageRoot,
  resolveEngine,
} from '../src/model.js';
import { formatSrtTimestamp, sentencesToSrt, sentencesToTxt, sentencesToVtt } from '../src/funasr.js';

test('default models cache dir ends with models and respects env', () => {
  const prev = process.env.TRANSCRIBE_MODELS_DIR;
  try {
    delete process.env.TRANSCRIBE_MODELS_DIR;
    const cacheDir = getModelsCacheDir();
    assert.ok(cacheDir.endsWith('models'));

    process.env.TRANSCRIBE_MODELS_DIR = '/tmp/custom-models';
    assert.equal(getModelsCacheDir(), '/tmp/custom-models');
  } finally {
    if (prev !== undefined) process.env.TRANSCRIBE_MODELS_DIR = prev;
    else delete process.env.TRANSCRIBE_MODELS_DIR;
  }
});

test('model catalog includes gguf and funasr', () => {
  assert.equal(DEFAULT_MODEL.engine, 'gguf');
  assert.equal(FUNASR_PARAFORMER.engine, 'funasr');
  assert.equal(FUNASR_PARAFORMER.supportsChars, true);
  assert.equal(FUNASR_PARAFORMER.modelScopeURL, 'https://modelscope.cn/models/scott887/speech');
  assert.equal(getModelById('funasr-paraformer')?.id, 'funasr-paraformer');
  assert.equal(getModelById('sensevoice-small-q8')?.engine, 'gguf');
});

test('resolveEngine from flags and model ids', () => {
  assert.equal(resolveEngine({}), 'gguf');
  assert.equal(resolveEngine({ engine: 'funasr' }), 'funasr');
  assert.equal(resolveEngine({ model: 'funasr-paraformer' }), 'funasr');
  assert.equal(resolveEngine({ model: 'sensevoice-small-q8' }), 'gguf');
  assert.equal(resolveEngine({ format: 'chars' }), 'funasr');
  assert.equal(resolveEngine({ charsOut: '/tmp/x.chars.jsonl' }), 'funasr');
  assert.equal(resolveEngine({ model: '/tmp/SenseVoiceSmall-Q8_0.gguf' }), 'gguf');
});

test('subtitle conversion from FunASR sentences', () => {
  const rows = [
    { i: 0, text: '你好。', start: 120, end: 900 },
    { i: 1, text: '欢迎使用。', start: 1000, end: 1800 },
  ];
  assert.equal(formatSrtTimestamp(120), '00:00:00,120');
  const srt = sentencesToSrt(rows);
  assert.match(srt, /00:00:00,120 --> 00:00:00,900/);
  assert.match(srt, /你好。/);
  const vtt = sentencesToVtt(rows);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:00.120 --> 00:00:00.900/);
  assert.equal(sentencesToTxt(rows), '你好。\n欢迎使用。\n');
});
