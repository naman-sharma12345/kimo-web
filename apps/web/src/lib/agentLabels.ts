export type AgentLabelContext = {
  clip?: string;
  name?: string;
  label?: string;
};
/** Exact Phase 8 templates. Missing metadata uses a truthful generic title. */
export const agentLabelTemplates = {
  import_media: 'adding {name}',
  trim_clip: 'trimming {clip}',
  split_clip: 'splitting {clip}',
  move_clip: 'moving {clip}',
  add_text: 'writing a title',
  add_captions: 'writing captions',
  color_grade: 'grading colour on {clip}',
  sam_segment: 'finding the {label} with sam 3.1',
  reframe: 'reframing for {aspect}',
  web_image_search: 'searching the web for “{query}”',
  add_music: 'adding music',
  duck_audio: 'balancing music under voice',
  add_transition: 'adding a {type}',
  muse_watch: 'watching {clip}',
  transcribe: 'transcribing speech',
  remove_silence: 'removing pauses',
  apply_effect: 'adding {effect}',
} as const;
const generic: Record<string, string> = {
  import_media: 'adding media',
  trim_clip: 'trimming a clip',
  split_clip: 'splitting a clip',
  move_clip: 'moving a clip',
  color_grade: 'grading colour',
  sam_segment: 'finding a selection with sam 3.1',
  reframe: 'reframing',
  web_image_search: 'searching the web',
  add_transition: 'adding a transition',
  muse_watch: 'watching a clip',
  apply_effect: 'adding an effect',
};
export function agentLabel(
  tool: string,
  args: Readonly<Record<string, unknown>> = {},
  context: AgentLabelContext = {},
): string {
  const template = Object.entries(agentLabelTemplates).find(
    ([name]) => name === tool,
  )?.[1];
  if (!template) return tool.replaceAll('_', ' ');
  let missing = false;
  const output = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value =
      key === 'clip'
        ? (context.clip ?? args.clip)
        : key === 'name'
          ? (context.name ?? args.name)
          : key === 'label'
            ? (context.label ?? args.label)
            : args[key];
    if (typeof value === 'string' && value.trim()) return value;
    missing = true;
    return '';
  });
  return missing ? (generic[tool] ?? tool.replaceAll('_', ' ')) : output;
}
export const getAgentLabel = agentLabel;
