// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const root = process.cwd();
const tokens = readFileSync(`${root}/apps/web/src/styles/tokens.css`, 'utf8');
const globalCss = readFileSync(`${root}/apps/web/src/app/globals.css`, 'utf8');
describe('final semantic theme seams', () => {
  it('actually registers all six render/delivery background variables in the existing theme block', () => {
    expect(tokens.startsWith('@theme static {')).toBe(true);
    for (const variable of [
      'render-unprinted',
      'phase9-grain-opacity',
      'phase9-glow-width',
      'phase9-glow-height',
      'phase9-glow-blur',
      'phase9-horizon',
    ])
      expect(tokens).toMatch(new RegExp(`--${variable}:\\s*[^;]+;`));
    expect(tokens).toContain('--privacy-max-width: 680px;');
  });
  it('raises contrast only on request without self-referential aliases', () => {
    expect(globalCss).toContain('@media (prefers-contrast: more)');
    expect(globalCss).toContain('--cream-60: var(--cream-100)');
    expect(globalCss).toContain('--line: var(--line-strong)');
    expect(globalCss).not.toContain('--line-strong: var(--line)');
  });
});
