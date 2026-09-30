import { useState } from 'react';
import type { StoryScene } from '../models/story';
import type { StoryViewModel } from '../viewmodels/storyViewModel';

interface TimelineBoardProps { viewModel: StoryViewModel; }

export function TimelineBoard({ viewModel }: TimelineBoardProps) {
  const story = viewModel.snapshot.story;
  const groups = viewModel.groupedVisibleScenes;
  const acts = story ? [...story.acts].sort((a, b) => a.order - b.order) : [];
  const selectedActId = story?.scenes.find((scene) => scene.id === story.selectedSceneId)?.actId;
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [targetActId, setTargetActId] = useState('');
  const [newActTitle, setNewActTitle] = useState('');
  const [showNewAct, setShowNewAct] = useState(false);
  const submit = () => {
    const actId = targetActId || selectedActId || acts[0]?.id;
    viewModel.addScene(title, summary, actId);
    setTitle('');
    setSummary('');
  };
  const submitAct = () => {
    viewModel.addAct(newActTitle);
    setNewActTitle('');
    setShowNewAct(false);
  };
  return (
    <section className="panel timeline-panel">
      <div className="panel-heading timeline-heading"><div><span className="eyebrow">SEQUENCE / 时间结构</span><h2>故事时间线</h2></div><div className="timeline-actions"><span className="hint">按幕分组 · 点击编辑详情</span><button className="secondary-button" onClick={() => setShowNewAct((value) => !value)}>＋ 新建幕</button><button className="secondary-button" onClick={submit}>＋ 新建场景</button></div></div>
      {showNewAct && (
        <div className="create-act-row">
          <input aria-label="幕名称" value={newActTitle} onChange={(event) => setNewActTitle(event.target.value)} placeholder="幕名称，例如：第三幕 · 转折（留空自动命名）" />
          <button onClick={submitAct}>新增整幕</button>
          <button className="secondary-button" onClick={() => setShowNewAct(false)}>取消</button>
        </div>
      )}
      {viewModel.timelineWarning && <div className="warning-banner">△ {viewModel.timelineWarning}</div>}
      <div className="act-stack">
        {groups.map((group, actIndex) => (
          <section className={'act-block' + (group.scenes.length === 0 ? ' act-block-empty' : '')} key={group.act.id}>
            <header className="act-header">
              <span className="act-glyph">ACT {String(actIndex + 1).padStart(2, '0')}</span>
              <input
                className="act-title-input"
                aria-label={`第 ${actIndex + 1} 幕名称`}
                value={group.act.title}
                onChange={(event) => viewModel.renameAct(group.act.id, event.target.value)}
              />
              <span className="act-count">{group.scenes.length} 个场景</span>
              <div className="act-order-controls">
                <button disabled={actIndex === 0} onClick={() => viewModel.moveAct(group.act.id, 'up')} aria-label={`「${group.act.title}」整幕上移`}>↑ 整幕上移</button>
                <button disabled={actIndex >= groups.length - 1} onClick={() => viewModel.moveAct(group.act.id, 'down')} aria-label={`「${group.act.title}」整幕下移`}>整幕下移 ↓</button>
              </div>
            </header>
            <div className="timeline-rail">
              {group.scenes.map((scene: StoryScene, index) => {
                const selected = story?.selectedSceneId === scene.id;
                const characterCount = story?.characters.filter((character) => scene.characterIds.includes(character.id)).length ?? 0;
                const sceneNo = String(index + 1).padStart(2, '0');
                return <button className={selected ? 'scene-node selected' : 'scene-node'} key={scene.id} onClick={() => viewModel.selectScene(scene.id)}><span className="scene-index">{sceneNo}</span><span className="scene-line" /><span className="scene-dot" /><div className="scene-copy"><span className="scene-meta">{group.act.title} · 场内 {sceneNo} · {characterCount} 位人物</span><strong>{scene.title}</strong><span>{scene.summary}</span><div className="scene-tags">{scene.conflict && <em>冲突</em>}{scene.clueIds.length > 0 && <em className="clue-tag">伏笔 {scene.clueIds.length}</em>}</div></div></button>;
              })}
              {group.scenes.length === 0 && <div className="empty-state act-empty-state">这一幕还没有场景，在下方选择「{group.act.title}」后新建。</div>}
            </div>
          </section>
        ))}
        {groups.length === 0 && <div className="empty-state">没有匹配的场景。</div>}
      </div>
      <div className="create-scene-row">
        <select aria-label="新场景所属幕" value={targetActId || selectedActId || acts[0]?.id || ''} onChange={(event) => setTargetActId(event.target.value)}>
          {acts.map((act, index) => <option key={act.id} value={act.id}>第 {index + 1} 幕 · {act.title}</option>)}
        </select>
        <input aria-label="场景标题" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="新场景标题，例如：灯塔停电" />
        <input aria-label="场景摘要" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="一句话写下这一幕发生了什么" />
        <button onClick={submit}>添加到时间线</button>
      </div>
    </section>
  );
}
