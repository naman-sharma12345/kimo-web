import {
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({
  '/': 120000,
  '/studio/[sessionId]': 450000,
});
/** Effect-triggered imports required before Studio is usable are effective initial,
 * not gesture-deferred. Keep this explicit policy tied to actual import sites. */
export const REQUIRED_AUTO_IMPORTS = Object.freeze([
  Object.freeze({
    name: 'non-public-interactive-providers',
    importer: 'app/providers.tsx',
    request: './interactive-providers',
    routes: Object.freeze(['/studio/[sessionId]']),
  }),
]);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function strings(value, label, nonempty = false) {
  requireValue(
    Array.isArray(value) && value.every((v) => typeof v === 'string'),
    `Invalid ${label}`,
  );
  requireValue(!nonempty || value.length > 0, `Empty ${label}`);
  return value;
}
export function validateTotals(totals) {
  return Object.entries(LIMITS).map(([route, limitBytes]) => {
    const gzipBytes = totals[route];
    requireValue(
      Number.isSafeInteger(gzipBytes) && gzipBytes >= 0,
      `Missing or invalid total ${route}`,
    );
    return {
      route,
      gzipBytes,
      limitBytes,
      passed: gzipBytes <= limitBytes,
      deltaBytes: gzipBytes - limitBytes,
    };
  });
}
export function verifyBuildSnapshot(snapshots) {
  for (const [file, digest] of snapshots)
    requireValue(
      hash(readFileSync(file)) === digest,
      'Build changed during budget measurement',
    );
}
export function measureBuild(buildDirectory = 'apps/web/.next') {
  const root = realpathSync(buildDirectory);
  const snapshots = new Map();
  const contained = (relative) => {
    requireValue(
      typeof relative === 'string' &&
        relative.length > 0 &&
        !/[\\?#]/.test(relative) &&
        !relative.includes(String.fromCharCode(0)),
      'Invalid build path',
    );
    let normalized;
    try {
      normalized = decodeURIComponent(relative);
    } catch {
      throw new Error('Invalid encoded build path');
    }
    requireValue(
      !/%|\\|\?|#|:/.test(normalized) &&
        !path.isAbsolute(normalized) &&
        !normalized.split('/').some((s) => !s || s === '.' || s === '..'),
      'Unsafe build path',
    );
    const absolute = realpathSync(path.join(root, normalized));
    requireValue(
      absolute.startsWith(root + path.sep) && statSync(absolute).isFile(),
      'Build file escapes root',
    );
    return { normalized, absolute };
  };
  const read = (relative) => {
    const { absolute } = contained(relative);
    const bytes = readFileSync(absolute);
    requireValue(bytes.length > 0, `Empty build file ${relative}`);
    snapshots.set(absolute, hash(bytes));
    return bytes;
  };
  const json = (file) => {
    const value = JSON.parse(read(file).toString('utf8'));
    requireValue(object(value), `Invalid ${file}`);
    return value;
  };
  const buildId = read('BUILD_ID').toString('utf8').trim();
  requireValue(/^[A-Za-z0-9_-]+$/.test(buildId), 'Invalid BUILD_ID');
  const app = json('app-build-manifest.json');
  const bootstrap = json('build-manifest.json');
  const loadable = json('react-loadable-manifest.json');
  const routeMap = json('app-path-routes-manifest.json');
  const server = json('server/app-paths-manifest.json');
  requireValue(object(app.pages), 'Invalid App Router pages');
  requireValue(
    object(bootstrap.rootMainFilesTree ?? {}),
    'Invalid rootMainFilesTree',
  );
  strings(bootstrap.rootMainFiles, 'rootMainFiles', true);
  strings(bootstrap.polyfillFiles, 'polyfillFiles');
  const sourceRoot = path.join(path.dirname(root), 'src/app');
  requireValue(
    existsSync(sourceRoot),
    'Missing source route tree for ancestor accounting',
  );
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      requireValue(
        !entry.isSymbolicLink(),
        'Unsupported symlink in source route tree',
      );
      if (entry.isDirectory()) {
        requireValue(
          !/^[(@]/.test(entry.name),
          'Unsupported route-group/parallel/interception topology',
        );
        visit(path.join(directory, entry.name));
      }
    }
  };
  visit(sourceRoot);
  const files = new Map();
  const jsFiles = (values, label) =>
    strings(values, label).flatMap((file) => {
      const { normalized } = contained(file);
      requireValue(
        normalized.startsWith('static/'),
        `Non-browser asset ${file}`,
      );
      if (!normalized.endsWith('.js')) return [];
      if (!files.has(normalized)) {
        const bytes = read(normalized);
        files.set(normalized, {
          file: normalized,
          rawBytes: bytes.length,
          gzipBytes: gzipSync(bytes, { level: 9 }).length,
          sha256: hash(bytes),
        });
      }
      return [normalized];
    });
  const unique = (values) => [...new Set(values)].sort();
  const sum = (values) =>
    unique(values).reduce(
      (total, file) => total + files.get(file).gzipBytes,
      0,
    );
  const polyfills = jsFiles(bootstrap.polyfillFiles, 'polyfillFiles');
  const automaticDependencies = REQUIRED_AUTO_IMPORTS.map((rule) => {
    const matches = Object.entries(loadable).filter(([key]) => {
      const parts = key.replaceAll('\\', '/').split(' -> ');
      return (
        parts.length === 2 &&
        (parts[0] === rule.importer ||
          parts[0].endsWith('/' + rule.importer)) &&
        parts[1] === rule.request
      );
    });
    requireValue(
      matches.length === 1,
      `Missing or ambiguous required automatic import ${rule.name}: ${rule.importer} -> ${rule.request}`,
    );
    const [mappingKey, mapping] = matches[0];
    requireValue(
      object(mapping),
      `Invalid required automatic import ${rule.name}`,
    );
    const dependencyFiles = unique(
      jsFiles(mapping.files, `required automatic import ${rule.name}`),
    );
    requireValue(
      dependencyFiles.length > 0,
      `Empty required automatic import ${rule.name}; cannot prove effective initial cost`,
    );
    return {
      ...rule,
      mappingKey,
      files: dependencyFiles,
      gzipBytes: sum(dependencyFiles),
    };
  });
  const routes = [];
  for (const [route, limitBytes] of Object.entries(LIMITS)) {
    const matches = Object.keys(routeMap).filter(
      (key) => routeMap[key] === route && key.endsWith('/page'),
    );
    requireValue(
      matches.length === 1,
      `Missing or ambiguous required route ${route}`,
    );
    const entry = matches[0];
    requireValue(
      entry === (route === '/' ? '/page' : `${route}/page`),
      'Unsupported route manifest topology',
    );
    requireValue(
      typeof server[entry] === 'string',
      `Missing server route ${route}`,
    );
    read(`server/${server[entry]}`);
    const directory = path.dirname(entry).replace(/^\//, '');
    const segments =
      directory === '.' || directory === '' ? [] : directory.split('/');
    const entries = new Set([entry]);
    const conventions = ['layout', 'template', 'loading', 'error', 'not-found'];
    for (let depth = 0; depth <= segments.length; depth++) {
      const folder = segments.slice(0, depth).join('/');
      for (const convention of conventions) {
        if (
          ['tsx', 'ts', 'jsx', 'js'].some((extension) =>
            existsSync(
              path.join(sourceRoot, folder, `${convention}.${extension}`),
            ),
          )
        )
          entries.add(`/${[folder, convention].filter(Boolean).join('/')}`);
      }
    }
    requireValue(entries.has('/layout'), 'Missing root layout source');
    const runtime = jsFiles(
      bootstrap.rootMainFilesTree?.[entry] ?? bootstrap.rootMainFiles,
      `runtime ${route}`,
    );
    requireValue(runtime.length > 0, `Empty runtime ${route}`);
    const selected = [...runtime];
    for (const key of entries) {
      const chunks = jsFiles(app.pages[key], `page entry ${key}`);
      requireValue(chunks.length > 0, `Empty page entry ${key}`);
      selected.push(...chunks);
    }
    const manifestInitial = unique(selected);
    const requiredAutomaticImports = automaticDependencies
      .filter((dependency) => dependency.routes.includes(route))
      .map((dependency) => ({
        name: dependency.name,
        mappingKey: dependency.mappingKey,
        files: dependency.files,
        additionalFiles: dependency.files.filter(
          (file) => !manifestInitial.includes(file),
        ),
        gzipBytes: dependency.gzipBytes,
        additionalGzipBytes: sum(
          dependency.files.filter((file) => !manifestInitial.includes(file)),
        ),
      }));
    const modern = unique([
      ...manifestInitial,
      ...requiredAutomaticImports.flatMap((dependency) => dependency.files),
    ]);
    const initial = unique([...modern, ...polyfills]);
    const gzipBytes = sum(modern);
    routes.push({
      route,
      entry,
      entries: [...entries].sort(),
      runtimeFiles: unique(runtime),
      manifestInitialFiles: manifestInitial,
      manifestInitialGzipBytes: sum(manifestInitial),
      requiredAutomaticImports,
      automaticImportAdditionalFiles: modern.filter(
        (file) => !manifestInitial.includes(file),
      ),
      automaticImportAdditionalGzipBytes: sum(
        modern.filter((file) => !manifestInitial.includes(file)),
      ),
      initialFiles: modern,
      allBrowserFiles: initial,
      allBrowserGzipBytes: sum(initial),
      modernGzipBytes: sum(modern),
      polyfillGzipBytes: sum(polyfills.filter((f) => !modern.includes(f))),
      gzipBytes,
      limitBytes,
      passed: gzipBytes <= limitBytes,
      deltaBytes: gzipBytes - limitBytes,
    });
  }
  for (const route of routes) {
    const shared = route.initialFiles.filter(
      (file) =>
        !route.runtimeFiles.includes(file) &&
        routes.some(
          (other) => other !== route && other.initialFiles.includes(file),
        ),
    );
    const specific = route.initialFiles.filter(
      (file) => !route.runtimeFiles.includes(file) && !shared.includes(file),
    );
    route.groups = Object.fromEntries(
      [
        ['runtime', route.runtimeFiles],
        ['shared', shared],
        ['route', specific],
      ].map(([name, list]) => [name, { files: list, gzipBytes: sum(list) }]),
    );
  }
  const initialEverywhere = new Set(routes.flatMap((r) => r.initialFiles));
  const lazyMappings = Object.entries(loadable).map(([label, value]) => {
    requireValue(object(value), 'Invalid loadable entry');
    const listed = unique(jsFiles(value.files, `loadable files ${label}`));
    return {
      label,
      files: listed,
      initialFiles: listed.filter((f) => initialEverywhere.has(f)),
      deferredFiles: listed.filter((f) => !initialEverywhere.has(f)),
      empty: listed.length === 0,
    };
  });
  const lazyFiles = unique(lazyMappings.flatMap((m) => m.deferredFiles));
  const htmlCrossChecks = [];
  // Static output is optional: a CSP nonce/force-dynamic root has no index.html.
  if (existsSync(path.join(root, 'server/app/index.html'))) {
    const html = read('server/app/index.html').toString('utf8');
    const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)];
    const external = tags.map((m) => {
      requireValue(
        m[1].startsWith('/_next/'),
        'Unsupported external script in emitted landing HTML',
      );
      return m[1].slice('/_next/'.length);
    });
    const listed = unique(jsFiles(external, 'landing emitted scripts'));
    const landing = routes.find((r) => r.route === '/');
    requireValue(
      listed.length > 0 &&
        listed.every((f) => landing.allBrowserFiles.includes(f)),
      'Unaccounted landing HTML initial scripts',
    );
    htmlCrossChecks.push({
      route: '/',
      gzipBytes: sum(listed),
      files: listed,
      exactMatch: listed.length === landing.allBrowserFiles.length,
    });
  }
  verifyBuildSnapshot(snapshots);
  return {
    version: 1,
    buildId,
    node: process.version,
    zlib: process.versions.zlib,
    policy:
      'decimal KB; independent gzip level 9; modern effective initial JS including all framework/runtime/shared and required automatic imports; conditional nomodule polyfills separately reported; external JS only',
    passed: routes.every((r) => r.passed),
    routes,
    files: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)),
    automaticDependencies,
    lazyMappings,
    deferredInventory: { files: lazyFiles, gzipBytes: sum(lazyFiles) },
    htmlCrossChecks,
    manifestHashes: Object.fromEntries(
      [...snapshots]
        .filter(([f]) => f.endsWith('manifest.json'))
        .map(([f, digest]) => [path.relative(root, f), digest]),
    ),
    caveats: [
      'Manifest estimate, not a navigation trace or source-freshness proof.',
      'Boundary assets conservatively included; conditional nomodule polyfills reported separately, not fetched by the specified modern browser matrix; inline HTML/RSC, CSS, fonts and media outside gate.',
      'Deferred inventory is loadable-manifest candidates, not proof of all Webpack async requests or warmup preload.',
      'JS budgets do not establish LCP, INP, CLS, FPS, memory, browser or AT acceptance.',
    ],
  };
}
export function markdownReport(report) {
  if (report.error) return `# JS budgets: INVALID BUILD\n\n${report.error}\n`;
  return [
    `# JS budgets: ${report.passed ? 'PASS' : 'FAIL'}`,
    `Build: ${report.buildId}; Node ${report.node}; zlib ${report.zlib}.`,
    report.policy,
    '| Route | Initial gzip bytes | With conditional polyfills | Limit bytes | Status |',
    '| --- | ---: | ---: | ---: | --- |',
    ...report.routes.map(
      (r) =>
        `| ${r.route} | ${r.gzipBytes} | ${r.allBrowserGzipBytes} | ${r.limitBytes} | ${r.passed ? 'PASS' : 'FAIL'} |`,
    ),
    '\n## Required automatic imports charged to effective initial JS',
    ...report.routes.flatMap((route) =>
      route.requiredAutomaticImports.map(
        (dependency) =>
          `- ${route.route}: ${dependency.name}; ${dependency.mappingKey}; additional ${dependency.additionalGzipBytes} gzip bytes (${dependency.additionalFiles.join(', ') || 'already counted'}).`,
      ),
    ),
    '\n## Actual independently gzipped files',
    '| File | Raw bytes | Gzip bytes |',
    '| --- | ---: | ---: |',
    ...report.files.map(
      (f) => `| ${f.file} | ${f.rawBytes} | ${f.gzipBytes} |`,
    ),
    `\nDeferred candidate inventory: ${report.deferredInventory.gzipBytes} gzip bytes.`,
    ...report.caveats.map((c) => `- ${c}`),
    '',
  ].join('\n');
}
