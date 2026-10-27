import type { AgentAction, AgentState, ChatItem } from './types';
export function selectForegroundAction(
  state: AgentState,
): AgentAction | undefined {
  const action = state.foregroundActionId
    ? state.actions[state.foregroundActionId]
    : undefined;
  return action?.status === 'running' ? action : undefined;
}
export function selectActionGroups(state: AgentState) {
  return state.items.filter(
    (item): item is Extract<ChatItem, { kind: 'action-group' }> =>
      item.kind === 'action-group',
  );
}
export function selectGroupActions(
  state: AgentState,
  groupId: string,
): AgentAction[] {
  return state.actionOrder.flatMap((id) => {
    const action = state.actions[id];
    return action?.groupId === groupId ? [action] : [];
  });
}
export type ActionFilter = 'all' | 'edits' | 'ai models' | 'failed';
const aiTools = new Set(['sam_segment', 'sam_mask', 'muse_watch']);
const editTools = new Set([
  'import_media',
  'import_clip',
  'trim_clip',
  'split_clip',
  'move_clip',
  'add_text',
  'add_title',
  'add_captions',
  'color_grade',
  'colour_grade',
  'reframe',
  'reframe_clip',
  'add_music',
  'duck_audio',
  'duck_music',
  'add_transition',
  'remove_silence',
  'apply_effect',
  'create_track',
  'animate_reframe',
  'balance_audio',
  'add_web_image',
  'animate_title',
  'fade_music',
  'position_captions',
  'mark_review',
  'respond_to_note',
]);
export function selectActions(
  state: AgentState,
  options: { filter?: ActionFilter; search?: string } = {},
): AgentAction[] {
  const search = options.search?.trim().toLowerCase() ?? '';
  return state.actionOrder.flatMap((id) => {
    const action = state.actions[id];
    if (!action) return [];
    if (options.filter === 'failed' && action.status !== 'failed') return [];
    if (options.filter === 'ai models' && !aiTools.has(action.tool)) return [];
    if (options.filter === 'edits' && !editTools.has(action.tool)) return [];
    return [
      action.tool,
      action.title,
      action.target?.clipId,
      action.target?.trackId,
      action.target?.subjectLabel,
    ]
      .join(' ')
      .toLowerCase()
      .includes(search)
      ? [action]
      : [];
  });
}
export const selectCanFinish = (state: AgentState): boolean =>
  state.recordedActionIds.length > 0;
