import { expect, it } from 'vitest';
import { agentLabel, agentLabelTemplates } from './agentLabels';
it('has all 17 exact Phase 8 labels', () => {
  const examples = {
    import_media: 'adding beach.mp4',
    trim_clip: 'trimming beach_02',
    split_clip: 'splitting beach_02',
    move_clip: 'moving beach_02',
    add_text: 'writing a title',
    add_captions: 'writing captions',
    color_grade: 'grading colour on beach_02',
    sam_segment: 'finding the person with sam 3.1',
    reframe: 'reframing for 9:16',
    web_image_search: 'searching the web for “beach”',
    add_music: 'adding music',
    duck_audio: 'balancing music under voice',
    add_transition: 'adding a crossfade',
    muse_watch: 'watching beach_02',
    transcribe: 'transcribing speech',
    remove_silence: 'removing pauses',
    apply_effect: 'adding grain',
  };
  expect(Object.keys(agentLabelTemplates)).toHaveLength(17);
  for (const [tool, expected] of Object.entries(examples))
    expect(
      agentLabel(tool, {
        name: 'beach.mp4',
        clip: 'beach_02',
        label: 'person',
        aspect: '9:16',
        query: 'beach',
        type: 'crossfade',
        effect: 'grain',
      }),
    ).toBe(expected);
});
it('does not invent missing metadata or coerce unknown argument values', () => {
  expect(agentLabel('sam_segment')).toBe('finding a selection with sam 3.1');
  expect(agentLabel('trim_clip', { clip: { id: 'x' } })).toBe(
    'trimming a clip',
  );
  expect(agentLabel('a_new_tool')).toBe('a new tool');
  expect(agentLabel('trim_clip', {}, { clip: 'actual clip' })).toBe(
    'trimming actual clip',
  );
});
