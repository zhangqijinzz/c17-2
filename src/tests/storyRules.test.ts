import { describe, expect, it } from 'vitest';
import { createStarterStory, DEFAULT_ACT_ID, type StoryDocument } from '../models/story';
import {
  getStats,
  getTimelineWarning,
  groupedScenes,
  migrateStory,
  normalizeStory,
  orderedScenes,
  sanitizeStory,
  validateActName,
  validateName,
} from '../models/storyRules';

describe('story domain rules', () => {
  it('sorts scenes and calculates unresolved clues', () => {
    const story = createStarterStory();
    story.scenes = [...story.scenes].reverse();
    expect(orderedScenes(story).map((scene) => scene.title)).toEqual(['旧港口的来信', '风暴前夜']);
    expect(getStats(story)).toMatchObject({ characters: 2, scenes: 2, clues: 1, unresolvedClues: 1, completion: 80 });
  });

  it('guards invalid names and duplicate timeline orders', () => {
    const story = createStarterStory();
    story.scenes[1].order = story.scenes[0].order;
    expect(validateName(' ')).toBe('至少输入 2 个字');
    expect(validateActName('幕')).toBe('至少输入 2 个字');
    expect(getTimelineWarning(story)).toContain('重复');
  });

  it('allows empty act names to preserve the existing title', () => {
    expect(validateActName('   ')).toBe('');
  });

  it('rejects corrupt persisted documents', () => {
    expect(sanitizeStory('{bad json}')).toBeNull();
    expect(sanitizeStory({ version: 99 })).toBeNull();
    expect(sanitizeStory(createStarterStory())).not.toBeNull();
  });

  it('migrates v1 projects into the default act without changing scene order', () => {
    const v1 = {
      version: 1,
      id: 'legacy',
      title: '老故事',
      status: 'draft',
      characters: [],
      scenes: [
        { id: 's2', title: '第二场', order: 2, summary: '', conflict: '', characterIds: [], clueIds: [] },
        { id: 's1', title: '第一场', order: 1, summary: '', conflict: '', characterIds: [], clueIds: [] },
        { id: 's3', title: '第三场', order: 5, summary: '', conflict: '', characterIds: [], clueIds: [] },
      ],
      clues: [],
      selectedSceneId: 's1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const migrated = migrateStory(v1);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(2);
    expect(migrated!.acts).toEqual([{ id: DEFAULT_ACT_ID, title: '第一幕', order: 1 }]);
    // 原有先后关系保持不变，断号（order: 5）收敛为连续的 1..3
    expect(orderedScenes(migrated!).map((scene) => scene.id)).toEqual(['s1', 's2', 's3']);
    expect(orderedScenes(migrated!).map((scene) => scene.order)).toEqual([1, 2, 3]);
    expect(orderedScenes(migrated!).every((scene) => scene.actId === DEFAULT_ACT_ID)).toBe(true);
    expect(sanitizeStory(v1)?.acts).toHaveLength(1);
  });

  it('groups scenes by act and compares order across acts via the flattened line', () => {
    const story = createStarterStory();
    story.acts.push({ id: 'act-2', title: '第二幕', order: 2 });
    const storm = story.scenes.find((scene) => scene.id === 'scene-storm')!;
    storm.actId = 'act-2';
    storm.order = 1;
    const groups = groupedScenes(story);
    expect(groups.map((group) => group.act.title)).toEqual(['第一幕', '第二幕']);
    expect(groups[0].scenes.map((scene) => scene.id)).toEqual(['scene-old-harbor']);
    expect(groups[1].scenes.map((scene) => scene.id)).toEqual(['scene-storm']);
    expect(orderedScenes(story).map((scene) => scene.id)).toEqual(['scene-old-harbor', 'scene-storm']);
  });

  it('compares by act order first when acts are rearranged', () => {
    const story = createStarterStory();
    story.acts.push({ id: 'act-2', title: '第二幕', order: 2 });
    const first = story.scenes.find((scene) => scene.id === 'scene-old-harbor')!;
    first.actId = 'act-2';
    first.order = 1;
    const storm = story.scenes.find((scene) => scene.id === 'scene-storm')!;
    storm.actId = DEFAULT_ACT_ID;
    storm.order = 1;
    // 把第二幕整段移到前面：跨幕的先后随之翻转
    story.acts.find((act) => act.id === 'act-2')!.order = 1;
    story.acts.find((act) => act.id === DEFAULT_ACT_ID)!.order = 2;
    expect(orderedScenes(story).map((scene) => scene.id)).toEqual(['scene-old-harbor', 'scene-storm']);
  });

  it('normalizes gaps and duplicates inside acts and rehomes orphan scenes', () => {
    const story: StoryDocument = {
      ...createStarterStory(),
      acts: [
        { id: DEFAULT_ACT_ID, title: '第一幕', order: 2 },
        { id: 'act-2', title: '第二幕', order: 2 },
      ],
      scenes: [
        { id: 'a', title: '甲', order: 9, actId: DEFAULT_ACT_ID, summary: '', conflict: '', characterIds: [], clueIds: [] },
        { id: 'b', title: '乙', order: 9, actId: DEFAULT_ACT_ID, summary: '', conflict: '', characterIds: [], clueIds: [] },
        { id: 'c', title: '丙', order: 3, actId: 'gone', summary: '', conflict: '', characterIds: [], clueIds: [] },
      ],
    };
    const fixed = normalizeStory(story);
    expect(fixed.acts.map((act) => act.order)).toEqual([1, 2]);
    const firstActScenes = orderedScenes(fixed).filter((scene) => scene.actId === DEFAULT_ACT_ID);
    expect(firstActScenes.map((scene) => scene.order)).toEqual([1, 2, 3]);
    expect(firstActScenes.map((scene) => scene.id)).toEqual(['a', 'b', 'c']);
    expect(getTimelineWarning(fixed)).toBeNull();
  });
});
