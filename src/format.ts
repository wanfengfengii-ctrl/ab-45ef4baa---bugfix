/** 数值展示：保留至多 3 位小数并去掉多余的 0。 */
export function fmt(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const v = Math.round(x * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
}

/**
 * 精确十进制代价文本展示：入参为 decimalToString 的规范形式（不带指数，
 * 如 "0.3" 或 4e308 的 "4" + 308 个 0）。仅做千位分隔，不做任何舍入或
 * 双精度转换——总代价可能超出双精度范围（4e308 转 Number 会变成 Infinity），
 * 必须逐位保留并有限展示。
 */
export function fmtCostText(text: string): string {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [intPart, fracPart] = body.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const shown = fracPart ? `${grouped}.${fracPart}` : grouped;
  return negative ? `-${shown}` : shown;
}
