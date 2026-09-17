#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 优先加载已编译的 dist/cli.js，若处于开发源码态则尝试动态加载
const distCli = path.resolve(__dirname, '../dist/cli.js');
const srcCli = path.resolve(__dirname, '../src/cli.ts');

if (fs.existsSync(distCli)) {
  const { runCLI } = await import(distCli);
  await runCLI();
} else {
  // 开发态回退
  try {
    const { runCLI } = await import(srcCli);
    await runCLI();
  } catch (err) {
    console.error('未找到构建产物，请先在项目中执行: npm run build');
    process.exit(1);
  }
}
