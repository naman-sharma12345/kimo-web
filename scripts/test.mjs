import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
);
const child = spawn(
  process.execPath,
  [entry, 'run', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
