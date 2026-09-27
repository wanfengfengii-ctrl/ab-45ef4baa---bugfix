import { describe, expect, it } from 'vitest';
import { fmt, fmtCostText } from './format';

describe('fmtCostText · 精确十进制代价展示', () => {
  it('常规整数千位分隔，小数逐位保留', () => {
    expect(fmtCostText('0')).toBe('0');
    expect(fmtCostText('8')).toBe('8');
    expect(fmtCostText('1234')).toBe('1,234');
    expect(fmtCostText('1234567')).toBe('1,234,567');
    expect(fmtCostText('0.3')).toBe('0.3');
    expect(fmtCostText('4.6000000002')).toBe('4.6000000002');
  });

  it('超出双精度范围的有限总代价（4e308）逐位展示，绝不为 Infinity', () => {
    const text = '4' + '0'.repeat(308);
    const shown = fmtCostText(text);
    expect(shown).not.toContain('Infinity');
    expect(shown.replaceAll(',', '')).toBe(text);
    expect(shown.startsWith('400,000,000,000,')).toBe(true);
    // 同一文本经 Number 会溢出——展示必须在不转 Number 的情况下保持有限
    expect(Number(text)).toBe(Number.POSITIVE_INFINITY);
  });

  it('负数分组（防御性，录入代价实际不允许负值）', () => {
    expect(fmtCostText('-1234.5')).toBe('-1,234.5');
  });
});

describe('fmt · 物理量展示保持既有行为', () => {
  it('至多 3 位小数并去掉多余 0；非有限值显示为 —', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(1 / 3)).toBe('0.333');
    expect(fmt(1.2)).toBe('1.2');
    expect(fmt(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
