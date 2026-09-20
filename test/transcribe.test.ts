import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveModel, DEFAULT_MODEL, getModelsCacheDir } from '../src/model.js';
import { findNativeBinary } from '../src/runner.js';
import { getVersion } from '../src/cli.js';

test('version inspection', () => {
  const version = getVersion();
  assert.match(version, /^\d+\.\d+\.\d+/);
});

test('model resolution', () => {
  const cacheDir = getModelsCacheDir();
  assert.ok(cacheDir.length > 0);
  assert.ok(cacheDir.endsWith('models'));
  const resolved = resolveModel();
  if (resolved && DEFAULT_MODEL.fileName) {
    assert.ok(resolved.endsWith(DEFAULT_MODEL.fileName));
  }
});

test('native binary resolution (fallback or env)', () => {
  const binary = findNativeBinary();
  assert.ok(binary === null || typeof binary === 'string');

  // Test env override
  const tmpFile = path.join(os.tmpdir(), `test-bin-${Date.now()}`);
  fs.writeFileSync(tmpFile, '');
  const prevEnv = process.env.TRANSCRIBE_BIN_PATH;
  try {
    process.env.TRANSCRIBE_BIN_PATH = tmpFile;
    assert.equal(findNativeBinary(), tmpFile);
  } finally {
    if (prevEnv !== undefined) {
      process.env.TRANSCRIBE_BIN_PATH = prevEnv;
    } else {
      delete process.env.TRANSCRIBE_BIN_PATH;
    }
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
});
