import {
  DEFAULT_ACT_ID,
  DEFAULT_ACT_NAME,
  type StoryAct,
  type StoryDocument,
  type StoryScene,
  type StoryStats,
} from './story';

/** 幕按 order 排序。 */
export function orderedActs(story: StoryDocument): StoryAct[] {
  return [...story.acts].sort((a, b) => a.order - b.order);
}

/**
 * 全局场景顺序：先按幕的 order，再按幕内 scene.order。
 * 场景的先后既可在同一幕内比较，也可跨幕比较，该顺序是唯一准绳。
 */
export function orderedScenes(story: StoryDocument): StoryScene[] {
  const actOrder = new Map(orderedActs(story).map((act, index) => [act.id, index]));
  const actRank = (actId: string) => actOrder.get(actId) ?? Number.MAX_SAFE_INTEGER;
  return [...story.scenes].sort((a, b) => {
    if (a.actId !== b.actId) return actRank(a.actId) - actRank(b.actId);
    return a.order - b.order;
  });
}

export interface ActGroup {
  act: StoryAct;
  scenes: StoryScene[];
}

/** 时间线按幕分组展示，组内场景保持幕内顺序。 */
export function groupedScenes(story: StoryDocument): ActGroup[] {
  const scenes = orderedScenes(story);
  return orderedActs(story).map((act) => ({
    act,
    scenes: scenes.filter((scene) => scene.actId === act.id),
  }));
}

export interface ScenePlacement {
  /** 全局（跨幕）位置，从 0 开始。 */
  globalIndex: number;
  /** 幕内位置，从 0 开始。 */
  actIndex: number;
  act: StoryAct;
  totalScenes: number;
}

/** 找到场景落在哪一层、幕内第几、全局第几。 */
export function getScenePlacement(story: StoryDocument, sceneId: string): ScenePlacement | null {
  const groups = groupedScenes(story);
  let globalIndex = 0;
  for (const group of groups) {
    const actIndex = group.scenes.findIndex((scene) => scene.id === sceneId);
    if (actIndex >= 0) {
      return { globalIndex: globalIndex + actIndex, actIndex, act: group.act, totalScenes: story.scenes.length };
    }
    globalIndex += group.scenes.length;
  }
  return null;
}

export function getStats(story: StoryDocument): StoryStats {
  const unresolvedClues = story.clues.filter((clue) => clue.payoffSceneId === '').length;
  const totalSignals = story.characters.length + story.scenes.length + story.clues.length;
  const completedSignals = story.characters.length + story.scenes.length + (story.clues.length - unresolvedClues);
  const completion = totalSignals === 0 ? 0 : Math.round((completedSignals / totalSignals) * 100);
  return {
    characters: story.characters.length,
    scenes: story.scenes.length,
    clues: story.clues.length,
    unresolvedClues,
    completion,
  };
}

export function validateName(value: string): string {
  const cleanValue = value.trim();
  return cleanValue.length < 2 ? '至少输入 2 个字' : cleanValue;
}

/** 时间线异常检测：幕重复、幕内场景重号或断号、场景挂在不存在的幕上。 */
export function getTimelineWarning(story: StoryDocument): string | null {
  const actIds = new Set(story.acts.map((act) => act.id));
  if (actIds.size !== story.acts.length) return '存在重复的幕编号，请重新排列。';
  if (story.scenes.some((scene) => !actIds.has(scene.actId))) return '有场景不属于任何一幕，请重新归幕。';
  for (const group of groupedScenes(story)) {
    const orders = group.scenes.map((scene) => scene.order).sort((a, b) => a - b);
    if (new Set(orders).size !== orders.length) return `幕「${group.act.name}」内存在重复场景顺序，请重新排列。`;
    if (orders.some((order, index) => order !== index + 1)) return `幕「${group.act.name}」内顺序断号，请重新排列。`;
  }
  return null;
}

/**
 * 收敛整棵时间线：幕 order 重排为连续编号；每个幕内的 scene.order 重排为
 * 从 1 开始的连续编号。跨幕移动、整幕调整后调用，杜绝断号或重号。
 * 场景所属的幕（actId）不会被改变，只调整编号。
 */
export function renumberTimeline(story: StoryDocument): StoryDocument {
  const acts = orderedActs(story).map((act, index) => ({ ...act, order: index + 1 }));
  const sceneOrder = new Map<string, number>();
  for (const group of groupedScenes({ ...story, acts })) {
    group.scenes.forEach((scene, index) => sceneOrder.set(scene.id, index + 1));
  }
  return {
    ...story,
    acts,
    scenes: story.scenes.map((scene) => ({ ...scene, order: sceneOrder.get(scene.id) ?? scene.order })),
  };
}

interface LegacyDocument {
  version?: unknown;
  id?: unknown;
  title?: unknown;
  status?: unknown;
  characters?: unknown;
  acts?: unknown;
  scenes?: unknown;
  clues?: unknown;
  selectedSceneId?: unknown;
  updatedAt?: unknown;
}

interface LegacyScene {
  id?: unknown;
  order?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 旧项目（v1，没有幕结构）打开时自动落到默认幕里，
 * 全部场景归入「第一幕」，原先的先后关系（order）原样保留。
 */
function migrateV1(input: Record<string, unknown>): StoryDocument | null {
  const legacyScenes = Array.isArray(input.scenes) ? (input.scenes as LegacyScene[]) : [];
  const migrated: StoryDocument = {
    version: 2,
    id: typeof input.id === 'string' ? input.id : 'story-migrated',
    title: typeof input.title === 'string' ? input.title : '未命名故事',
    status: input.status === 'complete' ? 'complete' : 'draft',
    characters: Array.isArray(input.characters) ? (input.characters as StoryDocument['characters']) : [],
    acts: [{ id: DEFAULT_ACT_ID, name: DEFAULT_ACT_NAME, order: 1 }],
    scenes: legacyScenes.map((scene) => ({
      ...(scene as Record<string, unknown>),
      id: typeof scene.id === 'string' ? scene.id : '',
      order: typeof scene.order === 'number' ? scene.order : 1,
      actId: DEFAULT_ACT_ID,
    })) as StoryScene[],
    clues: Array.isArray(input.clues) ? (input.clues as StoryDocument['clues']) : [],
    selectedSceneId: typeof input.selectedSceneId === 'string' ? input.selectedSceneId : '',
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
  };
  return renumberTimeline(migrated);
}

/**
 * 兼容 v1 / v2：v1 自动迁移到默认幕结构；v2 中若有场景挂在已删除的幕上，
 * 收敛进第一幕，并重新连续编号，保证打开的文档始终结构完整。
 */
export function sanitizeStory(input: unknown): StoryDocument | null {
  if (!isRecord(input)) return null;
  const candidate = input as LegacyDocument;
  if (candidate.version === 1) {
    if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || !Array.isArray(candidate.scenes)) return null;
    return migrateV1(input);
  }
  if (
    candidate.version !== 2 ||
    typeof candidate.id !== 'string' ||
    typeof candidate.title !== 'string' ||
    !Array.isArray(candidate.characters) ||
    !Array.isArray(candidate.acts) ||
    !Array.isArray(candidate.scenes) ||
    !Array.isArray(candidate.clues)
  ) {
    return null;
  }
  const story = candidate as unknown as StoryDocument;
  if (story.acts.length === 0 || story.scenes.some((scene) => !story.acts.some((act) => act.id === scene.actId))) {
    const fallbackAct = story.acts[0] ?? { id: DEFAULT_ACT_ID, name: DEFAULT_ACT_NAME, order: 1 };
    const repaired: StoryDocument = {
      ...story,
      acts: story.acts.length > 0 ? story.acts : [fallbackAct],
      scenes: story.scenes.map((scene) =>
        story.acts.some((act) => act.id === scene.actId) ? scene : { ...scene, actId: fallbackAct.id },
      ),
    };
    return renumberTimeline(repaired);
  }
  return renumberTimeline(story);
}
