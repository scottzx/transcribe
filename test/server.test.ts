import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTranscribeServer, ASR_CAPABILITIES, ASR_METHODS, ASR_SKILLS, getAsrEngineInfo } from '../src/server.js';

test('getAsrEngineInfo returns structural engine metadata', () => {
  const info = getAsrEngineInfo();
  assert.equal(info.service, 'transcribe');
  assert.ok(info.version);
  assert.ok(info.model.name);
  assert.ok(Array.isArray(ASR_CAPABILITIES));
  assert.ok('asr.transcribe' in ASR_METHODS);
  assert.ok('asr.info' in ASR_METHODS);
  assert.ok('transcribe' in ASR_SKILLS);
  assert.ok(ASR_SKILLS.transcribe.sop?.includes('转写') || ASR_SKILLS.transcribe.sop?.includes('SOP'));
});

test('HTTP server lifecycle and endpoints', async () => {
  const server = createTranscribeServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json() as any;
    assert.equal(healthData.status, 'ok');
    assert.equal(healthData.service, 'transcribe');
    assert.deepEqual(healthData.capabilities, [...ASR_CAPABILITIES]);

    // 2. GET /manifest
    const manifestRes = await fetch(`${baseUrl}/manifest`);
    assert.equal(manifestRes.status, 200);
    const manifestData = await manifestRes.json() as any;
    assert.equal(manifestData.id, 'transcribe');
    assert.ok(manifestData.methods['asr.transcribe']);
    assert.ok(manifestData.methods['asr.info']);
    assert.ok(manifestData.skills['transcribe']);
    assert.equal(manifestData.skills['transcribe'].name, 'transcribe');

    // 3. POST /invoke -> method asr.info
    const invokeInfoRes = await fetch(`${baseUrl}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'asr.info', params: {} }),
    });
    assert.equal(invokeInfoRes.status, 200);
    const invokeInfoData = await invokeInfoRes.json() as any;
    assert.equal(invokeInfoData.service, 'transcribe');
    assert.ok(invokeInfoData.model);

    // 4. POST /invoke -> missing audio_path
    const invokeMissingRes = await fetch(`${baseUrl}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capability: 'asr.transcribe', params: {} }),
    });
    assert.equal(invokeMissingRes.status, 400);
    const missingData = await invokeMissingRes.json() as any;
    assert.match(missingData.error, /audio_path/);

    // 5. POST /invoke -> unknown capability
    const unknownRes = await fetch(`${baseUrl}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capability: 'unknown.cap' }),
    });
    assert.equal(unknownRes.status, 404);

    // 6. POST /transcribe -> invalid payload
    const badJsonRes = await fetch(`${baseUrl}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'invalid-json',
    });
    assert.equal(badJsonRes.status, 400);

    // 7. Unknown route
    const notFoundRes = await fetch(`${baseUrl}/non-existent`);
    assert.equal(notFoundRes.status, 404);

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
