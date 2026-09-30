import {
  characterColors,
  createId,
  createStarterStory,
  type StoryAct,
  type StoryCharacter,
  type StoryClue,
  type StoryDocument,
  type StoryScene,
} from '../models/story';
import {
  getStats,
  getTimelineWarning,
  groupedScenes,
  normalizeStory,
  orderedActs,
  orderedScenes,
  validateActName,
  validateName,
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

  /** 新建场景：actId 指定落在哪一幕，缺省时跟随当前选中场景所在幕，再缺省落入第一幕 */
  addScene(title: string, summary: string, actId?: string): void {
    const cleanTitle = validateName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    const story = this.requireStory();
    const acts = orderedActs(story);
    const selectedActId = story.scenes.find((scene) => scene.id === story.selectedSceneId)?.actId;
    const targetAct = acts.find((act) => act.id === actId) ?? acts.find((act) => act.id === selectedActId) ?? acts[0];
    if (!targetAct) {
      this.setState({ notice: '请先创建一幕再添加场景' });
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
    this.setState({ notice: `已在「${targetAct.title}」末尾创建场景「${scene.title}」` });
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
   * 沿展开时间线移动场景：同幕内交换幕内次序；
   * 到达幕边界时跨幕交换——两张卡在展开线上互换位置后，按各幕占据的
   * 位置段重新分配幕属，因此两幕的幕内编号都会连续收敛，不留断号或重号。
   */
  moveScene(sceneId: string, direction: 'up' | 'down'): void {
    const story = this.requireStory();
    const acts = orderedActs(story);
    const flat = orderedScenes(story);
    const index = flat.findIndex((scene) => scene.id === sceneId);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= flat.length) return;
    const crossing = flat[index].actId !== flat[nextIndex].actId;
    [flat[index], flat[nextIndex]] = [flat[nextIndex], flat[index]];
    // 交换可能跨越幕边界：各幕在展开线上占据的位置段大小不变，
    // 按段把落进来的卡收编、把移出去的卡交给相邻幕，并重排幕内序号。
    const groupSizes = new Map(acts.map((act) => [act.id, story.scenes.filter((scene) => scene.actId === act.id).length]));
    const resegmented: StoryScene[] = [];
    let cursor = 0;
    acts.forEach((act) => {
      const size = groupSizes.get(act.id) ?? 0;
      flat.slice(cursor, cursor + size).forEach((scene, sceneIndex) => {
        resegmented.push({ ...scene, actId: act.id, order: sceneIndex + 1 });
      });
      cursor += size;
    });
    this.commitFlat(resegmented);
    this.setState({ notice: crossing ? '场景已跨幕移动，幕内顺序已自动收敛' : '时间线顺序已更新' });
  }

  /**
   * 跨幕移动（明确指定落在哪一层）：把场景放入 targetActId 的 targetOrder 位置
   * （幕内序号，从 1 开始；省略则追加到该幕末尾）。移出幕与落入幕都会自动收敛。
   */
  moveSceneToAct(sceneId: string, targetActId: string, targetOrder?: number): void {
    const story = this.requireStory();
    const scene = story.scenes.find((item) => item.id === sceneId);
    if (!scene || !story.acts.some((act) => act.id === targetActId)) return;
    const removed = orderedScenes(story).filter((item) => item.id !== sceneId);
    const targetScenes = removed.filter((item) => item.actId === targetActId);
    const insertAt = Math.min(Math.max((targetOrder ?? targetScenes.length + 1) - 1, 0), targetScenes.length);
    targetScenes.splice(insertAt, 0, { ...scene, actId: targetActId });
    // 按幕顺序重建展开线：非目标幕保持原位，目标幕整组替换为插入后的序列
    const rebuilt = orderedActs(story).flatMap((act) =>
      act.id === targetActId ? targetScenes : removed.filter((item) => item.actId === act.id),
    );
    this.commitFlat(rebuilt);
    this.setState({
      notice:
        scene.actId === targetActId
          ? '幕内顺序已更新'
          : `场景已移入「${story.acts.find((act) => act.id === targetActId)?.title ?? ''}」，幕内顺序已自动收敛`,
    });
  }

  addAct(title: string): void {
    const cleanTitle = validateActName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    const story = this.requireStory();
    const act: StoryAct = {
      id: createId('act'),
      title: cleanTitle || `第${story.acts.length + 1}幕`,
      order: story.acts.length + 1,
    };
    this.updateStory((current) => ({ ...current, acts: [...current.acts, act] }));
    this.setState({ notice: `已新增「${act.title}」` });
  }

  renameAct(actId: string, title: string): void {
    const cleanTitle = validateActName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    if (!cleanTitle) return;
    this.updateStory((story) => ({
      ...story,
      acts: story.acts.map((act) => (act.id === actId ? { ...act, title: cleanTitle } : act)),
    }), false);
  }

  /** 整幕调整次序：与相邻幕交换，幕内场景的先后关系保持不变 */
  moveAct(actId: string, direction: 'up' | 'down'): void {
    const acts = orderedActs(this.requireStory());
    const index = acts.findIndex((act) => act.id === actId);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= acts.length) return;
    [acts[index], acts[nextIndex]] = [acts[nextIndex], acts[index]];
    this.updateStory((story) => ({
      ...story,
      acts: acts.map((act, actIndex) => ({ ...act, order: actIndex + 1 })),
    }));
    this.setState({ notice: '幕次序已调整' });
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

  /** 时间线按幕分组，搜索时只保留含命中场景的幕 */
  get groupedVisibleScenes() {
    const story = this.requireStory();
    const keyword = this.state.search.trim().toLowerCase();
    if (!keyword) return groupedScenes(story);
    const visibleIds = new Set(this.visibleScenes.map((scene) => scene.id));
    return groupedScenes(story, visibleIds);
  }

  get selectedScene(): StoryScene | null {
    const story = this.state.story;
    return story?.scenes.find((scene) => scene.id === story.selectedSceneId) ?? null;
  }

  get timelineWarning(): string | null {
    const story = this.state.story;
    return story ? getTimelineWarning(story) : null;
  }

  private requireStory(): StoryDocument {
    if (!this.state.story) throw new Error('故事尚未初始化');
    return this.state.story;
  }

  /** 用一条展开后的场景序列重建文档，幕内编号自动收敛 */
  private commitFlat(flatScenes: StoryScene[]): void {
    this.updateStory((story) => normalizeStory({ ...story, scenes: flatScenes }));
  }

  private updateStory(updater: (story: StoryDocument) => StoryDocument, showEditing = true): void {
    const story = normalizeStory(updater(this.requireStory()));
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
