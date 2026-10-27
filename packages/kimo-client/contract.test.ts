// @vitest-environment node
import { stat, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { restContracts } from './src/contract-manifest';
import { runLiveContracts } from './src/live-contract';
const mode = process.env.KIMO_CONTRACT_MODE;
const endpoint = process.env.KIMO_CONTRACT_API;
const enabled = (mode === 'read' || mode === 'disposable-write') && !!endpoint;
describe('contract entry point', () => {
  it('requires an endpoint when a live mode was explicitly requested', () => {
    if (mode && mode !== 'fixtures') {
      expect(['read', 'disposable-write']).toContain(mode);
      expect(
        endpoint,
        'explicit live mode requires KIMO_CONTRACT_API',
      ).toBeTruthy();
    }
  });
  it('keeps offline fixtures separate from live acceptance', () => {
    expect(restContracts.length).toBe(14);
  });
  it.skipIf(!enabled)(
    'observes only explicitly configured authorized live fixtures',
    async () => {
      if (!endpoint || (mode !== 'read' && mode !== 'disposable-write'))
        throw new Error('live configuration missing');
      let uploadFixture;
      if (
        mode === 'disposable-write' &&
        process.env.KIMO_CONTRACT_UPLOAD_FILE
      ) {
        const maxBytes = Number(process.env.KIMO_CONTRACT_MAX_UPLOAD_BYTES);
        const size = (await stat(process.env.KIMO_CONTRACT_UPLOAD_FILE)).size;
        if (
          !Number.isSafeInteger(maxBytes) ||
          maxBytes <= 0 ||
          maxBytes > 128 * 1024 * 1024 ||
          size > maxBytes
        )
          throw new Error('upload fixture exceeds bounded authority');
        uploadFixture = {
          name: 'disposable-fixture',
          mime:
            process.env.KIMO_CONTRACT_UPLOAD_MIME ?? 'application/octet-stream',
          bytes: new Uint8Array(
            await readFile(process.env.KIMO_CONTRACT_UPLOAD_FILE),
          ),
          partSizeBytes: process.env.KIMO_CONTRACT_PART_BYTES
            ? Number(process.env.KIMO_CONTRACT_PART_BYTES)
            : undefined,
        };
      }
      const rows = await runLiveContracts({
        mode,
        api: endpoint,
        wsOrigin: process.env.KIMO_CONTRACT_WS_ORIGIN,
        sessionId: process.env.KIMO_CONTRACT_SESSION_ID,
        renderId: process.env.KIMO_CONTRACT_RENDER_ID,
        videoId: process.env.KIMO_CONTRACT_VIDEO_ID,
        frame:
          process.env.KIMO_CONTRACT_FRAME === undefined
            ? undefined
            : Number(process.env.KIMO_CONTRACT_FRAME),
        observeWs: process.env.KIMO_CONTRACT_OBSERVE_WS === '1',
        allowWrites: process.env.KIMO_CONTRACT_ALLOW_WRITES === '1',
        maxSessions: Number(process.env.KIMO_CONTRACT_MAX_SESSIONS),
        maxRenderStarts: Number(process.env.KIMO_CONTRACT_MAX_RENDER_STARTS),
        renderScenario:
          process.env.KIMO_CONTRACT_RENDER_SCENARIO === 'cancel-and-reopen'
            ? 'cancel-and-reopen'
            : undefined,
        uploadFixture,
        maxUploadBytes: Number(process.env.KIMO_CONTRACT_MAX_UPLOAD_BYTES),
        uploadOrigins: process.env.KIMO_CONTRACT_UPLOAD_ORIGINS?.split(',').map(
          (value) => value.trim(),
        ),
      });
      // No raw URLs/IDs/payloads/credentials in the summary.
      console.info(JSON.stringify({ contractCoverage: rows }));
      expect(rows.filter((row) => row.outcome === 'live-fail')).toEqual([]);
      if (process.env.KIMO_CONTRACT_REQUIRE_FULL === '1')
        expect(
          rows.filter(
            (row) => row.outcome === 'skipped' || row.outcome === 'unobserved',
          ),
        ).toEqual([]);
    },
    60_000,
  );
  it('refuses disposable writes without bounded explicit authority', async () => {
    await expect(
      runLiveContracts({
        mode: 'disposable-write',
        api: 'https://example.test',
      }),
    ).rejects.toThrow('authority');
  });
});
