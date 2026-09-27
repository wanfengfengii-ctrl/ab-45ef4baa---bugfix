import { describe, expect, it } from 'vitest';
import { adjudicate } from './solver/adjudicate';
import { parseDraft, type Draft } from './draft';

/** 两条零力臂导轨 + 四块单位质量配重的草稿，代价由参数给出（原文）。 */
function draftOf(b1Costs: [string, string]): Draft {
  const zero: [string, string] = ['0', '0'];
  return {
    rails: [
      { id: 'Z1', name: '#1', coordinate: '0' },
      { id: 'Z2', name: '#2', coordinate: '0' },
    ],
    blocks: [
      { id: 'b1', name: 'b1', mass: '1', options: [{ railId: 'Z1', cost: b1Costs[0] }, { railId: 'Z2', cost: b1Costs[1] }] },
      { id: 'b2', name: 'b2', mass: '1', options: [{ railId: 'Z1', cost: zero[0] }, { railId: 'Z2', cost: zero[1] }] },
      { id: 'b3', name: 'b3', mass: '1', options: [{ railId: 'Z1', cost: '0' }, { railId: 'Z2', cost: '0' }] },
      { id: 'b4', name: 'b4', mass: '1', options: [{ railId: 'Z1', cost: '0' }, { railId: 'Z2', cost: '0' }] },
    ],
    maxLoad: '4',
    minTorque: '-1',
    maxTorque: '1',
  };
}

describe('parseDraft × adjudicate · 录入代价原文贯通', () => {
  it('极细小十进制差异经真实录入链路保留：0.10000000000000001 vs 0.1 选更便宜的 #2', () => {
    // 两个录入值在 Number() 后舍入为同一个双精度数，差异只能靠草稿原文保留。
    const parsed = parseDraft(draftOf(['0.10000000000000001', '0.1']));
    expect('scenario' in parsed).toBe(true);
    if ('errors' in parsed) throw new Error(parsed.errors.join('; '));
    // 解析出的场景必须携带原文，且 number 视图确实已不可区分
    expect(parsed.scenario.blocks[0].options[0].costText).toBe('0.10000000000000001');
    expect(parsed.scenario.blocks[0].options[0].cost).toBe(0.1);

    const outcome = adjudicate(parsed.scenario);
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    // 报告要求：返回 1,0,0,0，b1 选代价为 0.1 的位置 #2
    expect(outcome.plan.steps.map((s) => s.optionIndex)).toEqual([1, 0, 0, 0]);
    expect(outcome.plan.steps[0].railName).toBe('#2');
    expect(outcome.plan.totalCostText).toBe('0.1');
  });

  it('代价完全相等时稳定决胜：两块都录 0.1 仍取字典序最小的 #1（0,0,0,0）', () => {
    const parsed = parseDraft(draftOf(['0.1', '0.1']));
    if ('errors' in parsed) throw new Error(parsed.errors.join('; '));
    const outcome = adjudicate(parsed.scenario);
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    expect(outcome.plan.steps.map((s) => s.optionIndex)).toEqual([0, 0, 0, 0]);
    expect(outcome.plan.totalCostText).toBe('0.1');
  });
});

describe('parseDraft × adjudicate · 大力矩与单位力矩混合的逐步边界判定', () => {
  // 缺陷回归（真实录入链路）：8 条导轨力臂 1e16×2 / 1×2 / -1e16×2 / 0×2，
  // 4 块单位质量配重各自只能挂自己那对同力臂导轨，代价均为 0，区间 [0,1e16]。
  // 经 parseDraft 解析后边界与力臂必须按录入原文逐位判定，不得放行
  // A→B→C→D 第二步（真实力矩 10000000000000001），应返回 0,2,1,3。
  const T_TEXT = '10000000000000000';
  const draft: Draft = {
    rails: [
      { id: 'P1', name: '正T-1', coordinate: T_TEXT },
      { id: 'P2', name: '正T-2', coordinate: T_TEXT },
      { id: 'U1', name: '单位1-1', coordinate: '1' },
      { id: 'U2', name: '单位1-2', coordinate: '1' },
      { id: 'N1', name: '负T-1', coordinate: `-${T_TEXT}` },
      { id: 'N2', name: '负T-2', coordinate: `-${T_TEXT}` },
      { id: 'Z1', name: '零-1', coordinate: '0' },
      { id: 'Z2', name: '零-2', coordinate: '0' },
    ],
    blocks: [
      { id: 'A', name: 'A', mass: '1', options: [{ railId: 'P1', cost: '0' }, { railId: 'P2', cost: '0' }] },
      { id: 'B', name: 'B', mass: '1', options: [{ railId: 'U1', cost: '0' }, { railId: 'U2', cost: '0' }] },
      { id: 'C', name: 'C', mass: '1', options: [{ railId: 'N1', cost: '0' }, { railId: 'N2', cost: '0' }] },
      { id: 'D', name: 'D', mass: '1', options: [{ railId: 'Z1', cost: '0' }, { railId: 'Z2', cost: '0' }] },
    ],
    maxLoad: '4',
    minTorque: '0',
    maxTorque: T_TEXT,
  };

  it('录入链路逐位精确：拒绝不安全的 0,1,2,3，返回安全且字典序最小的 0,2,1,3', () => {
    const parsed = parseDraft(draft);
    expect('scenario' in parsed).toBe(true);
    if ('errors' in parsed) throw new Error(parsed.errors.join('; '));
    // 原文确实贯通到场景（边界判定据此逐位比较）
    expect(parsed.scenario.limits.maxTorqueText).toBe(T_TEXT);
    expect(parsed.scenario.rails[0].coordinateText).toBe(T_TEXT);
    expect(parsed.scenario.blocks[2].options[0].railId).toBe('N1');

    const outcome = adjudicate(parsed.scenario);
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    expect(outcome.plan.steps.map((s) => s.blockIndex)).toEqual([0, 2, 1, 3]);
    expect(outcome.plan.steps.map((s) => [s.blockIndex, s.railName])).toEqual([
      [0, '正T-1'],
      [2, '负T-1'],
      [1, '单位1-1'],
      [3, '零-1'],
    ]);
    expect(outcome.plan.steps.map((s) => s.cumulativeTorque)).toEqual([
      Number(T_TEXT),
      0,
      1,
      1,
    ]);
    expect(outcome.plan.totalCostText).toBe('0');
    expect(outcome.plan.finalMass).toBe(4);
  });
});
