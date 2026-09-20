import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printHelp, printModels } from '../src/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(__dirname, '../bin/transcribe.js');

test('CLI invoke with --payload returns pure JSON for asr.info', async () => {
  const proc = spawn('node', [binPath, 'invoke', '--payload', JSON.stringify({ method: 'asr.info' })], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  const code = await new Promise<number>((resolve) => proc.on('close', resolve));
  assert.equal(code, 0);

  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.service, 'transcribe');
  assert.ok(parsed.version);
});

test('CLI invoke via stdin pipe returns pure JSON', async () => {
  const proc = spawn('node', [binPath, 'invoke'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });

  proc.stdin.write(JSON.stringify({ method: 'asr.info' }));
  proc.stdin.end();

  const code = await new Promise<number>((resolve) => proc.on('close', resolve));
  assert.equal(code, 0);

  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.service, 'transcribe');
});

test('CLI help lists FunASR engine and model subcommand', () => {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    printHelp();
  } finally {
    console.log = orig;
  }
  const stdout = logs.join('\n');
  assert.match(stdout, /funasr/);
  assert.match(stdout, /funasr-paraformer/);
  assert.match(stdout, /chars-out/);
  assert.match(stdout, /setup-funasr/);
});

test('CLI models lists catalog ids', () => {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    printModels();
  } finally {
    console.log = orig;
  }
  const stdout = logs.join('\n');
  assert.match(stdout, /sensevoice-small-q8/);
  assert.match(stdout, /funasr-paraformer/);
  assert.match(stdout, /models/);
});

test('CLI invoke with missing audio_path exits with 1 and returns JSON error', async () => {
  const proc = spawn('node', [binPath, 'invoke', '--payload', JSON.stringify({ method: 'asr.transcribe', params: {} })], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });

  const code = await new Promise<number>((resolve) => proc.on('close', resolve));
  assert.equal(code, 1);

  const parsed = JSON.parse(stdout.trim());
  assert.ok(parsed.error);
  assert.match(parsed.error, /audio_path/);
});
