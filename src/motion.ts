export type MotionMode = 'full' | 'gentle';
export type AnimationSpeed = 'slow' | 'normal';

// All gameplay presentation runs at 1.3× its original playback rate. Gesture
// recognition and other input timers are deliberately independent of this rate.
export const ANIMATION_PLAYBACK_RATE = 1.3;
export const paceDuration = (milliseconds: number) => Math.round(milliseconds / ANIMATION_PLAYBACK_RATE);

export type AnimationTimings = {
  swap: number;
  anticipation: number;
  clear: readonly [number, number, number, number];
  gemFade: readonly [number, number, number, number];
  drop: number;
  settle: number;
  skill: number;
  skillTransform: number;
  specialBirth: number;
  score: number;
  shuffle: number;
};

// Gentle removes displacement and flying particles, not the time needed to
// perceive an action. Both modes retain a deliberate, readable sequence.
const TIMINGS: Record<MotionMode, Record<AnimationSpeed, AnimationTimings>> = {
  full: {
    slow: { swap: 260, anticipation: 200, clear: [650, 780, 950, 1150], gemFade: [320, 350, 380, 420], drop: 420, settle: 120, skill: 900, skillTransform: 300, specialBirth: 620, score: 850, shuffle: 300 },
    normal: { swap: 220, anticipation: 150, clear: [480, 600, 720, 850], gemFade: [280, 300, 330, 360], drop: 320, settle: 100, skill: 780, skillTransform: 260, specialBirth: 480, score: 700, shuffle: 250 },
  },
  gentle: {
    slow: { swap: 260, anticipation: 160, clear: [520, 560, 610, 650], gemFade: [300, 320, 340, 360], drop: 280, settle: 120, skill: 900, skillTransform: 300, specialBirth: 520, score: 750, shuffle: 300 },
    normal: { swap: 240, anticipation: 120, clear: [400, 440, 480, 520], gemFade: [260, 280, 300, 320], drop: 250, settle: 100, skill: 780, skillTransform: 260, specialBirth: 420, score: 650, shuffle: 260 },
  },
};

function accelerate(t: AnimationTimings): AnimationTimings {
  return {
    swap: paceDuration(t.swap), anticipation: paceDuration(t.anticipation),
    clear: [paceDuration(t.clear[0]), paceDuration(t.clear[1]), paceDuration(t.clear[2]), paceDuration(t.clear[3])],
    gemFade: [paceDuration(t.gemFade[0]), paceDuration(t.gemFade[1]), paceDuration(t.gemFade[2]), paceDuration(t.gemFade[3])],
    drop: paceDuration(t.drop), settle: paceDuration(t.settle),
    skill: paceDuration(t.skill), skillTransform: paceDuration(t.skillTransform),
    specialBirth: paceDuration(t.specialBirth), score: paceDuration(t.score), shuffle: paceDuration(t.shuffle),
  };
}

const PLAYBACK_TIMINGS = {
  full: { slow: accelerate(TIMINGS.full.slow), normal: accelerate(TIMINGS.full.normal) },
  gentle: { slow: accelerate(TIMINGS.gentle.slow), normal: accelerate(TIMINGS.gentle.normal) },
};

export function animationTimings(mode: MotionMode, speed: AnimationSpeed): Readonly<AnimationTimings> {
  return PLAYBACK_TIMINGS[mode][speed];
}
