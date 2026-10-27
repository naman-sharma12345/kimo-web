import type { EditContext } from '@/lib/editing/types';
import { vi } from 'vitest';
import { createEditingSession } from '@/lib/editing/session';
import { testPersistence } from '@/lib/editing/persistence-test-helpers';
import { fixture } from '@/lib/editing/test-fixtures';
export async function setupText() {
  const project = fixture();
  let version = 0;
  const ops = vi.fn<EditContext['client']['ops']>(async () => ({
    version: ++version,
  }));
  const toast = vi.fn();
  const selectionRemoved = vi.fn();
  let n = 0;
  const editing = createEditingSession({
    persistence: testPersistence().persistence,
    sessionId: 'text-test',
    project,
    client: {
      ops,
      session: async () => ({ status: 'editing', project, assets: [] }),
    },
    makeId: () => `text-${++n}`,
    notifications: { toast },
    selectionRemoved,
  });
  await editing.ready();
  return { project, editing, ops, toast, selectionRemoved };
}
