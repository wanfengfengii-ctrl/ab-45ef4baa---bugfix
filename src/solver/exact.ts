/**
 * 录入物理量（质量、力臂、载荷/力矩边界）的精确有理解释。
 *
 * 这些值在录入框里都是**十进制文本**，本模块在边界判定前把它们精确化为
 * 有理数（以 bigint 承载的分数），使「逐步边界判定」按录入的十进制值逐位
 * 进行，而不是按双精度浮点结果：
 *
 * 力臂 10000000000000000 与单位力矩混合时，双精度下
 * `10000000000000000 + 1 === 10000000000000000`（1 落在该量级的 ULP 之内，
 * 约为 2），第二步的真实累计力矩 10000000000000001 被吞成上限本身；再叠加
 * 固定绝对容差 EPS=1e-9，超出上限的前缀被当作恰在边界上放行。精确有理化后，
 * 10000000000000001 与 10000000000000000 严格可分，闭区间判定不再放行。
 *
 * 力矩按 ∑(质量 × 力臂) 逐项精确累加；质量 ≤ 7 项，bigint 运算开销可忽略。
 * 注意力矩余量决胜仍按双精度严格比较（见 adjudicate.ts），本模块只负责
 * 边界判定与诊断分类所需的精确事实。
 */

/** 精确有理数：numerator / denominator（denominator 恒正，零表示为 0/1）。 */
export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

const TEN = 10n;
const ZERO_NUM = 0n;

/** 十进制文本：可选符号、整数/小数部分（允许 .5 或 5.）、可选十进制指数。 */
const DECIMAL_TEXT = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

/** 把十进制文本解析为精确有理数；无法解析或值非有限时返回 null。 */
export function rationalFromText(text: string): Rational | null {
  const m = DECIMAL_TEXT.exec(text.trim());
  if (!m) return null;
  const negative = m[1] === '-';
  const fracPart = m[2] !== undefined ? m[3] ?? '' : m[4] ?? '';
  const digits = (m[2] !== undefined ? m[2] : '') + fracPart;
  if (digits.length === 0) return null; // 仅符号或 "."
  let coefficient = BigInt(digits);
  if (negative && coefficient !== ZERO_NUM) coefficient = -coefficient;
  // value = coefficient × 10^(-fracLength) × 10^exp
  const exp = (m[5] === undefined ? 0 : Number(m[5])) - fracPart.length;
  if (!Number.isSafeInteger(exp)) return null;
  if (exp >= 0) return { numerator: coefficient * TEN ** BigInt(exp), denominator: 1n };
  return { numerator: coefficient, denominator: TEN ** BigInt(-exp) };
}

/**
 * 由录入物理量构造精确值：优先按十进制原文恢复；缺省或原文无法按十进制
 * 解析（编程式构造、Number 还接受 0x10 等写法）时退回该 number 的最短
 * 往返十进制表示（String(x)，能往返同一双精度）。非有限 number 抛错。
 */
export function rationalFromInput(input: { value: number; text?: string }): Rational {
  if (input.text !== undefined) {
    const r = rationalFromText(input.text);
    if (r) return r;
  }
  if (!Number.isFinite(input.value)) throw new Error(`物理量须为有限数值: ${input.value}`);
  const r = rationalFromText(String(input.value));
  if (r) return r;
  throw new Error(`无法解析的物理量: ${input.value}`);
}

/** 精确加法 a + b。 */
export function rationalAdd(a: Rational, b: Rational): Rational {
  if (a.numerator === ZERO_NUM) return b;
  if (b.numerator === ZERO_NUM) return a;
  return {
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  };
}

/** 精确乘法 a × b。 */
export function rationalMul(a: Rational, b: Rational): Rational {
  return { numerator: a.numerator * b.numerator, denominator: a.denominator * b.denominator };
}

/** 精确比较：a < b 返回 -1，a === b 返回 0，a > b 返回 1（分母恒正，交叉相乘即可）。 */
export function rationalCompare(a: Rational, b: Rational): number {
  const lhs = a.numerator * b.denominator;
  const rhs = b.numerator * a.denominator;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

/** 转回双精度（仅用于余量决胜、逐步展示等非边界判定场景）。 */
export function rationalToNumber(r: Rational): number {
  return Number(r.numerator) / Number(r.denominator);
}
