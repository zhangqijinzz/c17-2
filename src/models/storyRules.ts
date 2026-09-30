import {
  createDefaultAct,
  DEFAULT_ACT_ID,
  type StoryAct,
  type StoryDocument,
  type StoryScene,
  type StoryStats,
} from './story';

/** 幕按 order 排列 */
export function orderedActs(story: StoryDocument): StoryAct[] {
  return [...story.acts].sort((a, b) => a.order - b.order);
}

/**
 * 展开后的全局场景顺序：先按幕的 order，再按场景在幕内的 order。
 * 场景之间的先后既可能是同幕内比较，也可能跨幕比较，统一走这条展开线。
 */
export function orderedScenes(story: StoryDocument): StoryScene[] {
  const actOrder = new Map(orderedActs(story).map((act, index) => [act.id, index]));
  return [...story.scenes].sort((a, b) => {
    const actGap = (actOrder.get(a.actId) ?? Number.MAX_SAFE_INTEGER) - (actOrder.get(b.actId) ?? Number.MAX_SAFE_INTEGER);
    return actGap !== 0 ? actGap : a.order - b.order;
  });
}

export interface ScenePlacement {
  actId: string;
  actIndex: number;
  actOrder: number;
  /** 幕内序号（从 1 开始） */
  orderInAct: number;
  /** 全局展开位置（从 0 开始） */
  globalIndex: number;
  totalScenes: number;
  actSceneCount: number;
}

/** 场景在层级中的定位，供界面判断上移/下移落在哪一层 */
export function getScenePlacement(story: StoryDocument, sceneId: string): ScenePlacement | null {
  const flat = orderedScenes(story);
  const globalIndex = flat.findIndex((scene) => scene.id === sceneId);
  if (globalIndex < 0) return null;
  const scene = flat[globalIndex];
  const acts = orderedActs(story);
  const actIndex = acts.findIndex((act) => act.id === scene.actId);
  const act = acts[actIndex];
  const scenesInAct = flat.filter((item) => item.actId === scene.actId);
  return {
    actId: scene.actId,
    actIndex,
    actOrder: act?.order ?? 0,
    orderInAct: scene.order,
    globalIndex,
    totalScenes: flat.length,
    actSceneCount: scenesInAct.length,
  };
}

export interface ActGroup {
  act: StoryAct;
  scenes: StoryScene[];
}

/**
 * 时间线按幕分组。传入 visibleSceneIds 时（如搜索过滤），
 * 只保留包含命中场景的幕；未过滤时空幕也保留（例如刚新建、还没放场景的幕），
 * 幕内顺序始终不变。
 */
export function groupedScenes(story: StoryDocument, visibleSceneIds?: Set<string>): ActGroup[] {
  const flat = orderedScenes(story);
  return orderedActs(story)
    .map((act) => ({
      act,
      scenes: flat.filter(
        (scene) => scene.actId === act.id && (visibleSceneIds === undefined || visibleSceneIds.has(scene.id)),
      ),
    }))
    .filter((group) => visibleSceneIds === undefined || group.scenes.length > 0);
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

/** 幕名允许留空（保留原名），非空时同样至少 2 个字 */
export function validateActName(value: string): string {
  const cleanValue = value.trim();
  return cleanValue.length === 0 || cleanValue.length >= 2 ? cleanValue : '至少输入 2 个字';
}

export function getTimelineWarning(story: StoryDocument): string | null {
  const actOrders = story.acts.map((act) => act.order);
  if (new Set(actOrders).size !== actOrders.length) {
    return '时间线存在重复幕序，请重新排列。';
  }
  const sceneKeys = story.scenes.map((scene) => `${scene.actId}:${scene.order}`);
  return new Set(sceneKeys).size !== sceneKeys.length ? '时间线存在重复顺序，请重新排列。' : null;
}

/**
 * 结构收敛：幕与场景的 order 都重排为从 1 开始的连续编号，
 * 不留下断号或重号；无所属幕（或幕已不存在）的场景归入第一幕末尾。
 */
export function normalizeStory(story: StoryDocument): StoryDocument {
  const sourceActs = orderedActs(story);
  const acts = sourceActs.length > 0 ? sourceActs : [createDefaultAct()];
  const validActIds = new Set(acts.map((act) => act.id));
  const fallbackActId = acts[0].id;

  const flat = orderedScenes(story);
  const counters = new Map<string, number>();
  const scenes = flat.map((scene) => {
    const actId = validActIds.has(scene.actId) ? scene.actId : fallbackActId;
    const next = (counters.get(actId) ?? 0) + 1;
    counters.set(actId, next);
    return { ...scene, actId, order: next };
  });

  return {
    ...story,
    acts: acts.map((act, index) => ({ ...act, order: index + 1 })),
    scenes,
  };
}

interface LegacyV1Document {
  version?: number;
  id?: unknown;
  title?: unknown;
  status?: unknown;
  characters?: unknown;
  scenes?: Array<Partial<StoryScene> & { id?: string }>;
  clues?: unknown;
  selectedSceneId?: unknown;
  updatedAt?: unknown;
}

function isRecordArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object');
}

/**
 * 读取旧项目：v1 文档自动迁移到 v2 —— 建立默认幕结构，
 * 原有场景按既有 order 全部归入「第一幕」，先后关系保持不变。
 * 损坏或无法识别的文档返回 null。
 */
export function migrateStory(input: unknown): StoryDocument | null {
  if (!input || typeof input !== 'object') return null;
  const candidate: LegacyV1Document = input as LegacyV1Document;
  if (candidate.version !== 1) return null;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.title !== 'string' ||
    !isRecordArray(candidate.characters) ||
    !isRecordArray(candidate.scenes) ||
    !isRecordArray(candidate.clues)
  ) {
    return null;
  }
  const scenes = (candidate.scenes ?? [])
    .filter((scene) => typeof scene.id === 'string')
    .map((scene) => ({
      ...(scene as StoryScene),
      actId: DEFAULT_ACT_ID,
    }));
  const migrated: StoryDocument = {
    version: 2,
    id: candidate.id,
    title: candidate.title,
    status: candidate.status === 'complete' ? 'complete' : 'draft',
    acts: [createDefaultAct()],
    characters: candidate.characters as StoryDocument['characters'],
    scenes,
    clues: candidate.clues as StoryDocument['clues'],
    selectedSceneId: typeof candidate.selectedSceneId === 'string' ? candidate.selectedSceneId : '',
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  };
  return normalizeStory(migrated);
}

/** 仓储加载入口：v2 直接收敛，v1 自动迁移，其余视为损坏 */
export function sanitizeStory(input: unknown): StoryDocument | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as { version?: number } & Record<string, unknown>;
  if (candidate.version === 1) return migrateStory(input);
  if (
    candidate.version !== 2 ||
    typeof candidate.id !== 'string' ||
    typeof candidate.title !== 'string' ||
    !Array.isArray(candidate.acts) ||
    !Array.isArray(candidate.characters) ||
    !Array.isArray(candidate.scenes) ||
    !Array.isArray(candidate.clues)
  ) {
    return null;
  }
  return normalizeStory(candidate as unknown as StoryDocument);
}
