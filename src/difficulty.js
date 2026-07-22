export const DIFFICULTY_PROFILES = Object.freeze({
  easy: Object.freeze({
    id: 'easy',
    label: 'EASY',
    playerHealth: 150,
    startingArmor: 150,
    enemyHealthMultiplier: 1,
    enemyAccuracyMultiplier: 1.2,
    oneLife: false,
    concealedVests: false,
  }),
  normal: Object.freeze({
    id: 'normal',
    label: 'NORMAL',
    playerHealth: 120,
    startingArmor: 120,
    enemyHealthMultiplier: 1.2,
    enemyAccuracyMultiplier: 0.92,
    oneLife: false,
    concealedVests: false,
  }),
  hard: Object.freeze({
    id: 'hard',
    label: 'HARD',
    playerHealth: 100,
    startingArmor: 100,
    enemyHealthMultiplier: 1.45,
    enemyAccuracyMultiplier: 0.62,
    oneLife: true,
    concealedVests: false,
  }),
  extreme: Object.freeze({
    id: 'extreme',
    label: 'EXTREME',
    playerHealth: 75,
    startingArmor: 75,
    enemyHealthMultiplier: 1.8,
    enemyAccuracyMultiplier: 0.4,
    oneLife: true,
    concealedVests: true,
  }),
});

export function getDifficultyProfile(value = 'normal') {
  const key = String(value ?? 'normal').toLowerCase();
  return DIFFICULTY_PROFILES[key] ?? DIFFICULTY_PROFILES.normal;
}

export function isOneLifeDifficulty(value) {
  return getDifficultyProfile(value).oneLife;
}
