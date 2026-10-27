import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { measureBuild, markdownReport } from './budget-core.mjs';

const options = { '--build-dir': 'apps/web/.next' };
let report;
try {
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (
      !['--build-dir', '--json', '--markdown'].includes(key) ||
      !value ||
      value.startsWith('--')
    )
      throw new Error(
        'Usage: budget-check.mjs [--build-dir path] [--json path] [--markdown path]',
      );
    if (key !== '--build-dir' && options[key])
      throw new Error('Duplicate report argument');
    options[key] = value;
  }
  report = measureBuild(options['--build-dir']);
  process.exitCode = report.passed ? 0 : 1;
} catch (error) {
  report = {
    version: 1,
    passed: false,
    error: error instanceof Error ? error.message : 'Invalid build',
  };
  process.exitCode = 2;
}
try {
  for (const [flag, content] of [
    ['--json', JSON.stringify(report, null, 2) + '\n'],
    ['--markdown', markdownReport(report)],
  ]) {
    if (options[flag]) {
      mkdirSync(path.dirname(options[flag]), { recursive: true });
      writeFileSync(options[flag], content);
    }
  }
  console.log(markdownReport(report));
} catch {
  console.error('Budget report could not be written');
  process.exitCode = 2;
}
