import test from 'node:test';
import assert from 'node:assert/strict';
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
  const resolved = resolveModel();
  // If model is present in ~/.transcribe_models, should resolve
  if (resolved) {
    assert.ok(resolved.endsWith(DEFAULT_MODEL.fileName));
  }
});

test('native binary resolution', () => {
  const binary = findNativeBinary();
  assert.ok(binary !== null, 'Should find native transcribe binary');
});
