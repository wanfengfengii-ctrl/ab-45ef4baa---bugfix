import {
  DECIMAL_ZERO,
  decimalAdd,
  decimalCompare,
  decimalFromCostInput,
  decimalToString,
  type Decimal,
} from './decimal';
import {
  rationalAdd,
  rationalCompare,
  rationalFromInput,
  rationalMul,
  rationalToNumber,
  type Rational,
} from './exact';
import type {
  AdjudicationOutcome,
  Limits,
  Plan,
  Scenario,
  StepRecord,
  Violation,
  ViolationKind,
} from './types';

/**
 * 数值比较容差（仅保留给双精度视图的外部断言/展示场景）。
 *
 * 注意：求解器内部的载荷与力矩**边界判定**不再使用此固定绝对容差，而是按
 * 录入十进制文本恢复的精确有理数逐位比较（见 ./exact）：在 1e16 量级，一个
 * 双精度 ULP 约为 2，固定 1e-9 会把整单位的真实越界（如累计力矩
 * 10000000000000001 超出上限 10000000000000000）吞掉。力矩余量决胜与安装
 * 代价比较也不使用此容差——余量按双精度严格比较，任何真实存在的余量差
 * （哪怕 5e-10 级）都优先于成本；代价按十进制精确比较（见 ./decimal）。
 */
export const EPS = 1e-9;

const RATIONAL_ZERO: Rational = { numerator: 0n, denominator: 1n };

interface FlatOption {
  optionIndex: number;
  railId: string;
  railName: string;
  coordinate: number;
  /** 力臂的精确十进制值（由录入原文恢复，缺省时取 number 的最短往返表示）。 */
  coordinateExact: Rational;
  cost: number;
  /** 本选项代价的精确十进制值（优先由录入原文恢复，见 decimalFromCostInput）。 */
  costDecimal: Decimal;
  /** 本步力矩增量 = 质量 × 力臂 的精确值（质量/力臂均为录入十进制值）。 */
  torqueTermExact: Rational;
}

interface FlatBlock {
  index: number;
  name: string;
  mass: number;
  /** 质量的精确十进制值。 */
  massExact: Rational;
  options: FlatOption[];
}

/**
 * 候选方案：对外暴露的 Plan 携带精确十进制总代价文本（totalCostText，
 * decimalToString 的规范无指数形式），内部另携带精确十进制总代价，
 * 供决胜与分支限界严格比较。总代价绝不经过双精度：各项有限录入代价之和
 * 可能超出双精度范围（如 4 × 1e308 = 4e308），一旦转 Number 就会溢出为
 * Infinity。
 */
interface Candidate {
  plan: Plan;
  cost: Decimal;
}

function torqueMarginOf(torque: number, limits: Limits): number {
  return Math.min(torque - limits.minTorque, limits.maxTorque - torque);
}

/** 按 (块录入序号, 位置录入序号) 沿挂装次序逐位比较，保证稳定决胜。 */
function lexCompareSteps(a: StepRecord[], b: StepRecord[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].blockIndex !== b[i].blockIndex) return a[i].blockIndex - b[i].blockIndex;
    if (a[i].optionIndex !== b[i].optionIndex) return a[i].optionIndex - b[i].optionIndex;
  }
  return a.length - b.length;
}

/**
 * 裁决优先级（依次）：
 * 1. 力矩余量（所有前缀中的最小值）最大者优先——按双精度严格比较：
 *    只有余量真正相等时成本才参与决胜，任何严格存在的余量差
 *    （哪怕 5e-10）都不能被成本差覆盖；
 * 2. 总安装代价最小者优先（按录入的十进制值精确比较：0.1+0.2 与 0.3 视为同成本，
 *    而 1e-10 级的真实差额仍严格区分，序号决胜不得覆盖成本差）；
 * 3. 按挂装顺序的 (块录入序号, 位置录入序号) 序列字典序最小者优先。
 */
function isBetter(a: Candidate, b: Candidate | null): boolean {
  if (b === null) return true;
  if (a.plan.minTorqueMargin > b.plan.minTorqueMargin) return true;
  if (a.plan.minTorqueMargin < b.plan.minTorqueMargin) return false;
  const costOrder = decimalCompare(a.cost, b.cost);
  if (costOrder < 0) return true;
  if (costOrder > 0) return false;
  return lexCompareSteps(a.plan.steps, b.plan.steps) < 0;
}

/**
 * 裁决：联合确定每块配重恰用一次的挂入位置与完整挂装次序。
 *
 * 搜索按挂装顺序逐步进行，每一个前缀状态都同时校验总载荷与力矩闭区间，
 * 因此绝不出现“先定最终位置再事后排序”的情况；力矩余量沿前缀单调不增、
 * 总代价单调不减（代价非负），据此对当前最优解做分支限界。
 *
 * 边界判定按录入十进制值的精确有理数进行（质量、力臂、区间端点均逐位
 * 恢复）：大力臂（如 1e16）与单位力矩混合时，双精度会把 T+1 吞成 T
 * （1e16 处 ULP ≈ 2），固定绝对容差更会放行真实越界；精确累加下
 * 10000000000000001 与上限 10000000000000000 严格可分。力矩余量决胜仍用
 * 双精度严格比较，总代价以精确十进制累计。
 */
export function adjudicate(scenario: Scenario): AdjudicationOutcome {
  const railById = new Map(scenario.rails.map((r) => [r.id, r]));
  const limits = scenario.limits;
  const maxLoadExact = rationalFromInput({ value: limits.maxLoad, text: limits.maxLoadText });
  const minTorqueExact = rationalFromInput({ value: limits.minTorque, text: limits.minTorqueText });
  const maxTorqueExact = rationalFromInput({ value: limits.maxTorque, text: limits.maxTorqueText });

  const blocks: FlatBlock[] = scenario.blocks.map((b, i) => {
    const massExact = rationalFromInput({ value: b.mass, text: b.massText });
    return {
      index: i,
      name: b.name,
      mass: b.mass,
      massExact,
      options: b.options.map((o, j) => {
        const rail = railById.get(o.railId);
        if (!rail) throw new Error(`未知导轨位置: ${o.railId}`);
        const coordinateExact = rationalFromInput({
          value: rail.coordinate,
          text: rail.coordinateText,
        });
        return {
          optionIndex: j,
          railId: rail.id,
          railName: rail.name,
          coordinate: rail.coordinate,
          coordinateExact,
          cost: o.cost,
          costDecimal: decimalFromCostInput(o),
          torqueTermExact: rationalMul(massExact, coordinateExact),
        };
      }),
    };
  });
  const n = blocks.length;

  const used = new Array<boolean>(n).fill(false);
  const steps: StepRecord[] = [];
  let best: Candidate | null = null;
  /**
   * 按声明类型读取 best。best 由下方 dfs 闭包赋值，TypeScript 的控制流分析
   * 不会把闭包内的赋值反映到调用点之后（直接引用会被窄化为 null），
   * 因此调用 dfs 后须经此函数边界读取。
   */
  const getBest = (): Candidate | null => best;
  /** 每个深度上按裁决优先级最优的可行前缀（用于无可行方案时的诊断）。 */
  const bestPartial: (Candidate | null)[] = new Array(n + 1).fill(null);

  const snapshot = (cost: Decimal, minTorqueMargin: number): Candidate => ({
    plan: {
      steps: steps.map((s) => ({ ...s })),
      totalCostText: decimalToString(cost),
      minTorqueMargin,
      finalMass: steps.length > 0 ? steps[steps.length - 1].cumulativeMass : 0,
      finalTorque: steps.length > 0 ? steps[steps.length - 1].cumulativeTorque : 0,
    },
    cost,
  });

  const dfs = (
    depth: number,
    mass: number,
    torque: number,
    massExact: Rational,
    torqueExact: Rational,
    cost: Decimal,
    minMargin: number,
  ): void => {
    const current = snapshot(cost, minMargin);
    if (isBetter(current, bestPartial[depth])) bestPartial[depth] = current;
    if (depth === n) {
      if (isBetter(current, best)) best = current;
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const block = blocks[i];
      for (const opt of block.options) {
        // 精确边界判定：质量/力矩均按录入十进制值逐位累加后与闭区间比较，
        // 闭区间接纳等号，任何真实越界（哪怕 1）都不靠浮点容差放行。
        const massAfterExact = rationalAdd(massExact, block.massExact);
        if (rationalCompare(massAfterExact, maxLoadExact) > 0) continue;
        const torqueAfterExact = rationalAdd(torqueExact, opt.torqueTermExact);
        if (rationalCompare(torqueAfterExact, minTorqueExact) < 0) continue;
        if (rationalCompare(torqueAfterExact, maxTorqueExact) > 0) continue;

        // 双精度视图：仅用于力矩余量决胜与逐步展示（不参与边界判定）。
        const massAfter = mass + block.mass;
        const torqueAfter = torque + block.mass * opt.coordinate;
        const margin = torqueMarginOf(torqueAfter, limits);
        const nextMinMargin = Math.min(minMargin, margin);
        // 精确十进制累加本步代价（代价非负，规模 ≤7，开销可忽略）。
        const nextCost = decimalAdd(cost, opt.costDecimal);
        if (best) {
          // 力矩余量沿前缀单调不增：已严格劣于最优解的余量无法挽回，剪枝。
          // 与 isBetter 一致按双精度严格比较，不容差抹平真实余量差。
          if (nextMinMargin < best.plan.minTorqueMargin) continue;
          // 余量已无法严格更优（至多持平），而代价（非负，继续挂装只会更高）
          // 已严格更贵，剪枝。精确十进制比较：哪怕只差 1e-10 也必须保留更便宜的分支。
          if (nextMinMargin <= best.plan.minTorqueMargin && decimalCompare(nextCost, best.cost) > 0) {
            continue;
          }
        }
        used[i] = true;
        steps.push({
          blockIndex: i,
          blockName: block.name,
          optionIndex: opt.optionIndex,
          railId: opt.railId,
          railName: opt.railName,
          coordinate: opt.coordinate,
          mass: block.mass,
          cost: opt.cost,
          costText: decimalToString(opt.costDecimal),
          cumulativeMass: massAfter,
          cumulativeTorque: torqueAfter,
          loadMargin: limits.maxLoad - massAfter,
          torqueMargin: margin,
        });
        dfs(
          depth + 1,
          massAfter,
          torqueAfter,
          massAfterExact,
          torqueAfterExact,
          nextCost,
          nextMinMargin,
        );
        steps.pop();
        used[i] = false;
      }
    }
  };

  dfs(0, 0, 0, RATIONAL_ZERO, RATIONAL_ZERO, DECIMAL_ZERO, Number.POSITIVE_INFINITY);

  const winner = getBest();
  if (winner) return { feasible: true, plan: winner.plan };

  // 无可行方案：定位最深的可行已选前缀（其下一步即最早无法继续挂装的位置）。
  let depth = n - 1;
  while (depth >= 0 && bestPartial[depth] === null) depth--;
  const witness = depth >= 0 ? bestPartial[depth] : null;
  const witnessSteps = witness ? witness.plan.steps : [];
  const usedBlocks = new Set(witnessSteps.map((s) => s.blockIndex));

  // 由已选前缀重建精确载荷/力矩状态（步记录只保留双精度视图）。
  let baseMassExact: Rational = RATIONAL_ZERO;
  let baseTorqueExact: Rational = RATIONAL_ZERO;
  for (const s of witnessSteps) {
    const block = blocks[s.blockIndex];
    const opt = block.options[s.optionIndex];
    baseMassExact = rationalAdd(baseMassExact, block.massExact);
    baseTorqueExact = rationalAdd(baseTorqueExact, opt.torqueTermExact);
  }
  const baseMass = rationalToNumber(baseMassExact);
  const baseTorque = rationalToNumber(baseTorqueExact);

  const violations: Violation[] = [];
  for (const block of blocks) {
    if (usedBlocks.has(block.index)) continue;
    for (const opt of block.options) {
      const massAfterExact = rationalAdd(baseMassExact, block.massExact);
      const torqueAfterExact = rationalAdd(baseTorqueExact, opt.torqueTermExact);
      const kinds: ViolationKind[] = [];
      if (rationalCompare(massAfterExact, maxLoadExact) > 0) kinds.push('load');
      if (rationalCompare(torqueAfterExact, minTorqueExact) < 0) kinds.push('torque-low');
      if (rationalCompare(torqueAfterExact, maxTorqueExact) > 0) kinds.push('torque-high');
      if (kinds.length > 0) {
        violations.push({
          blockIndex: block.index,
          blockName: block.name,
          optionIndex: opt.optionIndex,
          railId: opt.railId,
          railName: opt.railName,
          massAfter: baseMass + block.mass,
          torqueAfter: baseTorque + block.mass * opt.coordinate,
          kinds,
        });
      }
    }
  }
  return { feasible: false, report: { witnessPrefix: witnessSteps, violations } };
}
