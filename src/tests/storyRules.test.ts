import { describe, expect, it } from 'vitest';
import { createStarterStory, DEFAULT_ACT_ID, type StoryDocument } from '../models/story';
import {
  getStats,
  getTimelineWarning,
  groupedScenes,
  orderedScenes,
  renumberTimeline,
  sanitizeStory,
  validateName,
} from '../models/storyRules';

describe('story domain rules', () => {
  it('orders scenes by act then by in-act order and groups them', () => {
    const story = createStarterStory();
    story.scenes = [...story.scenes].reverse();
    expect(orderedScenes(story).map((scene) => scene.title)).toEqual(['旧港口的来信', '风暴前夜']);
    const groups = groupedScenes(story);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.scenes.map((scene) => scene.title))).toEqual([['旧港口的来信'], ['风暴前夜']]);
    expect(getStats(story)).toMatchObject({ characters: 2, scenes: 2, clues: 1, unresolvedClues: 1, completion: 80 });
  });

  it('guards invalid names and duplicate / gapped orders inside an act', () => {
    const story = createStarterStory();
    expect(validateName(' ')).toBe('至少输入 2 个字');

    const duplicated: StoryDocument = {
      ...story,
      scenes: story.scenes.map((scene) => ({ ...scene, actId: story.acts[0].id, order: 1 })),
    };
    expect(getTimelineWarning(duplicated)).toContain('重复');

    const gapped: StoryDocument = {
      ...story,
      scenes: story.scenes.map((scene) => ({ ...scene, actId: story.acts[0].id })).map((scene, index) => ({ ...scene, order: index * 2 + 1 })),
    };
    expect(getTimelineWarning(gapped)).toContain('断号');
  });

  it('renumbers acts and in-act scenes after reordering, closing gaps', () => {
    const story = createStarterStory();
    const [firstAct, secondAct] = story.acts;
    const messy: StoryDocument = {
      ...story,
      acts: [
        { ...secondAct, order: 9 },
        { ...firstAct, order: 4 },
      ],
      scenes: [
        { ...story.scenes[0], order: 3 },
        { ...story.scenes[1], order: 7 },
      ],
    };
    const fixed = renumberTimeline(messy);
    expect(fixed.acts.map((act) => act.order)).toEqual([1, 2]);
    expect(fixed.scenes.map((scene) => scene.order).sort((a, b) => a - b)).toEqual([1, 1]);
  });

  it('migrates a v1 project into a default act while preserving scene order', () => {
    const v1 = {
      version: 1,
      id: 'legacy-story',
      title: '旧故事',
      status: 'draft',
      characters: [],
      scenes: [
        { id: 'scene-b', title: '第二场', order: 2, summary: '', conflict: '', characterIds: [], clueIds: [] },
        { id: 'scene-a', title: '第一场', order: 1, summary: '', conflict: '', characterIds: [], clueIds: [] },
      ],
      clues: [],
      selectedSceneId: 'scene-a',
      updatedAt: '',
    };
    const migrated = sanitizeStory(v1);
    expect(migrated).not.toBeNull();
    expect(migrated?.version).toBe(2);
    expect(migrated?.acts).toEqual([{ id: DEFAULT_ACT_ID, name: '第一幕', order: 1 }]);
    expect(orderedScenes(migrated as StoryDocument).map((scene) => scene.id)).toEqual(['scene-a', 'scene-b']);
    expect(migrated?.scenes.every((scene) => scene.actId === DEFAULT_ACT_ID)).toBe(true);
  });

  it('repairs scenes whose act disappeared and rejects corrupt documents', () => {
    expect(sanitizeStory('{bad json}')).toBeNull();
    expect(sanitizeStory({ version: 99 })).toBeNull();
    const orphan = {
      ...createStarterStory(),
      scenes: createStarterStory().scenes.map((scene) => ({ ...scene, actId: 'act-gone' })),
    };
    const repaired = sanitizeStory(orphan);
    expect(repaired).not.toBeNull();
    expect(repaired?.scenes.every((scene) => scene.actId === repaired.acts[0].id)).toBe(true);
    expect(getTimelineWarning(repaired as StoryDocument)).toBeNull();
  });
});
