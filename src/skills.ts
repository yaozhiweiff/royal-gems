export type CharacterId = 'beth' | 'lance' | 'chris' | 'ian';

type CharacterSkills = {
  style: string;
  skills: readonly [
    { name: string; description: string; energy: 300 },
    { name: string; description: string; energy: 550 },
  ];
};

export const SKILLS: Record<CharacterId, CharacterSkills> = {
  beth: {
    style: '转色连锁',
    skills: [
      { name: '宝石共鸣', energy: 300, description: '将随机直线相连的 5 颗宝石变为同色，触发五连消除。' },
      { name: '王室敕令', energy: 550, description: '将数量最多与最少的两色宝石，转为数量排名第三的颜色，触发连锁。' },
    ],
  },
  lance: {
    style: '横纵清场',
    skills: [
      { name: '纵横布局', energy: 300, description: '随机将 2 颗普通宝石升级为十字宝石，保留原有颜色。' },
      { name: '全局推演', energy: 550, description: '随机清除相邻的两整行宝石，命中的特殊宝石会继续触发。' },
    ],
  },
  chris: {
    style: '范围爆破',
    skills: [
      { name: '绯红火花', energy: 300, description: '随机将 2 颗普通宝石升级为爆炸宝石，保留原有颜色。' },
      { name: '蔷薇盛放', energy: 550, description: '随机清除棋盘内一片 5×5 区域，命中的特殊宝石会继续触发。' },
    ],
  },
  ian: {
    style: '续航蓄势',
    skills: [
      { name: '从容布局', energy: 300, description: '增加 2 个回合，为下一次连锁留出更多机会。' },
      { name: '王冠恩典', energy: 550, description: '随机将 1 颗普通宝石升级为彩色问号终极宝石。' },
    ],
  },
};

export function characterSkills(character: CharacterId, mode: string): CharacterSkills {
  if (character !== 'ian' || mode !== 'challenge') return SKILLS[character];
  return { ...SKILLS.ian, skills: [{ name: '从容布局', energy: 300, description: '挑战模式固定30回合：随机将1颗普通宝石升级为爆炸宝石，保留原有颜色。' }, SKILLS.ian.skills[1]] };
}
