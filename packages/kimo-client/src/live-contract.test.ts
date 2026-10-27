import { describe, expect, it, vi } from 'vitest';
import { runLiveContracts } from './live-contract';
import { project } from './contract-fixtures';
describe('live harness safety with injected offline transport', () => {
  it('skips absent fixtures without making a request or manufacturing coverage', async () => {
    const request = vi.fn<typeof fetch>();
    const rows = await runLiveContracts(
      { mode: 'read', api: 'https://api.test' },
      request,
    );
    expect(request).not.toHaveBeenCalled();
    expect(rows.some((row) => row.outcome === 'skipped')).toBe(true);
    expect(rows.some((row) => row.outcome === 'unobserved')).toBe(true);
    expect(rows.some((row) => row.outcome === 'live-observed-pass')).toBe(
      false,
    );
  });
  it('never mutates a designated read fixture and omits credentials', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'editing', assets: [], project }),
        ),
      );
    const rows = await runLiveContracts(
      { mode: 'read', api: 'https://api.test/prefix', sessionId: 'a/b' },
      request,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe(
      'https://api.test/prefix/v1/sessions/a%2Fb',
    );
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    expect(rows.find((row) => row.id === 'sessions.read')?.outcome).toBe(
      'live-observed-pass',
    );
  });
  it('does not retry an acceptance-unknown creation or touch caller IDs', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('unknown dispatch'));
    const rows = await runLiveContracts(
      {
        mode: 'disposable-write',
        api: 'https://api.test',
        allowWrites: true,
        maxSessions: 1,
        maxRenderStarts: 0,
        sessionId: 'ordinary-user',
      },
      request,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(rows.find((row) => row.id === 'sessions.create')?.outcome).toBe(
      'live-fail',
    );
    expect(rows.find((row) => row.id === 'sessions.read')?.outcome).toBe(
      'skipped',
    );
  });
});

describe('disposable upload and render bounds with offline fixtures', () => {
  it('does not allocate uploads without signed-origin approval or within an insufficient byte budget', async () => {
    const request = vi.fn<typeof fetch>();
    const input = {
      mode: 'disposable-write' as const,
      api: 'https://api.test',
      allowWrites: true,
      maxSessions: 1,
      maxRenderStarts: 0,
      uploadFixture: {
        name: 'fixture',
        mime: 'video/mp4',
        bytes: new Uint8Array([1, 2]),
      },
    };
    await expect(
      runLiveContracts(
        {
          ...input,
          maxUploadBytes: 1,
          uploadOrigins: ['https://storage.test'],
        },
        request,
      ),
    ).rejects.toThrow('budget');
    await expect(
      runLiveContracts({ ...input, maxUploadBytes: 2 }, request),
    ).rejects.toThrow('origin approval');
    expect(request).not.toHaveBeenCalled();
  });
  it('never follows an unapproved storage origin or retries an uncertain PUT', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          uploads: [
            {
              assetId: 'a',
              putUrl: 'https://unapproved.test/put?token=private',
              headers: {},
            },
          ],
        }),
      ),
    );
    const rows = await runLiveContracts(
      {
        mode: 'disposable-write',
        api: 'https://api.test',
        allowWrites: true,
        maxSessions: 1,
        maxRenderStarts: 0,
        uploadOrigins: ['https://storage.test'],
        maxUploadBytes: 2,
        uploadFixture: {
          name: 'fixture',
          mime: 'video/mp4',
          bytes: new Uint8Array([1, 2]),
        },
      },
      request,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(rows.find((row) => row.id === 'upload.put')?.outcome).toBe(
      'live-fail',
    );
    expect(rows.find((row) => row.id === 'sessions.create')?.outcome).toBe(
      'skipped',
    );
  });
  it('requires a render budget before any creation when a render scenario is requested', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      runLiveContracts(
        {
          mode: 'disposable-write',
          api: 'https://api.test',
          allowWrites: true,
          maxSessions: 1,
          maxRenderStarts: 0,
          renderScenario: 'cancel-and-reopen',
        },
        request,
      ),
    ).rejects.toThrow('authority');
    expect(request).not.toHaveBeenCalled();
  });
});
