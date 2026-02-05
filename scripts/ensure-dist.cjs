const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const distIndex = path.join(process.cwd(), 'dist', 'index.html');
if (fs.existsSync(distIndex)) {
  console.log(`[prestart] dist/index.html found at ${distIndex}`);
  process.exit(0);
}

console.log('[prestart] dist/index.html missing. Running build...');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCmd, ['run', 'build'], { stdio: 'inherit' });
if (result.error) {
  console.error('[prestart] build failed:', result.error.message);
}
process.exit(result.status ?? 1);
