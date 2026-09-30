import type { StoryCharacter, StoryScene } from '../models/story';
import { getScenePlacement } from '../models/storyRules';
import type { StoryViewModel } from '../viewmodels/storyViewModel';

interface SceneInspectorProps { viewModel: StoryViewModel; scene: StoryScene | null; characters: StoryCharacter[]; }

export function SceneInspector({ viewModel, scene, characters }: SceneInspectorProps) {
  if (!scene) return <section className="panel inspector empty-inspector"><span className="eyebrow">INSPECTOR</span><h2>选择一个场景</h2><p>从时间线中选择一幕，开始补充人物、冲突和节奏。</p></section>;
  const story = viewModel.snapshot.story;
  const placement = story ? getScenePlacement(story, scene.id) : null;
  const acts = story ? [...story.acts].sort((a, b) => a.order - b.order) : [];
  const currentAct = acts.find((act) => act.id === scene.actId);
  // 上移/下移落在幕内还是跨过幕边界：幕首上移、幕尾下移才会跨幕
  const upCrosses = placement ? placement.orderInAct === 1 && placement.globalIndex > 0 : false;
  const downCrosses = placement
    ? placement.orderInAct === placement.actSceneCount && placement.globalIndex < placement.totalScenes - 1
    : false;
  return (
    <section className="panel inspector">
      <div className="inspector-top"><div><span className="eyebrow">SCENE / 场景详情{placement ? ` · ${currentAct?.title ?? '未分幕'} 第 ${placement.orderInAct} 场` : ''}</span><h2>{scene.title}</h2></div><span className="edit-state">编辑中</span></div>
      <label>场景标题<input value={scene.title} onChange={(event) => viewModel.updateScene(scene.id, { title: event.target.value })} /></label>
      <label>这一幕发生了什么<textarea value={scene.summary} onChange={(event) => viewModel.updateScene(scene.id, { summary: event.target.value })} rows={3} /></label>
      <label>核心冲突<textarea value={scene.conflict} onChange={(event) => viewModel.updateScene(scene.id, { conflict: event.target.value })} rows={2} placeholder="是什么让人物无法轻易得到想要的东西？" /></label>
      <label className="act-field">所属幕（跨幕移动后幕内编号自动收敛）
        <select value={scene.actId} onChange={(event) => viewModel.moveSceneToAct(scene.id, event.target.value)}>
          {acts.map((act, index) => <option key={act.id} value={act.id}>第 {index + 1} 幕 · {act.title}</option>)}
        </select>
      </label>
      <div className="field-block"><span className="field-label">出场人物</span><div className="person-toggles">{characters.map((character) => <button key={character.id} className={scene.characterIds.includes(character.id) ? `person-toggle selected ${character.color}` : 'person-toggle'} onClick={() => viewModel.toggleCharacter(scene.id, character.id)}><span>{character.name.slice(0, 1)}</span>{character.name}</button>)}</div></div>
      <div className="order-controls"><span>时间线顺序{placement ? `（第 ${placement.actIndex + 1} 幕 ${placement.orderInAct}/${placement.actSceneCount}）` : ''}</span><button disabled={!placement || placement.globalIndex <= 0} onClick={() => viewModel.moveScene(scene.id, 'up')}>↑ 上移{upCrosses ? '（跨幕）' : ''}</button><button disabled={!placement || placement.globalIndex >= placement.totalScenes - 1} onClick={() => viewModel.moveScene(scene.id, 'down')}>{downCrosses ? '下移（跨幕）' : '下移'} ↓</button></div>
    </section>
  );
}
