import { describe, expect, it } from 'vitest';
import { createStarterStory } from '../models/story';
import { getTimelineWarning, orderedScenes } from '../models/storyRules';
import { LocalStoryRepository } from '../repositories/storyRepository';
import { MemoryStorageService } from '../services/storageService';
import { StoryViewModel } from '../viewmodels/storyViewModel';

describe('story view model', () => {
  it('initializes, edits, persists, and restores the main flow', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    expect(viewModel.snapshot.status).toBe('ready');
    viewModel.addCharacter('阿洛', '修复师');
    viewModel.addScene('地下档案室', '他们找到被隐藏的航海日志。');
    const scene = viewModel.selectedScene;
    expect(scene?.title).toBe('地下档案室');
    viewModel.toggleCharacter(scene?.id ?? '', viewModel.snapshot.story?.characters[2]?.id ?? '');
    expect(viewModel.snapshot.stats.characters).toBe(3);

    const restored = new StoryViewModel(repository);
    restored.initialize();
    expect(restored.snapshot.story?.scenes.some((item) => item.title === '地下档案室')).toBe(true);
    expect(restored.snapshot.story?.characters.some((item) => item.name === '阿洛')).toBe(true);
  });

  it('shows recoverable validation feedback and resets corrupt storage', () => {
    const storage = new MemoryStorageService();
    storage.write('{broken');
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();
    viewModel.addCharacter(' ', '');
    expect(viewModel.snapshot.notice).toContain('至少');
    viewModel.resetProject();
    expect(viewModel.snapshot.story?.id).toBe(createStarterStory().id);
  });

  it('creates named acts, renames and reorders whole acts', () => {
    const viewModel = freshViewModel();
    const newActId = viewModel.addAct('  第三幕 · 真相  ');
    expect(viewModel.allActs.map((act) => act.name)).toEqual(['第一幕 · 来信', '第二幕 · 暗涌', '第三幕 · 真相']);

    viewModel.renameAct(newActId, '终幕');
    expect(viewModel.allActs[2].name).toBe('终幕');

    viewModel.moveAct(newActId, 'up');
    expect(viewModel.allActs.map((act) => act.id)).toEqual([viewModel.allActs[0].id, newActId, viewModel.allActs[2].id]);
    // 编号连续收敛，场景随所属幕一起移动，全局顺序由幕序决定
    expect(viewModel.allActs.map((act) => act.order)).toEqual([1, 2, 3]);
    expect(orderedScenes(viewModel.snapshot.story as NonNullable<typeof viewModel.snapshot.story>).map((scene) => scene.id)).toEqual(
      orderedScenes(createStarterStory()).map((scene) => scene.id),
    );
  });

  it('adds scenes into a chosen act with continuous in-act numbers', () => {
    const viewModel = freshViewModel();
    const firstAct = viewModel.allActs[0];
    viewModel.addScene('灯塔停电', '夜里灯熄了。', firstAct.id);
    const group = viewModel.visibleActGroups.find((item) => item.act.id === firstAct.id);
    expect(group?.scenes.map((scene) => scene.order)).toEqual([1, 2]);
  });

  it('moves a scene across the act boundary and converges in-act orders', () => {
    const viewModel = freshViewModel();
    const [firstAct, secondAct] = viewModel.allActs;
    // 第一幕：旧港口(1)；第二幕：风暴(1)。把第二幕唯一一场上移到第一幕
    const stormId = viewModel.visibleActGroups.find((item) => item.act.id === secondAct.id)?.scenes[0].id ?? '';
    viewModel.moveScene(stormId, 'up');

    let story = viewModel.snapshot.story!;
    expect(story.scenes.find((scene) => scene.id === stormId)?.actId).toBe(firstAct.id);
    expect(orderedScenes(story).map((scene) => scene.id)).toEqual([
      ...orderedScenes(createStarterStory()).reverse().map((scene) => scene.id),
    ]);
    // 同幕两场为 1、2，空幕无断号
    const firstGroup = viewModel.visibleActGroups.find((item) => item.act.id === firstAct.id);
    expect(firstGroup?.scenes.map((scene) => scene.order)).toEqual([1, 2]);
    expect(getTimelineWarning(story)).toBeNull();

    // 再整体移回第二幕，落在该幕末尾
    viewModel.moveSceneToAct(stormId, secondAct.id);
    story = viewModel.snapshot.story!;
    expect(story.scenes.find((scene) => scene.id === stormId)?.actId).toBe(secondAct.id);
    expect(viewModel.visibleActGroups.find((item) => item.act.id === firstAct.id)?.scenes.map((scene) => scene.order)).toEqual([1]);
    expect(viewModel.visibleActGroups.find((item) => item.act.id === secondAct.id)?.scenes.map((scene) => scene.order)).toEqual([1]);
  });

  it('migrates a stored v1 project into the default act on open', () => {
    const storage = new MemoryStorageService();
    storage.write(JSON.stringify({
      version: 1,
      id: 'legacy',
      title: '旧项目',
      status: 'draft',
      characters: [],
      scenes: [{ id: 's1', title: '唯一一场', order: 1, summary: '', conflict: '', characterIds: [], clueIds: [] }],
      clues: [],
      selectedSceneId: 's1',
      updatedAt: '',
    }));
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();
    const story = viewModel.snapshot.story;
    expect(story?.version).toBe(2);
    expect(story?.acts).toHaveLength(1);
    expect(story?.acts[0].name).toBe('第一幕');
    expect(story?.scenes[0].actId).toBe(story?.acts[0].id);
    expect(viewModel.visibleActGroups).toHaveLength(1);
  });
});

function freshViewModel(): StoryViewModel {
  const viewModel = new StoryViewModel(new LocalStoryRepository(new MemoryStorageService()));
  viewModel.initialize();
  return viewModel;
}
