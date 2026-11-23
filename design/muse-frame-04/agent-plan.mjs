import {addShot, createShoot} from './model.mjs';

export const maxPlanBytes = 64 * 1024;

export function readAgentPlan(text) {
  const fail = () => { throw Error('计划格式无效，请按示例填写名称和 1 至 12 个镜头。'); };
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > maxPlanBytes) fail();
  let plan;
  const input = text.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]+?)\r?\n```$/i.exec(input);
  try { plan = JSON.parse(fenced ? fenced[1] : input); }
  catch { throw Error('请粘贴一份完整的 JSON 计划，或选择 Agent 导出的文件。'); }
  function field(value, limit, required = true) {
    if (!required && value === undefined) return '';
    if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) fail();
    return value.trim();
  }
  if (plan?.format !== 'muse-frame.plan/v1' || !Array.isArray(plan.shots) ||
      plan.shots.length < 1 || plan.shots.length > 12) fail();
  return {
    title: field(plan.title, 100),
    brief: field(plan.brief, 1500, false),
    shots: plan.shots.map(shot => ({
      title: field(shot?.title, 100),
      direction: field(shot?.direction, 1000),
    })),
  };
}

export function createPlannedShoot(state, plan) {
  const shoot = createShoot(state, {free: true, independent: true, title: plan.title});
  shoot.titleEdited = true;
  shoot.referenceMode = 'photo';
  shoot.supplement = plan.brief;
  for (const [index, planned] of plan.shots.entries()) {
    const shot = index ? addShot(shoot) : shoot.shots[0];
    Object.assign(shot, {title: planned.title, titleEdited: true, note: planned.direction, manual: true});
  }
  return shoot;
}
