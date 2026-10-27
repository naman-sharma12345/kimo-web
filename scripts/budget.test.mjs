import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  measureBuild,
  validateTotals,
  markdownReport,
  verifyBuildSnapshot,
} from './budget-core.mjs';

const cwd = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const dir = mkdtempSync(path.join(cwd, '.budget-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const build = path.join(dir, '.next');
  const put = (file, value) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), value);
  };
  const json = (file, value) => put(`.next/${file}`, JSON.stringify(value));
  for (const file of [
    'layout',
    'error',
    'not-found',
    'page',
    'studio/[sessionId]/not-found',
    'studio/[sessionId]/page',
  ])
    put(`src/app/${file}.tsx`, 'export default function Page() {}');
  const auto = 'static/chunks/interactive-providers.js';
  const runtime = 'static/chunks/runtime.js',
    shared = 'static/chunks/shared.js',
    landing = 'static/chunks/landing.js',
    studio = 'static/chunks/studio/[sessionId]/page.js',
    boundary = 'static/chunks/boundary.js',
    poly = 'static/chunks/polyfill.js',
    lazy = 'static/chunks/lazy.js';
  for (const file of [
    auto,
    runtime,
    shared,
    landing,
    studio,
    boundary,
    poly,
    lazy,
  ])
    put(`.next/${file}`, `globalThis.value = '${file}';`);
  put('.next/BUILD_ID', 'test-build');
  json('app-build-manifest.json', {
    pages: {
      '/layout': [runtime, shared],
      '/error': [runtime, boundary],
      '/not-found': [boundary],
      '/page': [runtime, shared, landing],
      '/studio/[sessionId]/page': [runtime, shared, studio],
      '/studio/[sessionId]/not-found': [boundary],
    },
  });
  json('build-manifest.json', {
    rootMainFiles: [runtime],
    rootMainFilesTree: {},
    polyfillFiles: [poly],
    pages: { '/_app': ['static/chunks/nonexistent-unrelated.js'] },
  });
  json('app-path-routes-manifest.json', {
    '/page': '/',
    '/studio/[sessionId]/page': '/studio/[sessionId]',
  });
  json('server/app-paths-manifest.json', {
    '/page': 'app/page.js',
    '/studio/[sessionId]/page': 'app/studio/[sessionId]/page.js',
  });
  for (const f of ['app/page.js', 'app/studio/[sessionId]/page.js'])
    put(`.next/server/${f}`, '/* server */');
  json('react-loadable-manifest.json', {
    'app/providers.tsx -> ./interactive-providers': { id: 3, files: [auto] },
    dynamic: { id: 1, files: [lazy, shared] },
    empty: { id: 2, files: [] },
  });
  const update = (file, callback) => {
    const value = JSON.parse(readFileSync(path.join(build, file), 'utf8'));
    callback(value);
    json(file, value);
  };
  const size = (file) =>
    gzipSync(readFileSync(path.join(build, file)), { level: 9 }).length;
  const cli = (...args) =>
    spawnSync(
      process.execPath,
      ['scripts/budget-check.mjs', '--build-dir', build, ...args],
      { cwd, encoding: 'utf8' },
    );
  return {
    dir,
    build,
    put,
    json,
    update,
    size,
    cli,
    runtime,
    shared,
    landing,
    studio,
    boundary,
    poly,
    lazy,
    auto,
  };
}
function noise(length) {
  return Buffer.concat(
    Array.from({ length: Math.ceil(length / 32) }, (_, n) =>
      createHash('sha256').update(String(n)).digest(),
    ),
  ).subarray(0, length);
}
test('real file gzip, shared/runtime dedup per route, boundaries included and conditional polyfill separate; unrelated pages excluded', (t) => {
  const f = fixture(t),
    report = measureBuild(f.build);
  const landing = report.routes[0],
    studio = report.routes[1];
  assert.equal(
    landing.gzipBytes,
    [f.runtime, f.shared, f.landing, f.boundary].reduce(
      (n, file) => n + f.size(file),
      0,
    ),
  );
  assert.equal(
    studio.gzipBytes,
    [f.runtime, f.shared, f.studio, f.boundary, f.auto].reduce(
      (n, file) => n + f.size(file),
      0,
    ),
  );
  assert.equal(
    landing.modernGzipBytes + f.size(f.poly),
    landing.allBrowserGzipBytes,
  );
  assert.equal(report.deferredInventory.gzipBytes, f.size(f.lazy));
  assert.deepEqual(
    report.lazyMappings.find((mapping) => mapping.label === 'dynamic')
      .initialFiles,
    [f.shared],
  );
  assert.equal(
    report.lazyMappings.find((mapping) => mapping.label === 'empty').empty,
    true,
  );
  assert.equal(report.passed, true);
  assert.match(markdownReport(report), /PASS/);
  assert.notEqual(
    gzipSync(
      Buffer.concat([
        readFileSync(path.join(f.build, f.runtime)),
        readFileSync(path.join(f.build, f.shared)),
      ]),
      { level: 9 },
    ).length,
    f.size(f.runtime) + f.size(f.shared),
  );
});
test('inclusive decimal thresholds and one-byte negative controls for each route', () => {
  assert.ok(
    validateTotals({ '/': 120000, '/studio/[sessionId]': 450000 }).every(
      (r) => r.passed,
    ),
  );
  assert.equal(
    validateTotals({ '/': 120001, '/studio/[sessionId]': 450000 })[0].passed,
    false,
  );
  assert.equal(
    validateTotals({ '/': 120000, '/studio/[sessionId]': 450001 })[1].passed,
    false,
  );
  assert.throws(() => validateTotals({ '/': 0 }), /Missing/);
});
for (const route of ['landing', 'studio'])
  test(`actual oversized ${route} exits 1 and writes evidence, not a mock validator result`, (t) => {
    const f = fixture(t);
    f.put(`.next/${f[route]}`, noise(500000));
    const output = path.join(f.dir, 'report.json');
    const run = f.cli('--json', output);
    assert.equal(run.status, 1, run.stderr);
    const report = JSON.parse(readFileSync(output));
    assert.equal(report.passed, false);
    assert.equal(report.routes[route === 'landing' ? 0 : 1].passed, false);
    assert.equal(report.routes[route === 'landing' ? 1 : 0].passed, true);
  });
for (const file of [
  'BUILD_ID',
  'app-build-manifest.json',
  'build-manifest.json',
  'react-loadable-manifest.json',
  'app-path-routes-manifest.json',
  'server/app-paths-manifest.json',
  'static/chunks/runtime.js',
  'static/chunks/lazy.js',
])
  test(`missing ${file} fails closed`, (t) => {
    const f = fixture(t);
    rmSync(path.join(f.build, file));
    assert.throws(() => measureBuild(f.build));
    assert.equal(f.cli().status, 2);
  });
for (const key of [
  '/layout',
  '/error',
  '/not-found',
  '/page',
  '/studio/[sessionId]/page',
  '/studio/[sessionId]/not-found',
])
  test(`missing selected entry ${key} fails closed`, (t) => {
    const f = fixture(t);
    f.update('app-build-manifest.json', (v) => {
      Reflect.deleteProperty(v.pages, key);
    });
    assert.throws(() => measureBuild(f.build));
  });
test('encoded bracket alias deduplicates without doubling physical chunk', (t) => {
  const f = fixture(t);
  const before = measureBuild(f.build).routes[1].gzipBytes;
  f.update('app-build-manifest.json', (v) =>
    v.pages['/studio/[sessionId]/page'].push(
      f.studio.replace('[sessionId]', '%5BsessionId%5D'),
    ),
  );
  assert.equal(measureBuild(f.build).routes[1].gzipBytes, before);
});
for (const unsafe of [
  '../outside.js',
  'static/chunks/%2e%2e/file.js',
  'https://example.test/a.js',
  'static/chunks/x.js?token=secret',
  'static/chunks/%252e%252e/a.js',
])
  test(`unsafe manifest path fails closed: ${unsafe}`, (t) => {
    const f = fixture(t);
    f.update('app-build-manifest.json', (v) => v.pages['/page'].push(unsafe));
    assert.throws(() => measureBuild(f.build));
  });
test('external symlink fails closed', (t) => {
  const f = fixture(t);
  f.put('outside.js', 'secret');
  rmSync(path.join(f.build, f.landing));
  symlinkSync(path.join(f.dir, 'outside.js'), path.join(f.build, f.landing));
  assert.throws(() => measureBuild(f.build), /escapes/);
});
test('empty runtime, malformed JSON, empty chunk, wrong shapes, absent route fail', (t) => {
  for (const mutate of [
    (f) =>
      f.update('build-manifest.json', (v) => {
        v.rootMainFiles = [];
      }),
    (f) => f.put('.next/app-build-manifest.json', '{broken'),
    (f) => f.put(`.next/${f.shared}`, ''),
    (f) => f.json('app-build-manifest.json', { pages: [] }),
    (f) =>
      f.update('app-path-routes-manifest.json', (v) => {
        delete v['/page'];
      }),
  ]) {
    const f = fixture(t);
    mutate(f);
    assert.throws(() => measureBuild(f.build));
  }
});
test('nested layout/template/loading included, unsupported groups fail explicitly', (t) => {
  const f = fixture(t);
  for (const convention of ['layout', 'template', 'loading']) {
    f.put(`src/app/studio/${convention}.tsx`, '/* convention */');
    f.update('app-build-manifest.json', (v) => {
      v.pages[`/studio/${convention}`] = [f.shared];
    });
  }
  assert.ok(
    measureBuild(f.build).routes[1].entries.includes('/studio/loading'),
  );
  f.put('src/app/(group)/page.tsx', '/* unsupported */');
  assert.throws(() => measureBuild(f.build), /Unsupported/);
});
test('static HTML cross-check catches unaccounted scripts; dynamic build needs no static HTML', (t) => {
  const f = fixture(t);
  assert.equal(measureBuild(f.build).htmlCrossChecks.length, 0);
  f.put(
    '.next/server/app/index.html',
    `<script src="/_next/${f.runtime}"></script>`,
  );
  assert.equal(
    measureBuild(f.build).htmlCrossChecks[0].gzipBytes,
    f.size(f.runtime),
  );
  f.put(
    '.next/server/app/index.html',
    `<script src="/_next/${f.lazy}"></script>`,
  );
  assert.throws(() => measureBuild(f.build), /Unaccounted/);
});
test('CLI valid output deterministic, invalid args/missing build/report write failure nonzero', (t) => {
  const f = fixture(t);
  assert.deepEqual(measureBuild(f.build), measureBuild(f.build));
  assert.equal(f.cli().status, 0);
  assert.equal(f.cli('--exclude', 'runtime').status, 2);
  assert.equal(
    f.cli('--json', path.join(f.build, 'BUILD_ID', 'bad.json')).status,
    2,
  );
  assert.equal(
    spawnSync(
      process.execPath,
      ['scripts/budget-check.mjs', '--build-dir', path.join(f.dir, 'missing')],
      { cwd },
    ).status,
    2,
  );
});

test('real snapshot mutation detected instead of reporting a mixed build', (t) => {
  const f = fixture(t);
  const file = path.join(f.build, 'BUILD_ID');
  const snapshots = new Map([
    [file, createHash('sha256').update(readFileSync(file)).digest('hex')],
  ]);
  verifyBuildSnapshot(snapshots);
  f.put('.next/BUILD_ID', 'different-build');
  assert.throws(() => verifyBuildSnapshot(snapshots), /Build changed/);
});
test('bootstrap-only runtime is counted even if page manifests omit it', (t) => {
  const f = fixture(t);
  f.update('app-build-manifest.json', (v) => {
    for (const key of Object.keys(v.pages))
      v.pages[key] = v.pages[key].filter((file) => file !== f.runtime);
  });
  assert.ok(
    measureBuild(f.build).routes.every((route) =>
      route.initialFiles.includes(f.runtime),
    ),
  );
});
test('conditional nomodule inventory never silently hides a runtime chunk also in selected page', (t) => {
  const f = fixture(t);
  f.update('build-manifest.json', (v) => {
    v.polyfillFiles.push(f.runtime);
  });
  const report = measureBuild(f.build);
  assert.ok(
    report.routes.every((route) => route.initialFiles.includes(f.runtime)),
  );
  assert.equal(report.routes[0].polyfillGzipBytes, f.size(f.poly));
});

test('runtime/shared/route reporting partitions initial bytes without subtracting shared cost', (t) => {
  const f = fixture(t);
  for (const route of measureBuild(f.build).routes) {
    assert.equal(
      Object.values(route.groups).reduce((n, group) => n + group.gzipBytes, 0),
      route.gzipBytes,
    );
    assert.ok(route.groups.shared.files.includes(f.shared));
    assert.ok(route.groups.runtime.files.includes(f.runtime));
  }
});
test('ambiguous or unsupported mapped route fails closed', (t) => {
  const f = fixture(t);
  f.update('app-path-routes-manifest.json', (v) => {
    v['/alias/page'] = '/';
  });
  assert.throws(() => measureBuild(f.build), /ambiguous/);
});

test('named effect-triggered provider mapping charged to Studio even outside route manifests, not landing', (t) => {
  const f = fixture(t);
  const report = measureBuild(f.build);
  const landing = report.routes[0],
    studio = report.routes[1];
  assert.equal(landing.requiredAutomaticImports.length, 0);
  assert.ok(!landing.initialFiles.includes(f.auto));
  assert.ok(!studio.manifestInitialFiles.includes(f.auto));
  assert.ok(studio.initialFiles.includes(f.auto));
  assert.equal(
    studio.gzipBytes,
    studio.manifestInitialGzipBytes + f.size(f.auto),
  );
  assert.equal(studio.automaticImportAdditionalGzipBytes, f.size(f.auto));
  assert.equal(
    studio.requiredAutomaticImports[0].name,
    'non-public-interactive-providers',
  );
  assert.equal(
    studio.requiredAutomaticImports[0].mappingKey,
    'app/providers.tsx -> ./interactive-providers',
  );
  assert.ok(!report.deferredInventory.files.includes(f.auto));
  assert.match(markdownReport(report), /required|Required/);
});
test('automatic providers already shared in initial are charged once only', (t) => {
  const f = fixture(t);
  f.update('react-loadable-manifest.json', (v) => {
    v['app/providers.tsx -> ./interactive-providers'].files.push(
      f.shared,
      f.auto,
    );
  });
  const studio = measureBuild(f.build).routes[1];
  assert.equal(studio.automaticImportAdditionalGzipBytes, f.size(f.auto));
  assert.equal(
    studio.requiredAutomaticImports[0].gzipBytes,
    f.size(f.auto) + f.size(f.shared),
  );
  assert.equal(
    studio.initialFiles.filter((file) => file === f.shared).length,
    1,
  );
});
test('oversized automatic provider changes Studio gate outcome and CLI fails', (t) => {
  const f = fixture(t);
  f.put(`.next/${f.auto}`, noise(500000));
  const report = measureBuild(f.build);
  assert.ok(report.routes[1].manifestInitialGzipBytes < 450000);
  assert.ok(report.routes[1].gzipBytes > 450000);
  assert.equal(report.routes[1].passed, false);
  assert.equal(report.routes[0].passed, true);
  assert.equal(f.cli().status, 1);
});
for (const scenario of [
  'missing',
  'empty',
  'ambiguous',
  'wrong importer',
  'missing file',
])
  test(`required automatic provider dependency fails closed: ${scenario}`, (t) => {
    const f = fixture(t);
    f.update('react-loadable-manifest.json', (v) => {
      const key = 'app/providers.tsx -> ./interactive-providers';
      if (scenario === 'missing') Reflect.deleteProperty(v, key);
      if (scenario === 'empty') v[key].files = [];
      if (scenario === 'ambiguous')
        v['/absolute/source/app/providers.tsx -> ./interactive-providers'] =
          v[key];
      if (scenario === 'wrong importer') {
        v['app/other.tsx -> ./interactive-providers'] = v[key];
        Reflect.deleteProperty(v, key);
      }
      if (scenario === 'missing file')
        v[key].files = ['static/chunks/missing-interactive.js'];
    });
    assert.throws(() => measureBuild(f.build));
    assert.equal(f.cli().status, 2);
  });
test('automatic dependency supports absolute importer prefixes without matching a different filename', (t) => {
  const f = fixture(t);
  f.update('react-loadable-manifest.json', (v) => {
    v['/canonical/apps/web/src/app/providers.tsx -> ./interactive-providers'] =
      v['app/providers.tsx -> ./interactive-providers'];
    Reflect.deleteProperty(v, 'app/providers.tsx -> ./interactive-providers');
  });
  assert.ok(measureBuild(f.build).routes[1].initialFiles.includes(f.auto));
});
