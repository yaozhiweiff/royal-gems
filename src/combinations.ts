export const COMBINATIONS = {
  'bomb-bomb': { name: '爆炸共鸣', pair: '爆炸＋爆炸', description: '以交换落点为中心，清除 5×5 范围的宝石。' },
  'bomb-cross': { name: '十字爆破', pair: '爆炸＋十字', description: '以交换落点为中心，清除相邻的 3 整行与 3 整列。' },
  'cross-cross': { name: '八向星芒', pair: '十字＋十字', description: '从交换落点沿横向、纵向及两条对角线，向八个方向清除至棋盘边缘。' },
  'ultimate-bomb': { name: '爆炸连锁', pair: '终极＋爆炸', description: '将全盘该颜色的宝石先变为爆炸宝石，再全部引爆并触发连锁。' },
  'ultimate-cross': { name: '十字连锁', pair: '终极＋十字', description: '将全盘该颜色的宝石先变为十字宝石，再全部触发横纵消除。' },
  'ultimate-ultimate': { name: '终极共鸣', pair: '终极＋终极', description: '清空整个棋盘的宝石。' },
} as const;

export type CombinationKind = keyof typeof COMBINATIONS;
export type Combination = { kind: CombinationKind; origin: number; pair: [number, number]; color?: number };

export function combinationKind(a: string, b: string): CombinationKind | null {
  if (a === 'normal' || b === 'normal') return null;
  if (a === 'ultimate' && b === 'ultimate') return 'ultimate-ultimate';
  if (a === 'ultimate' || b === 'ultimate') return a === 'bomb' || b === 'bomb' ? 'ultimate-bomb' : 'ultimate-cross';
  if (a === 'bomb' && b === 'bomb') return 'bomb-bomb';
  if (a === 'cross' && b === 'cross') return 'cross-cross';
  return 'bomb-cross';
}
