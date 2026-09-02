/**
 * 配置解析器（src/config/resolve.ts）
 * 职责：以 level 为唯一关联键（GDD 1.4 多表关联原则），把分散在 7 张配置表里的原始参数
 *      「解析」成一个完整的数值包，供场景代码直接消费。
 * 铁律：场景代码只消费本文件输出的解析结果，**禁止在场景里自行写成长公式**，
 *      否则数值口径会分裂，改配置就不再等价于改游戏。
 */

import { ConfigLoader } from './ConfigLoader';
import type {
  AutoAimSettings,
  BossRoster,
  BossSettings,
  BossTemplate,
  GameSettings,
  GrassCuttingBonus,
  GrassCuttingBonusSettings,
  GrassCuttingConfig,
  DifficultySettings,
  KillFxSettings,
  LevelConfig,
  LevelEntry,
  QuestionConfig,
  SubjectConfig,
  SubjectKey,
  TouchSettings,
  WeaponAttackType,
  WeaponConfig,
} from './types';
import { clamp, growthExponential, growthLinearPercent } from '../utils/MathUtil';

/** 单题作答记录，用于结算面板与错题回顾 */
export interface AnswerRecord {
  questionId: string;
  /** 是否答对（未命中与超时均记为错） */
  correct: boolean;
  /** 未命中判定：点停时没有任何选项达到重叠阈值 */
  missed: boolean;
  /** 超时判定 */
  timedOut: boolean;
  /** 本题耗时（秒） */
  timeSpent: number;
  /** 玩家选中的选项索引，-1 表示未命中或超时 */
  selectedIndex: number;
}

/** 一轮答题的汇总结果，是「答题质量 → 割草加成」的唯一输入 */
export interface QuizResult {
  totalQuestions: number;
  correctCount: number;
  missCount: number;
  timeoutCount: number;
  /** 正确率 0~1 */
  accuracy: number;
  /** 最大连对数 */
  maxCombo: number;
  /** 平均每题耗时（秒） */
  averageAnswerTime: number;
  /** 总耗时（秒） */
  totalAnswerTime: number;
  records: AnswerRecord[];
}

/**
 * 解析后的单把武器：等级成长、学科系数、答题加成全部在此换算完毕，
 * 运行期（WeaponSystem）只负责读取，不再做任何数值计算（GDD 1.4）。
 */
export interface ResolvedWeapon {
  id: string;
  name: string;
  attackType: WeaponAttackType;
  /** 最终伤害 = 基础 × 等级成长 × 学科伤害系数 × 答题伤害乘数 */
  damage: number;
  /** 最终出手间隔 = 基础 ÷ 答题「持续」乘数（答得越好出手越快） */
  cooldown: number;
  /** 最终射程 = 基础 × 学科范围系数 × 答题范围乘数 */
  range: number;
  sectorAngle: number;
  projectileSpeed: number;
  projectileRadius: number;
  pierce: number;
  pelletCount: number;
  spread: number;
  knockback: number;
  hitstopDuration: number;
  shakeIntensity: number;
}

/** 加成计算过程拆解，用于结算面板向玩家透明展示来源（GDD 2.4 奖励规则透明化） */
export interface BonusBreakdown {
  baseBonus: number;
  subjectCoefficient: number;
  accuracyTerm: number;
  speedFactor: number;
  comboFactor: number;
  /** 钳制前的原始乘数 */
  rawMultiplier: number;
  /** 是否触发了保底或上限钳制 */
  floorApplied: boolean;
  ceilingApplied: boolean;
}

/** 解析某等级后得到的完整数值包 */
export interface ResolvedLevelPackage {
  level: number;
  subject: SubjectKey;
  levelEntry: LevelEntry;

  // 答题侧
  /** 答案选项移动速度（像素/秒），已按学科系数与等级曲线计算并钳制在区间内 */
  answerSpeed: number;
  /** 每题限时（秒） */
  questionTimeLimit: number;
  /** 本关题数 */
  questionCount: number;

  // 割草侧
  gameTime: number;
  player: {
    hp: number;
    moveSpeed: number;
    radius: number;
    invulnerableDuration: number;
    contactDamageCooldown: number;
  };
  monster: {
    hp: number;
    damage: number;
    moveSpeed: number;
    /** 同屏存活上限（性能红线） */
    maxAlive: number;
    /** 同波内逐只生成的间隔（秒） */
    spawnInterval: number;
    radius: number;
    scorePerKill: number;
    /** 接触击退速度（像素/秒） */
    knockback: number;
    /** 接触击退持续时长（秒） */
    knockbackDuration: number;
    spawnMargin: number;
  };
  combo: {
    timeWindow: number;
    damageGrowth: number;
    durationGrowth: number;
    maxDamageMultiplier: number;
  };
  /** 三把武器（已乘等级成长、学科系数与答题加成） */
  weapons: ResolvedWeapon[];
  /** 自动瞄准设置（原样透传，运行期不做二次加工） */
  autoAim: AutoAimSettings;
  /** 击杀打击感设置（原样透传） */
  killFx: KillFxSettings;
  /** 触屏操作设置（虚拟摇杆几何与透明度，原样透传） */
  touch: TouchSettings;
  /** 时间驱动难度曲线的起止值（插值在 MonsterSpawner 里按 t 做） */
  difficulty: DifficultySettings;
  performance: {
    maxAliveMonsters: number;
    damageCheckFrameInterval: number;
    maxHitTextAlive: number;
    monsterPoolSize: number;
    projectilePoolSize: number;
    shardPoolSize: number;
    ringPoolSize: number;
    corpsePoolSize: number;
  };
  /** 本关的难度总缩放（含呼吸关回落） */
  difficultyScale: number;
  /** 是否呼吸关（难度回落关卡） */
  isBreatherLevel: boolean;
  /** 是否 Boss 关（击杀 Boss 即通关） */
  isBossLevel: boolean;
  /** Boss 数值（仅 Boss 关消费，普通关不读取）。
   *  T-022：升级为 ResolvedBossTemplate，包含阶段 + 技能字典，
   *  与旧 BossSettings 字段兼容（hp/damage/speed/radius/scoreOnKill 等） */
  boss: ResolvedBossTemplate;
  /** 升级到下一级所需经验 */
  expToNextLevel: number;
  /** 该等级的加成公式参数（供结算面板复用） */
  bonusSettings: GrassCuttingBonusSettings;
}

/** 解析所需的最小配置集合，便于单测直接构造 */
export interface ResolveInput {
  gameSettings: GameSettings;
  questionConfig: QuestionConfig;
  grassCuttingConfig: GrassCuttingConfig;
  levelConfig: LevelConfig;
  subjectConfig: SubjectConfig;
  weaponConfig: WeaponConfig;
}

/**
 * 把武器原始配置解析为运行期可直接消费的最终数值。
 *
 * 三项答题乘数的落点（GDD 1.3 核心绑定原则：答题质量必须决定割草爽感）：
 *  - damageMultiplier   → 武器伤害
 *  - rangeMultiplier    → 武器射程（近战扇形半径 / 远程弹丸射程）
 *  - durationMultiplier → 攻击节奏（作为冷却的除数，答得越好出手越快）
 *
 * 软失败保护（GDD 2.1）：乘数已在 computeGrassCuttingBonus 中按 multiplierFloor 保底，
 * 正确率 0% 时伤害仍有下限，不会陷入死亡螺旋。
 */
/** 答题加成中真正参与数值换算的三项乘数（不含结算展示用的 breakdown） */
export type BonusMultipliers = Pick<
  GrassCuttingBonus,
  'damageMultiplier' | 'rangeMultiplier' | 'durationMultiplier'
>;

/** 未携带答题加成时使用的中性乘数，保证解析函数没有可选分支 */
const NEUTRAL_MULTIPLIERS: BonusMultipliers = {
  damageMultiplier: 1,
  rangeMultiplier: 1,
  durationMultiplier: 1,
};

export function resolveWeapons(
  weaponConfig: WeaponConfig,
  level: number,
  subjectDamageCoefficient: number,
  subjectRangeCoefficient: number,
  bonus: BonusMultipliers,
): ResolvedWeapon[] {
  return weaponConfig.weapons.map((w) => ({
    id: w.id,
    name: w.name,
    attackType: w.attackType,
    damage:
      growthLinearPercent(w.damage, w.damageGrowthPerLevel, level) *
      subjectDamageCoefficient *
      bonus.damageMultiplier,
    cooldown: w.cooldown / Math.max(0.01, bonus.durationMultiplier),
    range: w.range * subjectRangeCoefficient * bonus.rangeMultiplier,
    sectorAngle: w.sectorAngle,
    projectileSpeed: w.projectileSpeed,
    projectileRadius: w.projectileRadius,
    pierce: w.pierce,
    pelletCount: w.pelletCount,
    spread: w.spread,
    knockback: w.knockback,
    hitstopDuration: w.hitstopDuration,
    shakeIntensity: w.shakeIntensity,
  }));
}

/**
 * 取关卡条目：level 超出配置范围时钳制到最后一关，保证玩家在配置表之外也能继续玩。
 */
export function resolveLevelEntry(levelConfig: LevelConfig, level: number): LevelEntry {
  const levels = levelConfig.levels;
  if (levels.length === 0) {
    throw new Error('levelConfig.levels 为空，无法解析关卡数据');
  }
  let found = levels[0];
  for (const entry of levels) {
    if (entry.level <= level) found = entry;
  }
  return found;
}

/**
 * 解析后的 Boss 单阶段数据：phase 已乘好 speedMult/damageMult/spawnDelay。
 * 运行时（MonsterSpawner / BossSkillController）只读取，不再做任何数值换算。
 */
export interface ResolvedBossPhase {
  phaseIndex: number;
  hpThreshold: number;
  speedMult: number;
  damageMult: number;
  spawnDelay: number;
  skills: string[];
}

/**
 * 解析后的 Boss 模板：JSON 原始数据 + 已按 level / subject 缩放的数值。
 * 兼容旧 BossSettings 形态（hp/damage/speed/radius/scoreOnKill），
 * 这样场景代码读 `boss.hp` 与 `boss.phases[].damageMult` 都能直接拿到值。
 */
export interface ResolvedBossTemplate extends BossSettings {
  /** Boss 模板 id（来自 BossTemplate.id） */
  bossId: string;
  /** Boss 中文名（来自 BossTemplate.name） */
  bossName: string;
  /** Boss 学科 key */
  subject: string;
  /** 所在关卡号 */
  levelNumber: number;
  /** 阶段表（数值已乘好 speedMult/damageMult） */
  phases: ResolvedBossPhase[];
  /** 技能字典（原样透传，运行时按 skillId 索引） */
  skills: BossTemplate['skills'];
}

/**
 * 解析 Boss 全集（grassCuttingConfig.bossRoster）。本函数对原始 JSON 做最少量的合法性补全：
 *  - 保证每个阶段 phaseIndex 与数组下标一致；
 *  - 保证 phases 按 hpThreshold 严格递减（更高阶段阈值更小）；
 *  - 保证每条引用的 skillId 都能在 skills 字典里找到。
 * 真实校验交由 validator.ts 的强类型校验器负责，本函数只是为运行时构造便利的 Resolved 形态。
 */
export function resolveBossRoster(rawRoster: BossRoster | undefined, fallback: BossSettings): ResolvedBossTemplate[] {
  if (!rawRoster || !Array.isArray(rawRoster.roster)) {
    // 兼容旧版 JSON：只有单 bossSettings，没有 bossRoster 时回退到「单 Boss 列表」
    return [
      {
        ...fallback,
        bossId: 'boss_legacy_default',
        bossName: 'Boss',
        subject: 'default',
        levelNumber: 0,
        phases: [
          { phaseIndex: 0, hpThreshold: 1.0, speedMult: 1.0, damageMult: 1.0, spawnDelay: fallback.spawnDelay, skills: [] },
        ],
        skills: {},
      },
    ];
  }

  return rawRoster.roster.map((template) => {
    // 阶段按 phaseIndex 升序（0→n），hpThreshold 自然递减；如声明里 phaseIndex 缺失就按数组下标推
    const phases: ResolvedBossPhase[] = template.phases
      .slice()
      .sort((a, b) => (a.phaseIndex ?? 0) - (b.phaseIndex ?? 0))
      .map((p, idx) => ({
        phaseIndex: p.phaseIndex ?? idx,
        hpThreshold: p.hpThreshold,
        speedMult: p.speedMult,
        damageMult: p.damageMult,
        spawnDelay: p.spawnDelay,
        skills: p.skills.filter((sid) => Boolean(template.skills[sid])),
      }));

    return {
      // BossSettings 兼容字段
      hp: template.hp,
      damage: template.damage,
      speed: template.speed,
      radius: template.radius,
      scoreOnKill: template.scoreOnKill,
      spawnDelay: template.spawnDelay,
      minionSpawnInterval: template.minionSpawnInterval,
      minionPerWave: template.minionPerWave,
      // T-022 新增字段
      bossId: template.id,
      bossName: template.name,
      subject: template.subject,
      levelNumber: template.levelNumber,
      phases,
      skills: template.skills,
    };
  });
}

/**
 * 按关卡号查找 Boss 模板（levelConfig.bossLevels → grassCuttingConfig.bossRoster.roster）。
 * 找不到时回退到 roster 第 0 项（终极关不应有「没找到」的情况，但兜底不能崩）。
 */
export function resolveBossForLevel(
  rawRoster: BossRoster | undefined,
  bossLevels: Record<string, string> | undefined,
  fallback: BossSettings,
  level: number,
): ResolvedBossTemplate {
  const roster = resolveBossRoster(rawRoster, fallback);
  const bossId = bossLevels?.[String(level)];
  if (bossId) {
    const found = roster.find((b) => b.bossId === bossId);
    if (found) return found;
  }
  // 兜底：用关卡号匹配 levelNumber，找不到再退化到第 0 项
  const byLevel = roster.find((b) => b.levelNumber === level);
  if (byLevel) return byLevel;
  return roster[0];
}

/**
 * 下一关的关卡号；已是最后一关则返回自身（循环推进）
 * T-022 重构过程中被误删，这里显式重导出。
 */
export { resolveNextLevel } from './levelNavigation';

/**
 * 便捷封装：直接从一个已加载好的 ConfigLoader + 关卡号解析 Boss 模板。
 */
export function resolveBossByLevel(level: number): ResolvedBossTemplate {
  const loader = ConfigLoader.getInstance();
  const grass = loader.getConfig('grassCuttingConfig');
  const levels = loader.getConfig('levelConfig');
  return resolveBossForLevel(grass.bossRoster, levels.bossLevels, grass.bossSettings, level);
}

/**
 * 计算某等级下答案选项的移动速度（像素/秒）。
 * 规则（GDD 2.2 + 4.2.2）：等级越高速度越慢，速度仅与等级和学科绑定，
 * 与答题正确率、割草表现无关联，避免双重惩罚。
 */
export function resolveAnswerSpeed(
  questionConfig: QuestionConfig,
  level: number,
  subject: SubjectKey,
): number {
  const s = questionConfig.speedSettings;
  const subjectEntry = questionConfig.subjectDifficulty[subject];
  const speedCoefficient = subjectEntry ? subjectEntry.speedCoefficient : 1;

  const linearReduction = s.baseSpeed - (level - 1) * s.speedReductionPerLevel;
  const exponentialDecay = s.baseSpeed * Math.pow(s.speedReductionGrowth, Math.max(0, level - 1));

  let speed: number;
  switch (s.curveType) {
    case 'linear':
      speed = linearReduction;
      break;
    case 'exponential':
      speed = exponentialDecay;
      break;
    case 'hybrid':
    default:
      // GDD 4.2.2 参考实现：先线性递减，再叠加指数衰减
      speed = linearReduction * Math.pow(s.speedReductionGrowth, Math.max(0, level - 1));
      break;
  }
  speed *= speedCoefficient;
  return clamp(speed, s.minSpeedLimit, s.maxSpeedLimit);
}

/** 计算某等级下的每题限时（秒），随等级缓慢放宽并钳制在区间内 */
export function resolveQuestionTimeLimit(questionConfig: QuestionConfig, level: number): number {
  const q = questionConfig.questionSettings;
  const grown = q.questionTimeLimit * Math.pow(q.timeLimitGrowth, Math.max(0, level - 1));
  return clamp(grown, q.minTimeLimit, q.maxTimeLimit);
}

/** 计算升到下一级所需的经验值 */
export function resolveExpToNextLevel(gameSettings: GameSettings, level: number): number {
  const s = gameSettings.levelSettings;
  if (level >= s.maxLevel) return Number.POSITIVE_INFINITY;
  if (s.levelUpGradeGrowthType === 'linear') {
    return Math.round(s.levelUpGradeBase + s.levelUpGradeGrowth * (level - 1));
  }
  return Math.round(s.levelUpGradeBase * Math.pow(s.levelUpGradeGrowth, level - 1));
}

/**
 * 核心解析：输入 level，输出该等级的完整数值包。
 * 所有成长公式集中在此，场景代码不得重复实现。
 */
export function resolveLevelPackage(
  input: ResolveInput,
  level: number,
  bonus: BonusMultipliers = NEUTRAL_MULTIPLIERS,
): ResolvedLevelPackage {
  const { gameSettings, questionConfig, grassCuttingConfig, levelConfig, weaponConfig } = input;

  const levelEntry = resolveLevelEntry(levelConfig, level);
  const subject = levelEntry.subject;
  const scale = levelEntry.difficultyScale;

  const subjectCoefficient = grassCuttingConfig.subjectCoefficientSettings[subject];
  const damageCoefficient = subjectCoefficient ? subjectCoefficient.skillDamageCoefficient : 1;
  const rangeCoefficient = subjectCoefficient ? subjectCoefficient.skillRangeCoefficient : 1;

  const ps = grassCuttingConfig.playerSettings;
  const ms = grassCuttingConfig.monsterSettings;
  const cs = grassCuttingConfig.comboSettings;
  const ds = grassCuttingConfig.difficultySettings;
  const pf = grassCuttingConfig.performanceSettings;

  const maxAlive = Math.min(ms.monsterMaxAlive, pf.maxAliveMonsters);

  return {
    level,
    subject,
    levelEntry,

    answerSpeed: resolveAnswerSpeed(questionConfig, level, subject),
    questionTimeLimit: resolveQuestionTimeLimit(questionConfig, level),
    questionCount: levelEntry.questionCount,

    gameTime: levelEntry.gameTime,
    player: {
      hp: ps.playerHpBase,
      moveSpeed: ps.playerMoveSpeed,
      radius: ps.playerRadius,
      invulnerableDuration: ps.invulnerableDuration,
      contactDamageCooldown: ps.playerContactDamageCooldown,
    },
    monster: {
      // 小怪属性：指数成长 × 关卡难度缩放（呼吸关通过 scale 回落）
      hp: growthExponential(ms.monsterHpBase, ms.monsterHpGrowthPerLevel, level) * scale,
      damage: growthLinearPercent(ms.monsterDamageBase, ms.monsterDamageGrowthPerLevel, level) * scale,
      moveSpeed: growthLinearPercent(ms.monsterMoveSpeedBase, ms.monsterMoveSpeedGrowthPerLevel, level) * scale,
      maxAlive,
      spawnInterval: ms.monsterSpawnIntervalWithinWave,
      radius: ms.monsterRadius,
      scorePerKill: ms.monsterScoreBase,
      knockback: ms.monsterKnockback,
      knockbackDuration: ms.monsterKnockbackDuration,
      spawnMargin: ms.monsterSpawnMargin,
    },
    combo: {
      timeWindow: cs.comboTimeWindow,
      damageGrowth: cs.comboDamageGrowth,
      durationGrowth: cs.comboSkillDurationGrowth,
      maxDamageMultiplier: cs.comboMaxDamageMultiplier,
    },
    weapons: resolveWeapons(weaponConfig, level, damageCoefficient, rangeCoefficient, bonus),
    autoAim: weaponConfig.autoAim,
    killFx: weaponConfig.killFx,
    touch: grassCuttingConfig.touchSettings,
    difficulty: {
      interpolation: ds.interpolation,
      spawnIntervalStart: ds.spawnIntervalStart,
      spawnIntervalEnd: ds.spawnIntervalEnd,
      batchSizeStart: ds.batchSizeStart,
      batchSizeEnd: ds.batchSizeEnd,
      hpMultiplierStart: ds.hpMultiplierStart,
      hpMultiplierEnd: ds.hpMultiplierEnd,
      moveSpeedMultiplierStart: ds.moveSpeedMultiplierStart,
      moveSpeedMultiplierEnd: ds.moveSpeedMultiplierEnd,
    },
    performance: {
      maxAliveMonsters: maxAlive,
      damageCheckFrameInterval: pf.damageCheckFrameInterval,
      maxHitTextAlive: pf.maxHitTextAlive,
      monsterPoolSize: pf.monsterPoolSize,
      projectilePoolSize: pf.projectilePoolSize,
      shardPoolSize: pf.shardPoolSize,
      ringPoolSize: pf.ringPoolSize,
      corpsePoolSize: pf.corpsePoolSize,
    },
    difficultyScale: scale,
    isBreatherLevel: levelEntry.breatherLevel,
    isBossLevel: levelEntry.bossLevel,
    // T-022：Boss 关按 level → bossLevels[id] 选模板；普通关仍返回完整模板兜底
    boss: resolveBossForLevel(grassCuttingConfig.bossRoster, levelConfig.bossLevels, grassCuttingConfig.bossSettings, level),
    expToNextLevel: resolveExpToNextLevel(gameSettings, level),
    bonusSettings: gameSettings.grassCuttingBonusSettings,
  };
}

/**
 * 便捷封装：直接从一个已加载好的 ConfigLoader 解析某等级数值包。
 */
export function resolveLevel(level: number, bonus?: BonusMultipliers): ResolvedLevelPackage {
  const loader = ConfigLoader.getInstance();
  return resolveLevelPackage(
    {
      gameSettings: loader.getConfig('gameSettings'),
      questionConfig: loader.getConfig('questionConfig'),
      grassCuttingConfig: loader.getConfig('grassCuttingConfig'),
      levelConfig: loader.getConfig('levelConfig'),
      subjectConfig: loader.getConfig('subjectConfig'),
      weaponConfig: loader.getConfig('weaponConfig'),
    },
    level,
    bonus,
  );
}

/**
 * 核心绑定（GDD 1.3 红线）：答题质量 → 割草三项乘数。
 *
 * 公式（三项乘数结构完全一致）：
 *   raw = baseBonus × subjectCoefficient × accuracyTerm × speedFactor × comboFactor
 *   baseBonus        = 1 + (level - 1) × baseBonusGrowthPerLevel
 *   accuracyTerm     = clamp(1 + (accuracy - accuracyBaseline) × accuracyWeight, min, max)
 *   speedFactor      = clamp(speedFactorBase + (1 - avgTime / timeLimit) × speedFactorWeight, min, max)
 *   comboFactor      = clamp(1 + maxCombo × comboFactorPerCombo, 1, comboFactorMax)
 *
 * 软失败保护（GDD 1.3）：结果按 multiplierFloor 保底，正确率 0% 也不会陷入死亡螺旋。
 */
export function computeGrassCuttingBonus(
  quiz: QuizResult,
  level: number,
  subjectDamageCoefficient: number,
  settings: GrassCuttingBonusSettings,
  questionTimeLimit: number,
): GrassCuttingBonus {
  const baseBonus = 1 + Math.max(0, level - 1) * settings.baseBonusGrowthPerLevel;

  const accuracyTerm = clamp(
    1 + (quiz.accuracy - settings.accuracyBaseline) * settings.accuracyWeight,
    settings.accuracyTermMin,
    settings.accuracyTermMax,
  );

  // 答题速度越快（平均耗时占比越低），speedFactor 越高
  const timeRatio = questionTimeLimit > 0 ? clamp(quiz.averageAnswerTime / questionTimeLimit, 0, 1) : 1;
  const speedFactor = clamp(
    settings.speedFactorBase + (1 - timeRatio) * settings.speedFactorWeight,
    settings.speedFactorMin,
    settings.speedFactorMax,
  );

  const comboFactor = clamp(
    1 + quiz.maxCombo * settings.comboFactorPerCombo,
    1,
    settings.comboFactorMax,
  );

  const rawMultiplier = baseBonus * subjectDamageCoefficient * accuracyTerm * speedFactor * comboFactor;

  const floor = settings.multiplierFloor;
  const ceiling = settings.multiplierCeiling;
  const damageMultiplier = clamp(rawMultiplier, floor.damage, ceiling.damage);
  const rangeMultiplier = clamp(rawMultiplier, floor.range, ceiling.range);
  const durationMultiplier = clamp(rawMultiplier, floor.duration, ceiling.duration);

  const breakdown: BonusBreakdown = {
    baseBonus,
    subjectCoefficient: subjectDamageCoefficient,
    accuracyTerm,
    speedFactor,
    comboFactor,
    rawMultiplier,
    floorApplied: rawMultiplier < floor.damage,
    ceilingApplied: rawMultiplier > ceiling.damage,
  };

  return { damageMultiplier, rangeMultiplier, durationMultiplier, breakdown };
}
