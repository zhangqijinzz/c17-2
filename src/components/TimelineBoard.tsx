import { useState } from 'react';
import type { ActGroup } from '../models/storyRules';
import type { StoryViewModel } from '../viewmodels/storyViewModel';

type TimelineGroup = ActGroup & { actIndex: number; totalActs: number };

interface TimelineBoardProps { viewModel: StoryViewModel; groups: TimelineGroup[]; }

export function TimelineBoard({ viewModel, groups }: TimelineBoardProps) {
  const story = viewModel.snapshot.story;
  const [addingAct, setAddingAct] = useState(false);
  const [newActName, setNewActName] = useState('');

  const submitAct = () => {
    viewModel.addAct(newActName);
    setNewActName('');
    setAddingAct(false);
  };

  return (
    <section className="panel timeline-panel">
      <div className="panel-heading timeline-heading">
        <div><span className="eyebrow">ACTS &amp; SEQUENCE / 幕 × 时间结构</span><h2>故事时间线</h2></div>
        <div className="timeline-actions">
          <span className="hint">幕与场景两层分别排序 · 点击场景编辑</span>
          <button className="secondary-button" onClick={() => setAddingAct((value) => !value)}>＋ 新建幕</button>
        </div>
      </div>
      {viewModel.timelineWarning && <div className="warning-banner">△ {viewModel.timelineWarning}</div>}
      {addingAct && (
        <div className="create-act-row">
          <input aria-label="幕名称" autoFocus value={newActName} onChange={(event) => setNewActName(event.target.value)} placeholder="给这一幕起个名字，例如：第三幕 · 真相" onKeyDown={(event) => { if (event.key === 'Enter') submitAct(); if (event.key === 'Escape') setAddingAct(false); }} />
          <button onClick={submitAct}>添加幕</button>
          <button className="secondary-button" onClick={() => setAddingAct(false)}>取消</button>
        </div>
      )}
      <div className="timeline-rail">
        {groups.map((group) => <ActBlock key={group.act.id} viewModel={viewModel} group={group} />)}
        {groups.length === 0 && <div className="empty-state">{story?.scenes.length ? '没有场景匹配当前搜索。' : '还没有幕。新建第一幕，把故事分出起承转合。'}</div>}
      </div>
    </section>
  );
}

interface ActBlockProps {
  viewModel: StoryViewModel;
  group: TimelineGroup;
}

function ActBlock({ viewModel, group }: ActBlockProps) {
  const story = viewModel.snapshot.story;
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(group.act.name);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');

  const saveName = () => {
    viewModel.renameAct(group.act.id, draftName);
    setEditingName(false);
  };
  const cancelName = () => {
    setDraftName(group.act.name);
    setEditingName(false);
  };
  const submitScene = () => { viewModel.addScene(title, summary, group.act.id); setTitle(''); setSummary(''); };

  return (
    <div className="act-block">
      <div className="act-heading">
        <span className="act-number">ACT {String(group.actIndex + 1).padStart(2, '0')}</span>
        {editingName ? (
          <input className="act-name-input" aria-label="幕名称" autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} onBlur={saveName} onKeyDown={(event) => { if (event.key === 'Enter') saveName(); if (event.key === 'Escape') cancelName(); }} />
        ) : (
          <button className="act-name" title="点击重命名" onClick={() => { setDraftName(group.act.name); setEditingName(true); }}>{group.act.name} <i>✎</i></button>
        )}
        <span className="act-scene-count">{group.scenes.length} 个场景</span>
        <div className="act-order-controls">
          <button title="整幕上移" disabled={group.actIndex <= 0} onClick={() => viewModel.moveAct(group.act.id, 'up')}>↑ 幕上移</button>
          <button title="整幕下移" disabled={group.actIndex >= group.totalActs - 1} onClick={() => viewModel.moveAct(group.act.id, 'down')}>幕下移 ↓</button>
        </div>
      </div>
      <div className="act-scenes">
        {group.scenes.map((scene, sceneIndex) => {
          const placement = viewModel.placementOf(scene.id);
          const globalNumber = (placement?.globalIndex ?? 0) + 1;
          const selected = story?.selectedSceneId === scene.id;
          const characterCount = story?.characters.filter((character) => scene.characterIds.includes(character.id)).length ?? 0;
          return (
            <button className={selected ? 'scene-node selected' : 'scene-node'} key={scene.id} onClick={() => viewModel.selectScene(scene.id)}>
              <span className="scene-index">{String(globalNumber).padStart(2, '0')}</span>
              <span className="scene-line" />
              <span className="scene-dot" />
              <div className="scene-copy">
                <span className="scene-meta">SCENE {group.actIndex + 1}-{sceneIndex + 1} · 全局第 {globalNumber} 场 · {characterCount} 位人物</span>
                <strong>{scene.title}</strong>
                <span>{scene.summary}</span>
                <div className="scene-tags">{scene.conflict && <em>冲突</em>}{scene.clueIds.length > 0 && <em className="clue-tag">伏笔 {scene.clueIds.length}</em>}</div>
              </div>
            </button>
          );
        })}
        {group.scenes.length === 0 && <div className="empty-inline">这一幕还没有场景，在下方写下第一场。</div>}
      </div>
      <div className="create-scene-row">
        <input aria-label={`${group.act.name} - 场景标题`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`在「${group.act.name}」新建场景标题`} />
        <input aria-label={`${group.act.name} - 场景摘要`} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="一句话写下这一场发生了什么" />
        <button onClick={submitScene}>加入本幕</button>
      </div>
    </div>
  );
}
