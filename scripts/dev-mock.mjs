import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** @param {Record<string, string | undefined>} source */
export function mockEnvironment(source) {
  const env = Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        !/^(KIMO_|NEXT_PUBLIC_KIMO_)/.test(key) &&
        !/(?:TOKEN|SECRET|PASSWORD|COOKIE|AUTHORIZATION)/i.test(key),
    ),
  );
  env.NODE_ENV = 'development';
  return {
    ...env,
    PORT: '8787',
    NEXT_PUBLIC_KIMO_API: 'http://localhost:8787',
    NEXT_PUBLIC_KIMO_WS: 'ws://localhost:8787',
  };
}
export async function checkPort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
/**
 * @param {{
 * start?: (command: string, args: string[], options: import('node:child_process').SpawnOptions) => import('node:child_process').ChildProcess,
 * available?: (port: number) => Promise<void>,
 * request?: typeof globalThis.fetch,
 * wait?: (ms: number) => Promise<unknown>,
 * source?: Record<string, string | undefined>,
 * signals?: Pick<import('node:events').EventEmitter, 'on' | 'removeListener'>,
 * readinessAttempts?: number,
 * graceMs?: number
 * }} [options]
 */
export async function supervise({
  start = spawn,
  available = checkPort,
  request = globalThis.fetch,
  wait = delay,
  source = process.env,
  signals = process,
  readinessAttempts = 40,
  graceMs = 2000,
} = {}) {
  await available(8787);
  await available(3000);
  const children = [];
  let stopping = false;
  let code = 0;
  let finish;
  const completed = new Promise((resolve) => {
    finish = resolve;
  });
  const env = mockEnvironment(source);
  const root = fileURLToPath(new URL('..', import.meta.url));
  function signalChild(child, signal) {
    if (!child.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      /* already exited */
    }
  }
  async function stop(exitCode) {
    if (stopping) return;
    stopping = true;
    code = exitCode;
    signals.removeListener('SIGINT', interrupt);
    signals.removeListener('SIGTERM', terminate);
    for (const child of children) signalChild(child, 'SIGTERM');
    await wait(graceMs);
    for (const child of children) signalChild(child, 'SIGKILL');
    finish(code);
  }
  const interrupt = () => {
    void stop(130);
  };
  const terminate = () => {
    void stop(143);
  };
  signals.on('SIGINT', interrupt);
  signals.on('SIGTERM', terminate);
  function launch(filter, command) {
    const child = start('pnpm', ['--filter', filter, command], {
      cwd: root,
      env,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    children.push(child);
    child.once('error', () => {
      void stop(1);
    });
    child.once('exit', (exitCode) => {
      if (!stopping) void stop(exitCode ?? 1);
    });
    return child;
  }
  try {
    launch('@kimo/mock-server', 'dev');
    let ready = false;
    for (let attempt = 0; attempt < readinessAttempts && !stopping; attempt++) {
      try {
        const response = await request('http://localhost:8787/health', {
          signal: globalThis.AbortSignal.timeout(500),
          redirect: 'error',
        });
        if (response.ok) {
          const body = await response.json();
          if (body && typeof body === 'object' && body.ok === true) {
            ready = true;
            break;
          }
        }
      } catch {
        /* bounded readiness retry, never a mutation */
      }
      await wait(250);
    }
    if (!ready || stopping) {
      await stop(1);
      return completed;
    }
    launch('@kimo/web', 'dev');
  } catch {
    await stop(1);
  }
  return completed;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  supervise().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.error('mock supervisor failed; check local ports and pnpm');
      process.exitCode = 1;
    },
  );
}
