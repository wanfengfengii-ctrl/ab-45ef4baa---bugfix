import { describe, expect, it } from 'vitest';
import {
  rationalAdd,
  rationalCompare,
  rationalFromInput,
  rationalFromText,
  rationalMul,
  rationalToNumber,
} from './exact';

const T = 10000000000000000n;

describe('exact · 录入十进制文本的精确实数恢复', () => {
  it('整数、小数、科学计数法与符号', () => {
    expect(rationalToNumber(rationalFromText('0')!)).toBe(0);
    expect(rationalToNumber(rationalFromText('-2')!)).toBe(-2);
    expect(rationalToNumber(rationalFromText('.5')!)).toBe(0.5);
    expect(rationalToNumber(rationalFromText('5.')!)).toBe(5);
    expect(rationalToNumber(rationalFromText('1e3')!)).toBe(1000);
    expect(rationalToNumber(rationalFromText('+2E-2')!)).toBe(0.02);
    expect(rationalToNumber(rationalFromText('  0.25  ')!)).toBe(0.25);
  });

  it('非法文本返回 null', () => {
    expect(rationalFromText('')).toBeNull();
    expect(rationalFromText('abc')).toBeNull();
    expect(rationalFromText('1.2.3')).toBeNull();
  });

  it('大力臂 1e16 与单位量严格可分：T+1 ≠ T（双精度下二者相等）', () => {
    // 本缺陷的数值根源：1e16 处一个 ULP 约为 2，Number(T)+1 被吞成 T。
    expect(Number(T) + 1).toBe(Number(T)); // 佐证双精度确实无法区分
    const hi = rationalFromText('10000000000000000')!;
    const over = rationalAdd(hi, rationalFromText('1')!);
    expect(rationalCompare(over, hi)).toBe(1);
    expect(rationalCompare(hi, over)).toBe(-1);
    expect(over.numerator).toBe(T + 1n);
  });

  it('精确加法：0.1 + 0.2 严格等于 0.3', () => {
    const sum = rationalAdd(rationalFromText('0.1')!, rationalFromText('0.2')!);
    expect(rationalCompare(sum, rationalFromText('0.3')!)).toBe(0);
  });

  it('精确乘法与负力臂：1 × -10000000000000000 = -10000000000000000', () => {
    const term = rationalMul(rationalFromText('1')!, rationalFromText('-10000000000000000')!);
    expect(rationalCompare(term, rationalFromText('-10000000000000000')!)).toBe(0);
  });

  it('闭区间等号被接纳：力矩恰为上限时比较结果为 0', () => {
    const torque = rationalFromText('10000000000000000')!;
    const bound = rationalFromText('10000000000000000')!;
    expect(rationalCompare(torque, bound)).toBe(0);
  });
});

describe('exact · rationalFromInput 回退策略', () => {
  it('优先采用录入原文', () => {
    const r = rationalFromInput({ value: 0.1, text: '0.10000000000000001' });
    expect(rationalCompare(r, rationalFromText('0.1')!)).toBe(1);
  });

  it('缺省原文时按 number 最短往返表示恢复', () => {
    expect(rationalCompare(rationalFromInput({ value: 0.1 }), rationalFromText('0.1')!)).toBe(0);
    // 编程式构造的 1e16 经 String 往返仍是精确的十进制整数
    expect(rationalFromInput({ value: 1e16 }).numerator).toBe(T);
  });

  it('原文无法按十进制解析时退回 number；number 非有限则抛错', () => {
    expect(rationalCompare(rationalFromInput({ value: 0.5, text: '0x10' }), rationalFromText('0.5')!)).toBe(0);
    expect(() => rationalFromInput({ value: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => rationalFromInput({ value: Number.NaN })).toThrow();
  });
});
