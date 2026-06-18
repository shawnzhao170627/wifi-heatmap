#!/usr/bin/env node

/**
 * React Native Compatibility Checker
 *
 * Scans the project for APIs that exist in Node.js but NOT in React Native.
 * Run before every commit to catch issues like "uuid needs crypto".
 *
 * Usage: node scripts/rn-compat-check.js
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

// Node.js APIs that don't exist in React Native
const NODE_ONLY_GLOBALS = [
  'process\\.(exit|argv|cwd|chdir|pid|ppid|uptime|memoryUsage|cpuUsage|hrtime|umask|kill|abort)',
  'process\\.env\\.',
  'Buffer\\.(from|alloc|concat|byteLength|isBuffer|isEncoding)',
  '__dirname',
  '__filename',
  'setImmediate',
  'clearImmediate',
  'global\\.Buffer',
  'global\\.process',
];

const NODE_ONLY_MODULES = [
  'crypto',
  'fs',
  'path',
  'os',
  'child_process',
  'cluster',
  'dns',
  'http',
  'https',
  'net',
  'tls',
  'tty',
  'v8',
  'vm',
  'zlib',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'dgram',
  'http2',
  'perf_hooks',
  'util',
  'assert',
];

// Packages known to cause trouble in React Native without polyfills
const SUSPECT_PACKAGES = [
  { name: 'uuid', version: '>=9', reason: 'v9+ uses Node.js crypto.randomUUID()' },
  { name: 'nanoid', version: '>=4', reason: 'v4+ uses Node.js crypto module' },
  { name: 'ulid', version: '*', reason: 'uses Node.js crypto.randomBytes()' },
  { name: 'jsonwebtoken', version: '*', reason: 'uses Node.js crypto module' },
  { name: 'bcrypt', version: '*', reason: 'pure Node.js native addon' },
  { name: 'sharp', version: '*', reason: 'pure Node.js native addon' },
  { name: 'puppeteer', version: '*', reason: 'needs Node.js/Chromium' },
  { name: 'got', version: '*', reason: 'uses Node.js http module' },
  { name: 'node-fetch', version: '2.x', reason: 'v2 uses Node.js stream; use v3+' },
];

let errors = 0;
let warnings = 0;

function walkDir(dir, exts = ['.ts', '.tsx', '.js', '.jsx']) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...walkDir(full, exts));
    } else if (exts.some((ext) => full.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

console.log('🔍 React Native 兼容性检查\n');

// --- Check source files ---
console.log('📁 扫描源代码...');
const files = walkDir(SRC_DIR);

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const relPath = path.relative(path.join(__dirname, '..'), file);

  // Check require() usage (RN prefers ES module imports)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*const\s+\{.*\}\s*=\s*require\(/.test(line) ||
        /^\s*const\s+\w+\s*=\s*require\(/.test(line)) {
      console.log(`  ⚠️  ${relPath}:${i + 1}  require() — 建议用 ES import`);
      warnings++;
    }
  }

  // Check Node.js module imports
  for (const mod of NODE_ONLY_MODULES) {
    const regex = new RegExp(
      `(from\\s+['"]${mod}['"]|require\\s*\\(\\s*['"]${mod}['"]\\s*\\))`,
    );
    if (regex.test(content)) {
      console.log(`  ❌ ${relPath}  导入了 Node.js 模块: ${mod}`);
      errors++;
    }
  }

  // Check Node.js globals
  for (const g of NODE_ONLY_GLOBALS) {
    const regex = new RegExp(`\\b${g}\\b`);
    if (regex.test(content)) {
      console.log(`  ❌ ${relPath}  使用了 Node-only API: ${g}`);
      errors++;
    }
  }
}

// --- Check dependencies ---
console.log('\n📦 检查依赖包...');
const pkgJson = require(path.join(__dirname, '..', 'package.json'));
const allDeps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };

for (const suspect of SUSPECT_PACKAGES) {
  if (allDeps[suspect.name]) {
    const ver = allDeps[suspect.name].replace(/^[\^~]/, '');
    console.log(`  ⚠️  ${suspect.name}@${ver} — ${suspect.reason}`);
    warnings++;
  }
}

// --- Check nested dependencies for crypto ---
console.log('\n🔍 检查嵌套依赖...');
const nodeModules = path.join(__dirname, '..', 'node_modules');
const checked = new Set();

function checkNestedDep(modPath, depth = 0) {
  if (depth > 2) return; // Don't go too deep
  const pkgPath = path.join(modPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...(pkg.dependencies || {}) };

  for (const [name, ver] of Object.entries(deps)) {
    if (name === 'crypto' || name === 'buffer') {
      if (!checked.has(name)) {
        const usingPkg = path.basename(path.dirname(modPath));
        console.log(`  ⚠️  ${usingPkg} → ${name} (仅构建工具依赖，运行时可能无害)`);
      }
    }
  }
}

// Direct node_modules check
for (const entry of fs.readdirSync(nodeModules)) {
  if (entry.startsWith('.') || entry.startsWith('@')) continue;
  const full = path.join(nodeModules, entry);
  if (fs.statSync(full).isDirectory()) {
    checkNestedDep(full, 0);
  }
}

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
if (errors > 0) {
  console.log(`❌ ${errors} 个错误 — 必须修复才能正常运行`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`⚠️  ${warnings} 个警告 — 建议审查`);
  process.exit(0);
} else {
  console.log('✅ 全部通过 — 代码兼容 React Native');
  process.exit(0);
}
