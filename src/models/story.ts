export type StoryStatus = 'draft' | 'complete';

export interface StoryCharacter {
  id: string;
  name: string;
  role: string;
  color: string;
}

export interface StoryAct {
  id: string;
  title: string;
  order: number;
}

export interface StoryScene {
  id: string;
  title: string;
  /** 幕内顺序：先后关系先在所属幕内比较，跨幕按幕的 order 比较 */
  order: number;
  actId: string;
  summary: string;
  conflict: string;
  characterIds: string[];
  clueIds: string[];
}

export interface StoryClue {
  id: string;
  title: string;
  setupSceneId: string;
  payoffSceneId: string;
}

export interface StoryDocument {
  version: 2;
  id: string;
  title: string;
  status: StoryStatus;
  acts: StoryAct[];
  characters: StoryCharacter[];
  scenes: StoryScene[];
  clues: StoryClue[];
  selectedSceneId: string;
  updatedAt: string;
}

export interface StoryStats {
  characters: number;
  scenes: number;
  clues: number;
  unresolvedClues: number;
  completion: number;
}

export const characterColors = ['coral', 'blue', 'gold', 'sage', 'violet'] as const;

/** 旧项目迁移时落位的默认幕 */
export const DEFAULT_ACT_ID = 'act-default';
export const DEFAULT_ACT_TITLE = '第一幕';

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultAct(order = 1): StoryAct {
  return { id: DEFAULT_ACT_ID, title: DEFAULT_ACT_TITLE, order };
}

export function createStarterStory(): StoryDocument {
  const miraId = 'character-mira';
  const oldHarborId = 'scene-old-harbor';
  const firstLetterId = 'clue-first-letter';
  return {
    version: 2,
    id: 'story-last-lighthouse',
    title: '最后的灯塔',
    status: 'draft',
    acts: [createDefaultAct()],
    characters: [
      { id: miraId, name: '米拉', role: '灯塔守望人', color: 'coral' },
      { id: 'character-june', name: '裘恩', role: '失踪船长的女儿', color: 'blue' },
    ],
    scenes: [
      {
        id: oldHarborId,
        title: '旧港口的来信',
        order: 1,
        actId: DEFAULT_ACT_ID,
        summary: '米拉收到一封来自已故船长的信，潮汐表背面写着一个日期。',
        conflict: '她必须决定是否相信一封不可能寄出的信。',
        characterIds: [miraId],
        clueIds: [firstLetterId],
      },
      {
        id: 'scene-storm',
        title: '风暴前夜',
        order: 2,
        actId: DEFAULT_ACT_ID,
        summary: '裘恩抵达灯塔，带来一枚从沉船上找到的铜制罗盘。',
        conflict: '两人对罗盘的来历各执一词。',
        characterIds: [miraId, 'character-june'],
        clueIds: [],
      },
    ],
    clues: [
      {
        id: firstLetterId,
        title: '潮汐表背后的日期',
        setupSceneId: oldHarborId,
        payoffSceneId: '',
      },
    ],
    selectedSceneId: oldHarborId,
    updatedAt: new Date().toISOString(),
  };
}
