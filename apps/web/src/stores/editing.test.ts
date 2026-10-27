import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyOps, type KimoProject, type Op } from '@kimo/client';
import { api } from '@/lib/api';
import { fixture, assets } from '@/lib/editing/test-fixtures';
import { useEditing } from './editing';
import { useProject } from './project';
afterEach(() => {
  useProject.getState().dispose();
  useEditing.getState().disconnect();
  vi.restoreAllMocks();
});
function context(sessionId = 's') {
  let project: KimoProject = fixture();
  return {
    sessionId,
    project,
    assets,
    client: {
      ops: vi.fn(async (_id: string, ops: Op[], version: number) => {
        expect(version).toBe(project.version);
        project = applyOps(project, ops);
        return { version: project.version };
      }),
      session: vi.fn(async () => ({
        status: 'editing' as const,
        project,
        assets,
      })),
    },
  };
}
describe('editing store and useProject compatibility', () => {
  it('mirrors stable subscription snapshots and disposes the prior session on switch', async () => {
    const first = useEditing.getState().connect(context());
    expect(first.getState()).toBe(first.getState());
    const id = first.beginEdit({
      clipIds: ['c'],
      label: 'move',
      source: 'timeline',
    });
    first.previewEdit(id, [
      { op: 'clip.move', id: 'c', trackId: 'v', start: 2 },
    ]);
    expect(useEditing.getState().state?.project.clips.c?.start).toBe(2);
    expect(useEditing.getState().state?.acknowledgedVersion).toBe(0);
    useEditing.getState().connect(context('new-session'));
    expect(first.getState().saveStatus).toBe('disposed');
    expect(useEditing.getState().state?.project.clips.c?.start).toBe(0);
  });
  it('keeps useProject projection live for observeCompositor without advancing acknowledgedVersion during preview', async () => {
    const ctx = context();
    const session = useProject.getState().attach(ctx);
    const observer = vi.fn();
    const unsubscribe = useProject.subscribe(observer);
    const id = session.beginEdit({
      clipIds: ['c'],
      label: 'move',
      source: 'timeline',
    });
    session.previewEdit(id, [
      { op: 'clip.move', id: 'c', trackId: 'v', start: 2 },
    ]);
    expect(useProject.getState().project?.clips.c?.start).toBe(2);
    expect(useProject.getState().acknowledgedVersion).toBe(0);
    expect(observer).toHaveBeenCalled();
    await session.commitEdit(id);
    expect(useProject.getState().acknowledgedVersion).toBe(1);
    expect(useProject.getState().project?.version).toBe(1);
    unsubscribe();
  });
  it('retains replace/receive/edit signatures for legacy callers with serialized network dispatch', async () => {
    let project: KimoProject = fixture();
    vi.spyOn(api, 'ops').mockImplementation(async (_id, ops, baseVersion) => {
      expect(baseVersion).toBe(project.version);
      project = applyOps(project, ops);
      return { version: project.version };
    });
    useProject.getState().replace(project);
    await useProject
      .getState()
      .edit('s', [{ op: 'clip.move', id: 'c', trackId: 'v', start: 1 }]);
    expect(useProject.getState().project?.clips.c?.start).toBe(1);
    expect(useProject.getState().acknowledgedVersion).toBe(1);
    await useProject
      .getState()
      .receive('s', 2, [{ op: 'text.update', clipId: 't', content: 'agent' }]);
    expect(useProject.getState().acknowledgedVersion).toBe(2);
    expect(useProject.getState().project?.clips.t?.text?.content).toBe('agent');
  });
  it('does not regress authority when an older legacy snapshot arrives', async () => {
    const ctx = context();
    const session = useProject.getState().attach(ctx);
    await session.editGroup(
      [{ op: 'clip.move', id: 'c', trackId: 'v', start: 1 }],
      'move',
    );
    useProject.getState().replace(fixture());
    expect(useProject.getState().acknowledgedVersion).toBe(1);
  });
});
