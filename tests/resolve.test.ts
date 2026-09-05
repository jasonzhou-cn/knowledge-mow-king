/**
 * 配置解析器单元测试（tests/resolve.test.ts）
 * 覆盖夜间待办清单第 2 项：
 *  - resolveAnswerSpeed 三种曲线（linear / exponential / hybrid）+ 学科系数 + 区间钳制
 *  - resolveQuestionTimeLimit 成长与钳制
 *  - resolveExpToNextLevel（linear / exponential / 满级 Infinity）
 *  - resolveLevelEntry 关卡号越界钳制
 *  - computeGrassCuttingBonus 上限/保底/逐项拆解
 *  - resolveLevelPackage 集成：怪物指数成长 × 难度缩放、assist 透传、combo 透传
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeGrassCuttingBonus,
  resolveAnswerSpeed,
  resolveExpToNextLevel,
  resolveLevelEntry,
  resolveLevelPackage,
  resolveQuestionTimeLimit,
  type QuizResult,
} from '../src/config/resolve';
import type {
  GameSettings,
  GrassCuttingBonusSettings,
  GrassCuttingConfig,
  LevelConfig,
  QuestionConfig,
  WeaponConfig,
} from '../src/config/types';

// ───────────────────────── 与 public/config 同构的最小 fixtures ─────────────────────────

const speedSettings = {
  curveType: 'hybrid' as const,
  baseSpeed: 800,
  minSpeedLimit: 200,
  maxSpeedLimit: 1200,
  speedReductionPerLevel: 50,
  speedReductionGrowth: 0.9,
};

const questionConfig: QuestionConfig = {
  version: 'test',
  speedSettings,
  questionSettings: {
    questionCountPerRound: 5,
    questionTimeLimit: 10,
    timeLimitGrowth: 1.1,
    maxTimeLimit: 20,
    minTimeLimit: 5,
    correctBonusTime: 2,
    consecutiveCorrectThreshold: 3,
  },
  answerSettings: {} as QuestionConfig['answerSettings'],
  subjectDifficulty: {
    math: { difficultyCoefficient: 1, speedCoefficient: 1 },
    english: { difficultyCoefficient: 1.1, speedCoefficient: 1.05 },
  },
  difficultySelection: {
    lowLevelMax: 4,
    midLevelMax: 8,
    weightsLow: { '1': 1, '2': 0, '3': 0 },
    weightsMid: { '1': 0, '2': 1, '3': 0 },
    weightsHigh: { '1': 0, '2': 0, '3': 1 },
  },
};

const bonusSettings: GrassCuttingBonusSettings = {
  baseBonusGrowthPerLevel: 0.1,
  accuracyBaseline: 0.5,
  accuracyWeight: 1,
  accuracyTermMin: 0.4,
  accuracyTermMax: 1.6,
  speedFactorBase: 1,
  speedFactorWeight: 0.8,
  speedFactorMin: 0.8,
  speedFactorMax: 1.5,
  comboFactorPerCombo: 0.05,
  comboFactorMax: 1.5,
  multiplierFloor: { damage: 0.6, range: 0.6, duration: 0.6 },
  multiplierCeiling: { damage: 3, range: 3, duration: 3 },
};

const gameSettings = {
  version: 'test',
  levelSettings: {
    maxLevel: 50,
    levelUpGradeBase: 100,
    levelUpGradeGrowth: 1.2,
    levelUpGradeGrowthType: 'exponential' as const,
  },
  rewardSettings: {} as GameSettings['rewardSettings'],
  otherSettings: { defaultGameTime: 60, maxGameTimeLimit: 300, minGameTimeLimit: 30, subjectUnlockLevel: {} },
  grassCuttingBonusSettings: bonusSettings,
  playtimeSettings: { enabled: false, sessionLimitMin: 30, restMin: 10 },
} as GameSettings;

function quiz(accuracy: number, avgTime: number, maxCombo = 0): QuizResult {
  return {
    totalQuestions: 5,
    correctCount: Math.round(accuracy * 5),
    missCount: 0,
    timeoutCount: 0,
    accuracy,
    maxCombo,
    averageAnswerTime: avgTime,
    totalAnswerTime: avgTime * 5,
    records: [],
  };
}

// ───────────────────────── resolveAnswerSpeed ─────────────────────────

test('answerSpeed linear 曲线：每级线性递减', () => {
  const cfg = { ...questionConfig, speedSettings: { ...speedSettings, curveType: 'linear' as const } };
  assert.equal(resolveAnswerSpeed(cfg, 1, 'math'), 800);
  assert.equal(resolveAnswerSpeed(cfg, 5, 'math'), 600);
});

test('answerSpeed exponential 曲线：baseSpeed × growth^(level-1)', () => {
  const cfg = { ...questionConfig, speedSettings: { ...speedSettings, curveType: 'exponential' as const } };
  assert.ok(Math.abs(resolveAnswerSpeed(cfg, 1, 'math') - 800) < 1e-9);
  assert.ok(Math.abs(resolveAnswerSpeed(cfg, 2, 'math') - 720) < 1e-9); // 800 × 0.9
});

test('answerSpeed hybrid 曲线：线性 × 指数叠加（GDD 4.2.2 参考实现）', () => {
  const cfg = { ...questionConfig, speedSettings: { ...speedSettings, curveType: 'hybrid' as const } };
  // L3: (800 - 2×50) × 0.9² = 700 × 0.81 = 567
  assert.ok(Math.abs(resolveAnswerSpeed(cfg, 3, 'math') - 567) < 1e-9);
});

test('answerSpeed 套用学科速度系数并钳制在区间内', () => {
  const cfg = { ...questionConfig, speedSettings: { ...speedSettings, curveType: 'linear' as const } };
  assert.ok(Math.abs(resolveAnswerSpeed(cfg, 1, 'english') - 840) < 1e-9); // 800 × 1.05
  // 极高等级应被 minSpeedLimit 钳住，而不是跌穿下限
  assert.equal(resolveAnswerSpeed(cfg, 999, 'math'), 200);
});

// ───────────────────────── resolveQuestionTimeLimit ─────────────────────────

test('questionTimeLimit 随等级放宽（growth 1.1）并在 maxTimeLimit 钳制', () => {
  assert.ok(Math.abs(resolveQuestionTimeLimit(questionConfig, 1) - 10) < 1e-9);
  assert.equal(resolveQuestionTimeLimit(questionConfig, 10), 20); // 10×1.1^9≈23.6 → 钳到 20
  assert.ok(resolveQuestionTimeLimit(questionConfig, 1) >= 5);
});

// ───────────────────────── resolveExpToNextLevel ─────────────────────────

test('expToNextLevel exponential：base × growth^(level-1) 并取整', () => {
  assert.equal(resolveExpToNextLevel(gameSettings, 1), 100);
  assert.equal(resolveExpToNextLevel(gameSettings, 2), 120);
});

test('expToNextLevel linear 与满级返回 Infinity', () => {
  const linear = {
    ...gameSettings,
    levelSettings: { ...gameSettings.levelSettings, levelUpGradeGrowthType: 'linear' as const },
  };
  assert.equal(resolveExpToNextLevel(linear, 3), 102); // 100 + 1.2×2 = 102.4 → round 102
  assert.equal(resolveExpToNextLevel(gameSettings, 50), Number.POSITIVE_INFINITY);
});

// ───────────────────────── resolveLevelEntry ─────────────────────────

test('levelEntry 命中区间并以最后一关兜底越界关卡号', () => {
  const levelConfig: LevelConfig = {
    version: 'test',
    levels: [
      { level: 1, name: 'L1', subject: 'math', unlockCondition: '', questionCount: 5, bossLevel: false, breatherLevel: false, difficultyScale: 1, gameTime: 60, primaryDimension: 'none', nextLevelUnlockCondition: '' },
      { level: 5, name: 'L5', subject: 'english', unlockCondition: '', questionCount: 6, bossLevel: true, breatherLevel: false, difficultyScale: 1.45, gameTime: 60, primaryDimension: 'none', nextLevelUnlockCondition: '' },
    ],
    levelDifficultyGrowth: { questionCountGrowth: 0, difficultyScaleStep: 0, breatherInterval: 4 },
  };
  assert.equal(resolveLevelEntry(levelConfig, 1).name, 'L1');
  assert.equal(resolveLevelEntry(levelConfig, 4).name, 'L1'); // 落回最近的已定义关
  assert.equal(resolveLevelEntry(levelConfig, 5).name, 'L5');
  assert.equal(resolveLevelEntry(levelConfig, 99).name, 'L5'); // 越界钳制到最后一关
});

// ───────────────────────── computeGrassCuttingBonus ─────────────────────────

test('bonus 达到上限时 ceilingApplied=true 且三项同钳', () => {
  const bonus = computeGrassCuttingBonus(quiz(1, 0.1, 10), 50, 1.2, bonusSettings, 10);
  assert.ok(bonus.breakdown.ceilingApplied);
  assert.equal(bonus.damageMultiplier, 3);
  assert.equal(bonus.rangeMultiplier, 3);
  assert.equal(bonus.durationMultiplier, 3);
});

test('bonus 全错+超慢触发保底且 floorApplied=true', () => {
  const bonus = computeGrassCuttingBonus(quiz(0, 10), 1, 1, bonusSettings, 10);
  assert.ok(bonus.breakdown.floorApplied);
  assert.ok(bonus.damageMultiplier >= 0.6);
  // 正确率 0 → accuracyTerm = 1 + (0-0.5)×1 = 0.5（未破 0.4 下限，raw 仍 >0.6）
  assert.ok(Math.abs(bonus.breakdown.accuracyTerm - 0.5) < 1e-9);
});

test('bonus 连对项：maxCombo 10 → comboFactor 1.5 并封顶', () => {
  const bonus = computeGrassCuttingBonus(quiz(1, 5, 10), 1, 1, bonusSettings, 10);
  assert.ok(Math.abs(bonus.breakdown.comboFactor - 1.5) < 1e-9);
  const capped = computeGrassCuttingBonus(quiz(1, 5, 100), 1, 1, bonusSettings, 10);
  assert.ok(Math.abs(capped.breakdown.comboFactor - 1.5) < 1e-9);
});

// ───────────────────────── resolveLevelPackage 集成 ─────────────────────────

const grassConfig = {
  version: 'test',
  touchSettings: {} as GrassCuttingConfig['touchSettings'],
  playerSettings: { playerHpBase: 100, playerMoveSpeed: 260, playerRadius: 16, invulnerableDuration: 0.6, playerContactDamageCooldown: 0.5 },
  monsterSettings: {
    monsterHpBase: 10, monsterHpGrowthPerLevel: 1.25, monsterDamageBase: 0.7, monsterDamageGrowthPerLevel: 0.1,
    monsterMoveSpeedBase: 100, monsterMoveSpeedGrowthPerLevel: 0.05, monsterSpawnIntervalWithinWave: 0.15,
    monsterRadius: 14, monsterMaxAlive: 45, monsterSpawnMargin: 40, monsterScoreBase: 10,
    monsterKnockback: 340, monsterKnockbackDuration: 0.12,
  },
  comboSettings: { comboTimeWindow: 2, comboDamageGrowth: 0, comboSkillDurationGrowth: 0, comboMaxDamageMultiplier: 1 },
  difficultySettings: {
    interpolation: 'linear' as const,
    spawnIntervalStart: 1.05, spawnIntervalEnd: 0.4, batchSizeStart: 2, batchSizeEnd: 3.6,
    hpMultiplierStart: 0.32, hpMultiplierEnd: 4.6, moveSpeedMultiplierStart: 1.4, moveSpeedMultiplierEnd: 1.45,
  },
  performanceSettings: {
    maxAliveMonsters: 45, damageCheckFrameInterval: 2, maxHitTextAlive: 12,
    monsterPoolSize: 96, projectilePoolSize: 120, shardPoolSize: 60, ringPoolSize: 18, corpsePoolSize: 12,
  },
  bossSettings: { hp: 2600, damage: 24, speed: 62, radius: 46, scoreOnKill: 500, spawnDelay: 8, minionSpawnInterval: 4, minionPerWave: 3 },
  subjectCoefficientSettings: {
    math: { skillDamageCoefficient: 1, skillRangeCoefficient: 1 },
    english: { skillDamageCoefficient: 1.1, skillRangeCoefficient: 1.05 },
  },
  polishSettings: {} as GrassCuttingConfig['polishSettings'],
  assistSettings: { enabled: true, accuracyWeight: 0.4, hpWeight: 0.35, lossWeight: 0.25, lossRefHpPerSec: 4, lossWindowSec: 5, pullMin: 0.55, smoothingSec: 1.5 },
} as unknown as GrassCuttingConfig;

const levelConfig: LevelConfig = {
  version: 'test',
  levels: [
    { level: 1, name: 'L1', subject: 'math', unlockCondition: '', questionCount: 5, bossLevel: false, breatherLevel: false, difficultyScale: 1, gameTime: 60, primaryDimension: 'none', nextLevelUnlockCondition: '' },
    { level: 5, name: 'L5', subject: 'english', unlockCondition: '', questionCount: 6, bossLevel: true, breatherLevel: false, difficultyScale: 2, gameTime: 60, primaryDimension: 'none', nextLevelUnlockCondition: '' },
  ],
  levelDifficultyGrowth: { questionCountGrowth: 0, difficultyScaleStep: 0, breatherInterval: 4 },
};

const weaponConfig = {
  version: 'test',
  autoAim: { enabled: true, searchRadius: 300, aimAssistAngle: 360 },
  killFx: {} as WeaponConfig['killFx'],
  weapons: [
    {
      id: 'blade', name: '大刀', attackType: 'melee_sector' as const, damage: 30, cooldown: 0.5, range: 110,
      sectorAngle: 110, projectileSpeed: 0, projectileRadius: 0, pierce: 0, pelletCount: 1, spread: 0,
      knockback: 300, damageGrowthPerLevel: 0.08, hitstopDuration: 60, shakeIntensity: 0.004,
    },
  ],
} as unknown as WeaponConfig;

const resolveInput = {
  gameSettings,
  questionConfig,
  grassCuttingConfig: grassConfig,
  levelConfig,
  subjectConfig: { version: 'test', subjects: {} },
  weaponConfig,
} as Parameters<typeof resolveLevelPackage>[0];

test('levelPackage 集成：怪物指数成长 × 关卡难度缩放', () => {
  const l1 = resolveLevelPackage(resolveInput, 1);
  assert.ok(Math.abs(l1.monster.hp - 10) < 1e-9); // 10 × 1.25^0 × 1
  const l5 = resolveLevelPackage(resolveInput, 5);
  // 10 × 1.25^4 × scale2 = 24.414 × 2 ≈ 48.83
  assert.ok(Math.abs(l5.monster.hp - 10 * Math.pow(1.25, 4) * 2) < 1e-9);
  assert.equal(l5.subject, 'english');
  assert.ok(l5.isBossLevel);
});

test('levelPackage 集成：assist / combo / 难度曲线原样透传（数据解耦）', () => {
  const l1 = resolveLevelPackage(resolveInput, 1);
  assert.equal(l1.assist, grassConfig.assistSettings);
  assert.equal(l1.combo.damageGrowth, 0);
  assert.equal(l1.combo.maxDamageMultiplier, 1);
  assert.equal(l1.difficulty.hpMultiplierEnd, 4.6);
  assert.equal(l1.expToNextLevel, 100);
});

test('levelPackage 集成：答题加成落到武器伤害（核心绑定落点）', () => {
  const neutral = resolveLevelPackage(resolveInput, 1);
  assert.ok(Math.abs(neutral.weapons[0].damage - 30) < 1e-9);
  const boosted = resolveLevelPackage(resolveInput, 1, {
    damageMultiplier: 1.5, rangeMultiplier: 1.2, durationMultiplier: 1.1,
  });
  assert.ok(Math.abs(boosted.weapons[0].damage - 45) < 1e-9);
  // durationMultiplier 作为冷却除数：0.5 / 1.1
  assert.ok(Math.abs(boosted.weapons[0].cooldown - 0.5 / 1.1) < 1e-9);
  assert.ok(Math.abs(boosted.weapons[0].range - 110 * 1.2) < 1e-9);
});
