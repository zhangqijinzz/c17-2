import {
  characterColors,
  createId,
  createStarterStory,
  defaultActName,
  type StoryAct,
  type StoryCharacter,
  type StoryClue,
  type StoryDocument,
  type StoryScene,
} from '../models/story';
import {
  getStats,
  getTimelineWarning,
  getScenePlacement,
  groupedScenes,
  orderedActs,
  orderedScenes,
  validateName,
  type ActGroup,
  type ScenePlacement,
} from '../models/storyRules';
import type { StoryRepository } from '../repositories/storyRepository';

export type ViewModelStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';

export interface StoryViewState {
  status: ViewModelStatus;
  story: StoryDocument | null;
  stats: ReturnType<typeof getStats>;
  notice: string;
  error: string;
  search: string;
  activeSection: 'overview' | 'characters' | 'clues';
}

type Listener = () => void;

export class StoryViewModel {
  private state: StoryViewState = {
    status: 'loading',
    story: null,
    stats: { characters: 0, scenes: 0, clues: 0, unresolvedClues: 0, completion: 0 },
    notice: '',
    error: '',
    search: '',
    activeSection: 'overview',
  };
  private readonly listeners = new Set<Listener>();

  constructor(private readonly repository: StoryRepository) {}

  get snapshot(): StoryViewState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialize(): void {
    try {
      const story = this.repository.load();
      this.setState({ status: story.status === 'complete' ? 'completed' : 'ready', story, stats: getStats(story), error: '' });
    } catch {
      this.setState({ status: 'error', error: '故事读取失败，请重置为示例项目。' });
    }
  }

  setSearch(search: string): void {
    this.setState({ search });
  }

  setSection(activeSection: StoryViewState['activeSection']): void {
    this.setState({ activeSection });
  }

  selectScene(sceneId: string): void {
    this.updateStory((story) => ({ ...story, selectedSceneId: sceneId }));
  }

  addCharacter(name: string, role: string): void {
    const cleanName = validateName(name);
    if (cleanName === '至少输入 2 个字') {
      this.setState({ notice: cleanName });
      return;
    }
    const story = this.requireStory();
    const character: StoryCharacter = {
      id: createId('character'),
      name: cleanName,
      role: role.trim() || '待定义角色',
      color: characterColors[story.characters.length % characterColors.length],
    };
    this.updateStory((current) => ({ ...current, characters: [...current.characters, character] }));
    this.setState({ notice: `已加入人物「${character.name}」` });
  }

  addAct(name?: string): string {
    const cleanName = (name ?? '').trim() || defaultActName(this.requireStory().acts.length);
    const act: StoryAct = { id: createId('act'), name: cleanName, order: this.requireStory().acts.length + 1 };
    this.updateStory((story) => ({ ...story, acts: [...story.acts, act] }));
    this.setState({ notice: `已新建幕「${act.name}」` });
    return act.id;
  }

  renameAct(actId: string, name: string): void {
    const cleanName = name.trim();
    if (!cleanName) {
      this.setState({ notice: '幕名称不能为空' });
      return;
    }
    this.updateStory((story) => ({
      ...story,
      acts: story.acts.map((act) => (act.id === actId ? { ...act, name: cleanName } : act)),
    }), false);
  }

  /** 整幕调整次序，幕内场景随幕一起移动，编号自动收敛。 */
  moveAct(actId: string, direction: 'up' | 'down'): void {
    const acts = orderedActs(this.requireStory());
    const index = acts.findIndex((act) => act.id === actId);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= acts.length) return;
    [acts[index], acts[nextIndex]] = [acts[nextIndex], acts[index]];
    this.updateStory((story) => ({ ...story, acts: acts.map((act, actIndex) => ({ ...act, order: actIndex + 1 })) }));
    this.setState({ notice: '幕顺序已更新' });
  }

  /**
   * 新建场景，必须明确落在哪一幕；未指定时落到最后一幕末尾。
   * 幕内顺序直接收敛为该幕场景数 + 1，不留断号。
   */
  addScene(title: string, summary: string, actId?: string): void {
    const cleanTitle = validateName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    const story = this.requireStory();
    const acts = orderedActs(story);
    const targetAct = acts.find((act) => act.id === actId) ?? acts[acts.length - 1];
    if (!targetAct) {
      this.setState({ notice: '请先创建一幕' });
      return;
    }
    const scene: StoryScene = {
      id: createId('scene'),
      title: cleanTitle,
      order: story.scenes.filter((item) => item.actId === targetAct.id).length + 1,
      actId: targetAct.id,
      summary: summary.trim() || '还没有写下这一幕发生了什么。',
      conflict: '',
      characterIds: [],
      clueIds: [],
    };
    this.updateStory((current) => ({ ...current, scenes: [...current.scenes, scene], selectedSceneId: scene.id }));
    this.setState({ notice: `已在「${targetAct.name}」创建场景「${scene.title}」` });
  }

  updateScene(sceneId: string, patch: Partial<Pick<StoryScene, 'title' | 'summary' | 'conflict'>>): void {
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
    }), false);
  }

  toggleCharacter(sceneId: string, characterId: string): void {
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        const hasCharacter = scene.characterIds.includes(characterId);
        return { ...scene, characterIds: hasCharacter ? scene.characterIds.filter((id) => id !== characterId) : [...scene.characterIds, characterId] };
      }),
    }));
  }

  /**
   * 场景上移 / 下移，按「先幕后幕内」的全局顺序比较：
   * - 同一幕内：与相邻场景交换；
   * - 到达幕边界：场景进入相邻的幕并落在紧邻位置，两侧幕内顺序各自重新收敛，
   *   不会出现断号或重号。
   */
  moveScene(sceneId: string, direction: 'up' | 'down'): void {
    const story = this.requireStory();
    const scenes = orderedScenes(story);
    const index = scenes.findIndex((scene) => scene.id === sceneId);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= scenes.length) return;
    const moving = scenes[index];
    const neighbor = scenes[nextIndex];
    const crossedAct = moving.actId !== neighbor.actId;
    if (crossedAct) {
      // 跨幕：只让移动中的场景进入相邻幕（生成新对象，不改旧状态），相邻场景留在原幕；
      // 交换位置后两侧幕内顺序统一重新收敛。
      scenes[index] = { ...moving, actId: neighbor.actId };
      [scenes[index], scenes[nextIndex]] = [scenes[nextIndex], scenes[index]];
    } else {
      [scenes[index], scenes[nextIndex]] = [scenes[nextIndex], scenes[index]];
    }
    this.commitReorderedScenes(story, scenes, crossedAct ? neighbor.actId : null);
  }

  /** 把场景整体移入另一幕的末尾，源幕与目标幕内顺序自动收敛。 */
  moveSceneToAct(sceneId: string, targetActId: string): void {
    const story = this.requireStory();
    const targetAct = story.acts.find((act) => act.id === targetActId);
    const scene = story.scenes.find((item) => item.id === sceneId);
    if (!targetAct || !scene || scene.actId === targetActId) return;

    const without = orderedScenes(story).filter((item) => item.id !== sceneId);
    const updatedScene = { ...scene, actId: targetActId };
    const targetScenes = without.filter((item) => item.actId === targetActId);
    if (targetScenes.length > 0) {
      // 目标幕非空：追加到该幕最后一个场景之后
      const last = targetScenes[targetScenes.length - 1];
      without.splice(without.indexOf(last) + 1, 0, updatedScene);
    } else {
      // 目标幕为空：按幕的相对位置插到正确的全局位置
      const actRank = new Map(orderedActs(story).map((act, index) => [act.id, index]));
      const targetRank = actRank.get(targetActId) ?? Number.MAX_SAFE_INTEGER;
      let insertIndex = without.findIndex((item) => (actRank.get(item.actId) ?? Number.MAX_SAFE_INTEGER) > targetRank);
      if (insertIndex < 0) insertIndex = without.length;
      without.splice(insertIndex, 0, updatedScene);
    }
    this.commitReorderedScenes(story, without, targetActId);
  }

  addClue(title: string, setupSceneId: string, payoffSceneId: string): void {
    const cleanTitle = validateName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    if (!setupSceneId) {
      this.setState({ notice: '请先选择伏笔埋下的场景' });
      return;
    }
    const clue: StoryClue = { id: createId('clue'), title: cleanTitle, setupSceneId, payoffSceneId };
    this.updateStory((story) => ({
      ...story,
      clues: [...story.clues, clue],
      scenes: story.scenes.map((scene) => scene.id === setupSceneId ? { ...scene, clueIds: [...scene.clueIds, clue.id] } : scene),
    }));
    this.setState({ notice: payoffSceneId ? '伏笔关系已建立' : '伏笔已记录，等待回收' });
  }

  completeProject(): void {
    this.updateStory((story) => ({ ...story, status: 'complete' }));
    this.setState({ status: 'completed', notice: '项目已标记为完成，仍可继续编辑' });
  }

  resetProject(): void {
    const story = createStarterStory();
    this.persist(story);
    this.setState({ status: 'ready', story, stats: getStats(story), notice: '已恢复示例项目', error: '' });
  }

  get visibleCharacters(): StoryCharacter[] {
    const story = this.requireStory();
    const keyword = this.state.search.trim().toLowerCase();
    return story.characters.filter((character) => `${character.name}${character.role}`.toLowerCase().includes(keyword));
  }

  get visibleScenes(): StoryScene[] {
    const story = this.requireStory();
    const keyword = this.state.search.trim().toLowerCase();
    return orderedScenes(story).filter((scene) => `${scene.title}${scene.summary}${scene.conflict}`.toLowerCase().includes(keyword));
  }

  /**
   * 时间线按幕分组：
   * - 无搜索词时展示全部幕（含空幕，空幕仍可命名、整段排序、往里加场景）；
   * - 有搜索词时只保留命中场景所在的幕。
   * 每个分组的 actIndex / totalActs 始终取真实幕序，不受搜索过滤影响。
   */
  get visibleActGroups(): Array<ActGroup & { actIndex: number; totalActs: number }> {
    const groups = groupedScenes(this.requireStory());
    const keyword = this.state.search.trim().toLowerCase();
    return groups
      .map((group, actIndex) => ({
        ...group,
        scenes: keyword
          ? group.scenes.filter((scene) => `${scene.title}${scene.summary}${scene.conflict}`.toLowerCase().includes(keyword))
          : group.scenes,
        actIndex,
        totalActs: groups.length,
      }))
      .filter((group) => !keyword || group.scenes.length > 0);
  }

  get allActs(): StoryAct[] {
    return orderedActs(this.requireStory());
  }

  /** 场景在分层时间线中的位置（幕内第几、全局第几），供检查器上移下移判边界。 */
  placementOf(sceneId: string): ScenePlacement | null {
    return getScenePlacement(this.requireStory(), sceneId);
  }

  get selectedScene(): StoryScene | null {
    const story = this.state.story;
    return story?.scenes.find((scene) => scene.id === story.selectedSceneId) ?? null;
  }

  get timelineWarning(): string | null {
    const story = this.state.story;
    return story ? getTimelineWarning(story) : null;
  }

  private commitReorderedScenes(story: StoryDocument, globalOrder: StoryScene[], movedIntoActId: string | null): void {
    // 按全局顺序重排后，逐幕把 scene.order 收敛为连续编号，幕 order 同样收敛。
    const acts = orderedActs(story).map((act, index) => ({ ...act, order: index + 1 }));
    const counters = new Map<string, number>();
    const scenes = globalOrder.map((scene) => {
      const next = (counters.get(scene.actId) ?? 0) + 1;
      counters.set(scene.actId, next);
      return { ...scene, order: next };
    });
    this.updateStory((current) => ({ ...current, acts, scenes }));
    if (movedIntoActId) {
      const actName = acts.find((act) => act.id === movedIntoActId)?.name ?? '';
      this.setState({ notice: `场景已移入「${actName}」，幕内顺序已自动整理` });
    } else {
      this.setState({ notice: '时间线顺序已更新' });
    }
  }

  private requireStory(): StoryDocument {
    if (!this.state.story) throw new Error('故事尚未初始化');
    return this.state.story;
  }

  private updateStory(updater: (story: StoryDocument) => StoryDocument, showEditing = true): void {
    const story = updater(this.requireStory());
    this.persist(story);
    this.setState({ story, stats: getStats(story), status: showEditing ? 'editing' : this.state.status, error: '' });
  }

  private persist(story: StoryDocument): void {
    try {
      this.repository.save({ ...story, updatedAt: new Date().toISOString() });
    } catch {
      this.setState({ status: 'error', error: '保存失败，但当前编辑仍保留在页面中。' });
    }
  }

  private setState(patch: Partial<StoryViewState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}
