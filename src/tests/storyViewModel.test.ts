import { describe, expect, it } from 'vitest';
import { createStarterStory } from '../models/story';
import { orderedScenes } from '../models/storyRules';
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

  it('adds, renames, and reorders whole acts', () => {
    const viewModel = new StoryViewModel(new LocalStoryRepository(new MemoryStorageService()));
    viewModel.initialize();
    viewModel.addAct('第二幕 · 转折');
    let story = viewModel.snapshot.story!;
    expect(story.acts.map((act) => act.title)).toEqual(['第一幕', '第二幕 · 转折']);
    expect(story.acts.map((act) => act.order)).toEqual([1, 2]);

    viewModel.moveAct(story.acts[1].id, 'up');
    story = viewModel.snapshot.story!;
    expect(story.acts.find((act) => act.title === '第二幕 · 转折')?.order).toBe(1);
    expect(story.acts.find((act) => act.title === '第一幕')?.order).toBe(2);

    const firstActId = story.acts.find((act) => act.order === 1)!.id;
    viewModel.renameAct(firstActId, '序章');
    expect(viewModel.snapshot.story!.acts.find((act) => act.id === firstActId)?.title).toBe('序章');
  });

  it('auto-names an empty act and rejects a one-character name', () => {
    const viewModel = new StoryViewModel(new LocalStoryRepository(new MemoryStorageService()));
    viewModel.initialize();
    viewModel.addAct('   ');
    const acts = viewModel.snapshot.story!.acts;
    expect(acts[acts.length - 1]?.title).toBe('第2幕');
    viewModel.addAct('幕');
    expect(viewModel.snapshot.notice).toContain('至少');
  });

  it('creates a scene inside a chosen act', () => {
    const viewModel = new StoryViewModel(new LocalStoryRepository(new MemoryStorageService()));
    viewModel.initialize();
    viewModel.addAct('第二幕');
    const secondActId = viewModel.snapshot.story!.acts.find((act) => act.order === 2)!.id;
    viewModel.addScene('灯塔停电', '全城陷入黑暗。', secondActId);
    const scene = viewModel.selectedScene!;
    expect(scene.actId).toBe(secondActId);
    expect(scene.order).toBe(1);
  });

  it('moves a scene across acts from the act boundary and renumbers both acts', () => {
    const viewModel = new StoryViewModel(new LocalStoryRepository(new MemoryStorageService()));
    viewModel.initialize();
    // 第一幕：旧港口(1) 风暴(2)
    viewModel.addAct('第二幕');
    const story = viewModel.snapshot.story!;
    const secondActId = story.acts.find((act) => act.title === '第二幕')!.id;
    viewModel.addScene('灯塔停电', '黑暗。', secondActId);   // 第二幕：停电(1)
    const blackoutId = viewModel.selectedScene!.id;
    viewModel.addScene('黎明', '天亮了。', secondActId);     // 第二幕：停电(1) 黎明(2)
    const dawnId = viewModel.selectedScene!.id;
    viewModel.selectScene('scene-storm');
    // 风暴是第一幕最后一场，向下即跨幕：与第二幕头场「停电」互换位置与幕属
    viewModel.moveScene('scene-storm', 'down');
    const updated = viewModel.snapshot.story!;
    expect(updated.scenes.find((scene) => scene.id === 'scene-storm')?.actId).toBe(secondActId);
    expect(orderedScenes(updated).find((scene) => scene.id === blackoutId)?.actId).toBe('act-default');
    const actOne = orderedScenes(updated).filter((scene) => scene.actId === 'act-default');
    const actTwo = orderedScenes(updated).filter((scene) => scene.actId === secondActId);
    expect(actOne.map((scene) => scene.order)).toEqual([1, 2]);
    expect(actOne.map((scene) => scene.id)).toEqual(['scene-old-harbor', blackoutId]);
    expect(actTwo.map((scene) => scene.id)).toEqual(['scene-storm', dawnId]);
    expect(actTwo.map((scene) => scene.order)).toEqual([1, 2]);
    expect(viewModel.snapshot.notice).toContain('跨幕');
  });

  it('moves a scene to a chosen act and converges in-act order without gaps or duplicates', () => {
    const viewModel = new StoryViewModel(new LocalStoryRepository(new MemoryStorageService()));
    viewModel.initialize();
    viewModel.addAct('第二幕');
    const secondActId = viewModel.snapshot.story!.acts.find((act) => act.title === '第二幕')!.id;
    viewModel.addScene('停电', '黑暗。', secondActId);
    // 旧港口(第一幕第1场)显式移入第二幕第2位
    viewModel.moveSceneToAct('scene-old-harbor', secondActId, 2);
    const updated = viewModel.snapshot.story!;
    const secondAct = orderedScenes(updated).filter((scene) => scene.actId === secondActId);
    expect(secondAct.map((scene) => scene.order)).toEqual([1, 2]);
    expect(secondAct.map((scene) => scene.id)).toEqual([expect.any(String), 'scene-old-harbor']);
    // 第一幕只剩风暴，编号从 2 收敛回 1
    expect(updated.scenes.find((scene) => scene.id === 'scene-storm')?.order).toBe(1);
  });

  it('keeps the flattened timeline consistent after reloading from storage', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    viewModel.addAct('第二幕');
    const secondActId = viewModel.snapshot.story!.acts.find((act) => act.title === '第二幕')!.id;
    viewModel.moveSceneToAct('scene-storm', secondActId);

    const restored = new StoryViewModel(repository);
    restored.initialize();
    const story = restored.snapshot.story!;
    expect(story.version).toBe(2);
    expect(orderedScenes(story).map((scene) => scene.id)).toEqual(['scene-old-harbor', 'scene-storm']);
    expect(story.scenes.map((scene) => scene.order).sort((a, b) => a - b)).toEqual([1, 1]);
  });
});
