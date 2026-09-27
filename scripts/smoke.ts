/**
 * 一次性冒烟脚本（verify 服务）：
 *  1. 对裁决业务模块跑确定性用例（可行 / 不可行）；
 *  2. 探测已启动页面的健康端点 /healthz；
 *  3. 探测首页可访问。
 * 全部通过以退出码 0 结束，否则退出码 1。
 */
import { adjudicate } from '../src/solver/adjudicate';
import type { Scenario } from '../src/solver/types';

const base = `http://${process.env.WEB_HOST ?? 'web'}:${process.env.WEB_PORT ?? '8080'}`;

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

// ---------- 1. 裁决业务模块冒烟 ----------

// 可行场景：余量 5 的方案中 b1@M2 + b2@M1 总代价 8 最小，次序按录入序号决胜。
const feasibleScenario: Scenario = {
  rails: [
    { id: 'L', name: 'L', coordinate: -2 },
    { id: 'M1', name: 'M1', coordinate: 0 },
    { id: 'M2', name: 'M2', coordinate: 0 },
    { id: 'R', name: 'R', coordinate: 2 },
  ],
  blocks: [
    { id: 'b1', name: 'b1', mass: 2, options: [{ railId: 'M1', cost: 8 }, { railId: 'M2', cost: 3 }, { railId: 'R', cost: 1 }] },
    { id: 'b2', name: 'b2', mass: 2, options: [{ railId: 'M1', cost: 5 }, { railId: 'M2', cost: 6 }, { railId: 'L', cost: 1 }] },
  ],
  limits: { maxLoad: 100, minTorque: -5, maxTorque: 5 },
};

const r1 = adjudicate(feasibleScenario);
check(r1.feasible, '裁决模块：可行场景应判定为可行');
if (r1.feasible) {
  check(r1.plan.steps.length === 2, '裁决模块：方案应覆盖全部配重（每块恰用一次）');
  check(
    r1.plan.steps.every((s) => Math.abs(s.cumulativeTorque) <= 5 + 1e-9 && s.cumulativeMass <= 100 + 1e-9),
    '裁决模块：每个前缀状态均满足载荷与力矩限制',
  );
  check(r1.plan.totalCostText === '8', `裁决模块：总安装代价应为 8（实际 ${r1.plan.totalCostText}）`);
  check(Math.abs(r1.plan.minTorqueMargin - 5) < 1e-9, `裁决模块：力矩余量应为 5（实际 ${r1.plan.minTorqueMargin}）`);
  check(
    r1.plan.steps[0].railId === 'M2' && r1.plan.steps[1].railId === 'M1',
    '裁决模块：挂装位置与次序应符合决胜规则（b1@M2 → b2@M1）',
  );
}

// 纳米级代价差场景：#1 代价 1e-10、#2 代价 0；力矩余量全同，
// 严格最低总代价为 0，四块均须采用位置录入序号 #2（optionIndex 1）。
const nanoCostScenario: Scenario = {
  rails: [
    { id: 'Z1', name: 'Z1', coordinate: 0 },
    { id: 'Z2', name: 'Z2', coordinate: 0 },
  ],
  blocks: [1, 2, 3, 4].map((k) => ({
    id: `b${k}`,
    name: `b${k}`,
    mass: 1,
    options: [
      { railId: 'Z1', cost: 1e-10 },
      { railId: 'Z2', cost: 0 },
    ],
  })),
  limits: { maxLoad: 4, minTorque: -1, maxTorque: 1 },
};

const r0 = adjudicate(nanoCostScenario);
check(r0.feasible, '裁决模块：纳米代价场景应判定为可行');
if (r0.feasible) {
  const p = r0.plan;
  check(p.steps.length === 4, '纳米代价：完整方案应覆盖四块配重');
  check(
    p.steps.every((s) => s.optionIndex === 1 && s.railId === 'Z2'),
    '纳米代价：四块均须采用零代价的位置 #2（Z2）',
  );
  check(p.totalCostText === '0', `纳米代价：总代价须严格为 0（实际 ${p.totalCostText}）`);
}

// 十进制等价成本场景：b1@P+b2@N（0.1+0.2）与 b1@N+b2@P（0.3+0）按录入的
// 十进制值总代价都是 0.3、力矩余量相同，须判为同成本并按序号决胜返回
// 0,0,0,0（二进制浮点下 0.1+0.2 ≠ 0.3，旧实现会误选 1,1,0,0）。
const decimalTieScenario: Scenario = {
  rails: [
    { id: 'P', name: 'P', coordinate: 1 },
    { id: 'N', name: 'N', coordinate: -1 },
    { id: 'Z1', name: 'Z1', coordinate: 0 },
    { id: 'Z2', name: 'Z2', coordinate: 0 },
  ],
  blocks: [
    { id: 'b1', name: 'b1', mass: 1, options: [{ railId: 'P', cost: 0.1 }, { railId: 'N', cost: 0.3 }] },
    { id: 'b2', name: 'b2', mass: 1, options: [{ railId: 'N', cost: 0.2 }, { railId: 'P', cost: 0 }] },
    { id: 'b3', name: 'b3', mass: 1, options: [{ railId: 'Z1', cost: 0 }, { railId: 'Z2', cost: 0 }] },
    { id: 'b4', name: 'b4', mass: 1, options: [{ railId: 'Z1', cost: 0 }, { railId: 'Z2', cost: 0 }] },
  ],
  limits: { maxLoad: 4, minTorque: -1, maxTorque: 1 },
};

const r3 = adjudicate(decimalTieScenario);
check(r3.feasible, '裁决模块：十进制等价成本场景应判定为可行');
if (r3.feasible) {
  const p = r3.plan;
  check(p.totalCostText === '0.3', `十进制等价：总代价应为 0.3（实际 ${p.totalCostText}）`);
  check(
    p.steps.map((s) => s.optionIndex).join(',') === '0,0,0,0',
    `十进制等价：同成本应按序号决胜返回 0,0,0,0（实际 ${p.steps.map((s) => s.optionIndex).join(',')}）`,
  );
  check(
    p.steps.map((s) => `${s.blockIndex}@${s.railId}`).join(' ') === '0@P 1@N 2@Z1 3@Z1',
    '十进制等价：挂装位置与次序应为 b1@P → b2@N → b3@Z1 → b4@Z1',
  );
  check(
    p.steps.every((s) => s.cumulativeMass <= 4 + 1e-9 && Math.abs(s.cumulativeTorque) <= 1 + 1e-9),
    '十进制等价：每个前缀状态均满足载荷与力矩限制',
  );
  check(p.finalMass === 4, '十进制等价：最终载荷应恰为上限 4（载荷边界）');
  check(p.steps[0].cumulativeTorque === 1, '十进制等价：首步力矩应恰为区间边界 +1（力矩边界）');
}

// 真实不等成本对照：b2@P 代价 1e-10 使 b1@N+b2@P 总代价 0.3000000001 严格更贵，
// 仍须选 0,0,0,0（总代价 0.3），极小十进制差额不得被当作并列。
const unequalCostScenario: Scenario = {
  ...decimalTieScenario,
  blocks: decimalTieScenario.blocks.map((b) =>
    b.id === 'b2' ? { ...b, options: [{ railId: 'N', cost: 0.2 }, { railId: 'P', cost: 1e-10 }] } : b,
  ),
};

const r4 = adjudicate(unequalCostScenario);
check(r4.feasible, '裁决模块：真实不等成本场景应判定为可行');
if (r4.feasible) {
  check(r4.plan.totalCostText === '0.3', `真实不等成本：总代价应为 0.3（实际 ${r4.plan.totalCostText}）`);
  check(
    r4.plan.steps.map((s) => s.optionIndex).join(',') === '0,0,0,0',
    `真实不等成本：仍须选 0,0,0,0（实际 ${r4.plan.steps.map((s) => s.optionIndex).join(',')}）`,
  );
}

// 超双精度精度的极细小十进制差额：b1 位置 #1 录入 0.10000000000000001、位置 #2
// 录入 0.1，其余三块两个位置代价均为 0。两者经 Number() 舍入为同一个双精度数
// （Number('0.10000000000000001') === 0.1），必须凭录入原文严格区分：b1 选 #2，
// 返回位置序号 1,0,0,0；真同代价时序号决胜才取 0,0,0,0。
const ultraFineScenario: Scenario = {
  rails: [
    { id: 'Z1', name: 'Z1', coordinate: 0 },
    { id: 'Z2', name: 'Z2', coordinate: 0 },
  ],
  blocks: [
    {
      id: 'b1',
      name: 'b1',
      mass: 1,
      options: [
        { railId: 'Z1', cost: 0.10000000000000001, costText: '0.10000000000000001' },
        { railId: 'Z2', cost: 0.1, costText: '0.1' },
      ],
    },
    { id: 'b2', name: 'b2', mass: 1, options: [{ railId: 'Z1', cost: 0 }, { railId: 'Z2', cost: 0 }] },
    { id: 'b3', name: 'b3', mass: 1, options: [{ railId: 'Z1', cost: 0 }, { railId: 'Z2', cost: 0 }] },
    { id: 'b4', name: 'b4', mass: 1, options: [{ railId: 'Z1', cost: 0 }, { railId: 'Z2', cost: 0 }] },
  ],
  limits: { maxLoad: 4, minTorque: -1, maxTorque: 1 },
};

const r5 = adjudicate(ultraFineScenario);
check(r5.feasible, '裁决模块：极细小十进制差额场景应判定为可行');
if (r5.feasible) {
  const p = r5.plan;
  check(p.steps.length === 4, '极细小差额：完整方案应覆盖四块配重');
  check(
    p.steps.map((s) => s.optionIndex).join(',') === '1,0,0,0',
    `极细小差额：b1 须选代价 0.1 的位置 #2，返回 1,0,0,0（实际 ${p.steps.map((s) => s.optionIndex).join(',')}）`,
  );
  check(p.steps[0].railId === 'Z2', '极细小差额：首块 b1 应挂在 Z2');
  check(p.totalCostText === '0.1', `极细小差额：总代价应为 0.1（实际 ${p.totalCostText}）`);
  check(p.finalMass === 4, '极细小差额：最终载荷应恰为上限 4（载荷边界）');
  check(
    p.steps.every((s) => s.cumulativeTorque === 0 && s.cumulativeMass <= 4),
    '极细小差额：每个前缀满足载荷与力矩限制（零力臂力矩恒为 0，落在 [-1,1]）',
  );
}

// 极细小差额的并列对照：b1 两个位置都录入 0.1（真正相等），序号决胜应取 #1。
const ultraFineTieScenario: Scenario = {
  ...ultraFineScenario,
  blocks: ultraFineScenario.blocks.map((b) =>
    b.id === 'b1'
      ? { ...b, options: [{ railId: 'Z1', cost: 0.1, costText: '0.1' }, { railId: 'Z2', cost: 0.1, costText: '0.1' }] }
      : b,
  ),
};
const r6 = adjudicate(ultraFineTieScenario);
check(r6.feasible, '裁决模块：极细小差额的并列对照场景应判定为可行');
if (r6.feasible) {
  check(
    r6.plan.steps.map((s) => s.optionIndex).join(',') === '0,0,0,0',
    `极细小差额并列：真同代价应按序号决胜返回 0,0,0,0（实际 ${r6.plan.steps.map((s) => s.optionIndex).join(',')}）`,
  );
}

// 亚纳米级力矩余量差场景：b1 可选 R（力臂 1，代价 0）或 S（力臂 0.9999999995，
// 代价 1），b2~b4 各有两条力臂 0、代价 0 的导轨。选 S 的首步余量 1-0.9999999995
// ≈ 5e-10 严格大于选 R 的 0；余量差真实存在即优先于成本，须返回 1,0,0,0
// （旧实现以 EPS=1e-9 抹平该余量差，按成本错选 0,0,0,0）。
const nanoMarginScenario: Scenario = {
  rails: [
    { id: 'R', name: 'R', coordinate: 1 },
    { id: 'S', name: 'S', coordinate: 0.9999999995 },
    { id: 'Z1', name: 'Z1', coordinate: 0 },
    { id: 'Z2', name: 'Z2', coordinate: 0 },
  ],
  blocks: [
    { id: 'b1', name: 'b1', mass: 1, options: [{ railId: 'R', cost: 0 }, { railId: 'S', cost: 1 }] },
    { id: 'b2', name: 'b2', mass: 1, options: [{ railId: 'Z1', cost: 0 }, { railId: 'Z2', cost: 0 }] },
    { id: 'b3', name: 'b3', mass: 1, options: [{ railId: 'Z1', cost: 0 }, { railId: 'Z2', cost: 0 }] },
    { id: 'b4', name: 'b4', mass: 1, options: [{ railId: 'Z1', cost: 0 }, { railId: 'Z2', cost: 0 }] },
  ],
  limits: { maxLoad: 4, minTorque: -1, maxTorque: 1 },
};

const r7 = adjudicate(nanoMarginScenario);
check(r7.feasible, '裁决模块：亚纳米余量差场景应判定为可行');
if (r7.feasible) {
  const p = r7.plan;
  check(p.steps.length === 4, '亚纳米余量：完整方案应覆盖四块配重');
  check(
    p.steps.map((s) => s.optionIndex).join(',') === '1,0,0,0',
    `亚纳米余量：b1 须选余量更大的 S，返回 1,0,0,0（实际 ${p.steps.map((s) => s.optionIndex).join(',')}）`,
  );
  check(p.steps[0].railId === 'S', '亚纳米余量：首块 b1 应挂在 S');
  check(
    p.minTorqueMargin === 1 - 0.9999999995 && p.minTorqueMargin > 0,
    `亚纳米余量：最小力矩余量应为 1-0.9999999995 ≈ 5e-10（实际 ${p.minTorqueMargin}）`,
  );
  check(p.totalCostText === '1', `亚纳米余量：总代价应为 1（实际 ${p.totalCostText}）`);
  check(p.finalMass === 4, '亚纳米余量：最终载荷应恰为上限 4（载荷边界）');
  check(
    p.steps.every((s) => s.cumulativeMass <= 4 && Math.abs(s.cumulativeTorque) <= 1),
    '亚纳米余量：每个前缀状态均满足载荷与力矩限制',
  );
}

// 余量真正相等的对照：S 的力臂也是 1（与 R 的余量均为 0，真正相等），
// 成本决胜才应选代价 0 的 R，返回 0,0,0,0。
const trueMarginTieScenario: Scenario = {
  ...nanoMarginScenario,
  rails: nanoMarginScenario.rails.map((r) => (r.id === 'S' ? { ...r, coordinate: 1 } : r)),
};
const r8 = adjudicate(trueMarginTieScenario);
check(r8.feasible, '裁决模块：余量真相等对照场景应判定为可行');
if (r8.feasible) {
  check(
    r8.plan.steps.map((s) => s.optionIndex).join(',') === '0,0,0,0' && r8.plan.totalCostText === '0',
    `余量真相等：应按成本决胜返回 0,0,0,0、代价 0（实际 ${r8.plan.steps.map((s) => s.optionIndex).join(',')}，代价 ${r8.plan.totalCostText}）`,
  );
}

// 大额有限代价场景：两块零力臂导轨，四块单位质量配重，每个位置代价都录入
// 有限十进制值 1e308；载荷上限 4、力矩区间 [-1,1]，完整挂装方案可行。
// 单项 1e308 仍是有限双精度，但精确总和 4e308 超出双精度范围
// （Number('4e308') === Infinity），总代价必须以精确十进制文本保留为
// "4" + 308 个 0，不得显示为 Infinity 或缺失；真同代价时序号决胜仍取 #1。
const hugeCostScenario: Scenario = {
  rails: [
    { id: 'Z1', name: 'Z1', coordinate: 0 },
    { id: 'Z2', name: 'Z2', coordinate: 0 },
  ],
  blocks: [1, 2, 3, 4].map((k) => ({
    id: `b${k}`,
    name: `b${k}`,
    mass: 1,
    options: [
      { railId: 'Z1', cost: 1e308, costText: '1e308' },
      { railId: 'Z2', cost: 1e308, costText: '1e308' },
    ],
  })),
  limits: { maxLoad: 4, minTorque: -1, maxTorque: 1 },
};

const r9 = adjudicate(hugeCostScenario);
check(r9.feasible, '裁决模块：大额代价场景应判定为可行');
if (r9.feasible) {
  const p = r9.plan;
  check(p.steps.length === 4, '大额代价：完整方案应覆盖四块配重');
  check(
    p.totalCostText === '4' + '0'.repeat(308),
    `大额代价：总代价应为精确有限的 4e308（4 后 308 个 0；实际 ${p.totalCostText.slice(0, 12)}…，长度 ${p.totalCostText.length}）`,
  );
  check(!p.totalCostText.includes('Infinity'), '大额代价：总代价不得为 Infinity');
  check(
    p.steps.map((s) => s.optionIndex).join(',') === '0,0,0,0',
    `大额代价：真同代价应按序号决胜返回 0,0,0,0（实际 ${p.steps.map((s) => s.optionIndex).join(',')}）`,
  );
  check(
    p.steps.every((s) => s.costText === '1' + '0'.repeat(308)),
    '大额代价：每步代价也应逐位精确展示为 1e308',
  );
  check(p.finalMass === 4 && p.minTorqueMargin === 1, '大额代价：可行性与力矩余量不受影响');
}

// 大力矩与单位力矩混合场景（本次缺陷回归）：8 条导轨力臂为
// 10000000000000000×2 / 1×2 / -10000000000000000×2 / 0×2；4 块单位质量配重
// 各自只能挂自己那对同力臂导轨，代价均为 0；载荷上限 4，力矩闭区间
// [0, 10000000000000000]。双精度下 T+1 === T（ULP ≈ 2），旧实现叠加固定
// EPS=1e-9 把 A→B→C→D 第二步的真实累计力矩 T+1 当作恰在边界放行；修复后
// 必须拒绝该步，返回仍可行且字典序最小的安全顺序 0,2,1,3（A→C→B→D），
// 各步精确累计力矩为 T、0、1、1，均落在闭区间内。
const T_MIXED = 10000000000000000;
const mixedTorqueScenario: Scenario = {
  rails: [
    { id: 'P1', name: '正T-1', coordinate: T_MIXED },
    { id: 'P2', name: '正T-2', coordinate: T_MIXED },
    { id: 'U1', name: '单位1-1', coordinate: 1 },
    { id: 'U2', name: '单位1-2', coordinate: 1 },
    { id: 'N1', name: '负T-1', coordinate: -T_MIXED },
    { id: 'N2', name: '负T-2', coordinate: -T_MIXED },
    { id: 'Z1', name: '零-1', coordinate: 0 },
    { id: 'Z2', name: '零-2', coordinate: 0 },
  ],
  blocks: [
    { id: 'A', name: 'A', mass: 1, options: [{ railId: 'P1', cost: 0 }, { railId: 'P2', cost: 0 }] },
    { id: 'B', name: 'B', mass: 1, options: [{ railId: 'U1', cost: 0 }, { railId: 'U2', cost: 0 }] },
    { id: 'C', name: 'C', mass: 1, options: [{ railId: 'N1', cost: 0 }, { railId: 'N2', cost: 0 }] },
    { id: 'D', name: 'D', mass: 1, options: [{ railId: 'Z1', cost: 0 }, { railId: 'Z2', cost: 0 }] },
  ],
  limits: { maxLoad: 4, minTorque: 0, maxTorque: T_MIXED },
};

const r10 = adjudicate(mixedTorqueScenario);
check(r10.feasible, '裁决模块：大力矩/单位力矩混合场景应判定为可行');
if (r10.feasible) {
  const p = r10.plan;
  check(p.steps.length === 4, '大力矩混合：完整方案应覆盖四块配重');
  check(
    p.steps.map((s) => s.blockIndex).join(',') === '0,2,1,3',
    `大力矩混合：不得放行不安全的 0,1,2,3，应返回安全且字典序最小的 0,2,1,3（实际 ${p.steps
      .map((s) => s.blockIndex)
      .join(',')}）`,
  );
  check(
    p.steps.map((s) => s.cumulativeTorque).join(',') === `${T_MIXED},0,1,1`,
    `大力矩混合：各步累计力矩应为 T,0,1,1（实际 ${p.steps.map((s) => s.cumulativeTorque).join(',')}）`,
  );
  check(
    p.steps.every((s) => s.cumulativeMass <= 4 && s.cumulativeTorque >= 0 && s.cumulativeTorque <= T_MIXED),
    '大力矩混合：每个前缀状态均落在载荷与力矩闭区间内',
  );
  check(p.steps[0].cumulativeTorque === T_MIXED, '大力矩混合：第一步力矩恰为上限（闭区间接纳等号）');
  check(p.totalCostText === '0' && p.finalMass === 4, '大力矩混合：总代价 0、最终载荷恰为上限 4');
}

// 不可行场景：深度 1 即止步，最深前缀为 b1@R（余量最大），剩余选择同时触发载荷与力矩限制。
const infeasibleScenario: Scenario = {
  rails: [{ id: 'R', name: 'R', coordinate: 1 }],
  blocks: [
    { id: 'b1', name: 'b1', mass: 3, options: [{ railId: 'R', cost: 1 }] },
    { id: 'b2', name: 'b2', mass: 4, options: [{ railId: 'R', cost: 1 }] },
    { id: 'b3', name: 'b3', mass: 5, options: [{ railId: 'R', cost: 1 }] },
  ],
  limits: { maxLoad: 6, minTorque: -5, maxTorque: 5 },
};

const r2 = adjudicate(infeasibleScenario);
check(!r2.feasible, '裁决模块：不可行场景应判定为不可行');
if (!r2.feasible) {
  check(r2.report.witnessPrefix.length === 1, '裁决模块：应给出最深可行已选前缀（长度 1）');
  check(
    r2.report.witnessPrefix[0]?.blockIndex === 0,
    '裁决模块：已选前缀应取余量最大的 b1',
  );
  check(
    r2.report.violations.length === 2 &&
      r2.report.violations.every((v) => v.kinds.includes('load') && v.kinds.includes('torque-high')),
    '裁决模块：应列出剩余选择触发的载荷/力矩限制',
  );
}

// ---------- 2. 已启动页面健康端点冒烟 ----------

const deadline = Date.now() + 60_000;
let health: { status?: string } | null = null;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`${base}/healthz`);
    if (res.ok) {
      health = (await res.json()) as { status?: string };
      break;
    }
  } catch {
    // 页面尚未就绪，继续等待
  }
  await new Promise((r) => setTimeout(r, 1000));
}
check(health !== null && health.status === 'ok', `健康端点 ${base}/healthz 应返回 status=ok`);

// ---------- 3. 首页可访问 ----------

try {
  const res = await fetch(`${base}/`);
  const html = await res.text();
  check(res.ok && html.includes('id="root"'), `首页 ${base}/ 应返回包含挂载点的 HTML`);
} catch {
  check(false, `首页 ${base}/ 请求失败`);
}

if (failures > 0) {
  console.error(`\nsmoke: ${failures} 项未通过`);
  process.exit(1);
}
console.log('\nsmoke: 全部通过');
