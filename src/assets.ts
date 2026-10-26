export const GEMS = ['red', 'blue', 'green', 'purple', 'yellow'];
export const GEM_NAMES = ['红宝石', '蓝宝石', '绿宝石', '紫宝石', '黄宝石'];
export const CHARACTERS = [
  { id: 'beth', name: '贝丝', phrase: '让每一颗宝石，闪耀恰如其分。', position: '50% 18%', imageHeight: '137%', imageTop: 'calc(15px - 15.1%)', imageShift: '-52.4%' },
  { id: 'lance', name: '兰斯', phrase: '观察全局，下一步自有答案。', position: '54% 17%', imageHeight: '156%', imageTop: 'calc(15px - 17.7%)', imageShift: '-47.6%' },
  { id: 'chris', name: '克丽丝', phrase: '美妙的连锁，始于一次灵感。', position: '51% 14%', imageHeight: '128%', imageTop: 'calc(15px - 5.95%)', imageShift: '-50.2%' },
  { id: 'ian', name: '伊恩', phrase: '从容落子，让胜利如约而至。', position: '51% 14%', imageHeight: '134%', imageTop: 'calc(15px - 11.54%)', imageShift: '-52%' },
];
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;
export const characterImage = (id: string) => assetUrl(`characters/${id}.webp`);
