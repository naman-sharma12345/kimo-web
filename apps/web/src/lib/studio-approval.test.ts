import { describe, it, expect, vi } from 'vitest';
import { ApiError, type SessionSnapshot } from '@kimo/client';
import { approveCut, reconcileApproval } from './studio-approval';
const snapshot: SessionSnapshot = {
  status: 'awaiting_review',
  project: {
    id: 'p',
    version: 3,
    fps: 30,
    width: 1920,
    height: 1080,
    duration: 4,
    tracks: [],
    clips: {},
    markers: [],
  },
  assets: [],
};
function setup() {
  return {
    session: vi.fn(async () => snapshot),
    approve: vi.fn(async () => ({ renderId: 'new-job' })),
  };
}
describe('consequential render approval', () => {
  it('checks the actual revision before any dispatch', async () => {
    const client = setup();
    expect(
      await approveCut({
        client,
        sessionId: 's',
        options: { expectedProjectVersion: 2 },
      }),
    ).toMatchObject({ kind: 'rejected' });
    expect(client.approve).not.toHaveBeenCalled();
  });
  it('reuses an authoritative active job without another POST', async () => {
    const client = setup();
    client.session.mockResolvedValue({
      ...snapshot,
      status: 'rendering',
      renderId: 'existing',
    });
    expect(
      await approveCut({
        client,
        sessionId: 's',
        options: { expectedProjectVersion: 3 },
      }),
    ).toEqual({ kind: 'accepted', renderId: 'existing' });
    expect(client.approve).not.toHaveBeenCalled();
  });
  it('reconciles a lost response to a new recorded job without retry', async () => {
    const client = setup();
    client.approve.mockRejectedValue(new Error('response lost'));
    client.session.mockResolvedValueOnce(snapshot).mockResolvedValueOnce({
      ...snapshot,
      status: 'rendering',
      renderId: 'server-job',
    });
    expect(
      await approveCut({
        client,
        sessionId: 's',
        options: { expectedProjectVersion: 3 },
      }),
    ).toEqual({ kind: 'accepted', renderId: 'server-job' });
    expect(client.approve).toHaveBeenCalledTimes(1);
  });
  it('does not mistake an older render ID or a failed read for acceptance', async () => {
    const client = setup();
    client.session.mockResolvedValue({
      ...snapshot,
      status: 'failed',
      renderId: 'old',
    });
    expect(await reconcileApproval(client, 's', 'old')).toMatchObject({
      kind: 'unknown',
      baselineRenderId: 'old',
    });
    client.session.mockRejectedValue(new Error('offline'));
    expect(await reconcileApproval(client, 's')).toMatchObject({
      kind: 'unknown',
    });
    expect(client.approve).not.toHaveBeenCalled();
  });
  it('keeps explicit 409 nonacceptance distinct from network uncertainty', async () => {
    const client = setup();
    client.approve.mockRejectedValue(new ApiError(409, 'version conflict'));
    expect(
      await approveCut({
        client,
        sessionId: 's',
        options: { expectedProjectVersion: 3 },
      }),
    ).toEqual({ kind: 'rejected', message: 'version conflict' });
    expect(client.session).toHaveBeenCalledTimes(1);
  });
});
