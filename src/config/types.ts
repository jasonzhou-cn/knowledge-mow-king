/**
 * 配置类型定义（src/config/types.ts）
 * 职责：为 public/config/ 下的全部 JSON 配置提供完整 TypeScript interface 定义，
 *      实现「强类型校验原则」的编译期部分。所有游戏数值的类型来源唯一在此文件。
 * 约束：任何新增配置项必须先在此登记，再写进 JSON，否则校验器会报「未知字段」。
 */

/** 配置模块名，与 public/config/ 下的文件名一一对应（不含 .json） */
export type ConfigModuleName =
  | 'gameSettings'
  | 'questionConfig'
  | 'grassCuttingConfig'
  | 'levelConfig'
  | 'rewardConfig'
  | 'subjectConfig'
  | 'questionBank'
  | 'weaponConfig';

/** 学科 key：刻意使用 string 而非字面量联合，保证新增学科只改 JSON 不改代码 */
export type SubjectKey = string;

/** 三项割草乘数（伤害 / 范围 / 持续时间），结构完全一致 */
export interface MultiplierTriplet {
  damage: number;
  range: number;
  duration: number;
}

// ───────────────────────────── gameSettings.json ─────────────────────────────

export interface LevelSettings {
  maxLevel: number;
  levelUpGradeBase: number;
  levelUpGradeGrowth: number;
  levelUpGradeGrowthType: 'linear' | 'exponential';
}

export interface RewardSettings {
  dailyRewardLimit: number;
  singleRewardLimit: number;
  consecutiveRewardBase: number;
  consecutiveRewardGrowth: number;
}

export interface OtherSettings {
  defaultGameTime: number;
  maxGameTimeLimit: number;
  minGameTimeLimit: number;
  subjectUnlockLevel: Record<SubjectKey, number>;
}

/** 答题质量 → 割草加成的公式参数（全部外置，便于调手感） */
export interface GrassCuttingBonusSettings {
  baseBonusGrowthPerLevel: number;
  accuracyBaseline: number;
  accuracyWeight: number;
  accuracyTermMin: number;
  accuracyTermMax: number;
  speedFactorBase: number;
  speedFactorWeight: number;
  speedFactorMin: number;
  speedFactorMax: number;
  comboFactorPerCombo: number;
  comboFactorMax: number;
  multiplierFloor: MultiplierTriplet;
  multiplierCeiling: MultiplierTriplet;
}

export interface GameSettings {
  version: string;
  levelSettings: LevelSettings;
  rewardSettings: RewardSettings;
  otherSettings: OtherSettings;
  grassCuttingBonusSettings: GrassCuttingBonusSettings;
}

// ──────────────────────────── questionConfig.json ────────────────────────────

export type SpeedCurveType = 'linear' | 'exponential' | 'hybrid';

export interface SpeedSettings {
  /** hybrid=同时应用线性递减与指数衰减（GDD 4.2.2 参考实现），linear / exponential 为单一曲线 */
  curveType: SpeedCurveType;
  baseSpeed: number;
  minSpeedLimit: number;
  maxSpeedLimit: number;
  speedReductionPerLevel: number;
  speedReductionGrowth: number;
}

export interface QuestionSettings {
  questionCountPerRound: number;
  questionTimeLimit: number;
  timeLimitGrowth: number;
  maxTimeLimit: number;
  minTimeLimit: number;
  correctBonusTime: number;
  consecutiveCorrectThreshold: number;
}

export type MovementType = 'circular' | 'linear';

/**
 * 答题交互模式：
 *  - 'arrow'：答案固定不动，高亮框在选项间循环跳转，玩家在目标选项高亮时确认
 *             （降低儿童认知负荷：只需追踪一个移动箭头，不用盯 4 个移动答案）
 *  - 'track'：原「Stop the Cloud」式移动轨道，玩家点击停住做重叠判定
 *  - 'cursor'：答案固定不动，一个高亮游标在选项间持续平滑往返移动，
 *              玩家主动停住时按游标当前位置判定（停在哪张判定框内 → 选哪个）
 *              （结合「游标移动 + 用户停住」两个交互元素，9-18 岁儿童熟悉）
 */
export type AnswerMode = 'arrow' | 'track' | 'cursor';

export interface AnswerSettings {
  /** 交互模式：arrow=固定答案+箭头循环选择（默认）；track=移动轨道+停住判定 */
  mode: AnswerMode;
  movementType: MovementType;
  movementEasing: 'linear';
  stopThreshold: number;
  overlapThreshold: number;
  bounceVelocity: number;
  dragDamping: number;
  optionCardWidth: number;
  optionCardHeight: number;
  trackCenterX: number;
  trackCenterY: number;
  trackRadiusX: number;
  trackRadiusY: number;
  linearTrackSpan: number;
  selectionZoneWidth: number;
  selectionZoneHeight: number;
  stopSettleDuration: number;
  /** 答对 / 答错高亮的停留时长（秒） */
  feedbackHoldDuration: number;
  /** 解析说明的停留时长（秒），教育价值的体现，给玩家读懂错因的时间 */
  explanationHoldDuration: number;
  /** 箭头模式：高亮框跳转到下一个选项的间隔（秒） */
  arrowInterval: number;
  /** 箭头模式：选项布局——row=一行 4 个（箭头左右扫掠）；grid=2×2 网格 */
  arrowLayout: 'row' | 'grid';
  /** 游标模式：游标在 4 个答案间往返一轮的时长（秒）——越小越难 */
  cursorCycleDuration: number;
  /** 游标模式：判定框宽度（每张卡片中央的小框，px）；越大越容易命中 */
  cursorHitZoneWidth: number;
  /** 游标模式：判定框高度（每张卡片中央的小框，px） */
  cursorHitZoneHeight: number;
}

export interface SubjectDifficultyEntry {
  difficultyCoefficient: number;
  speedCoefficient: number;
}

/** 按等级分档的题目难度抽取权重，键为难度档字符串 "1" | "2" | "3" */
export type DifficultyWeights = Record<string, number>;

export interface DifficultySelection {
  /** 等级 ≤ lowLevelMax 时使用 weightsLow */
  lowLevelMax: number;
  /** 等级 ≤ midLevelMax 时使用 weightsMid，更高等级使用 weightsHigh */
  midLevelMax: number;
  weightsLow: DifficultyWeights;
  weightsMid: DifficultyWeights;
  weightsHigh: DifficultyWeights;
}

export interface QuestionConfig {
  version: string;
  speedSettings: SpeedSettings;
  questionSettings: QuestionSettings;
  answerSettings: AnswerSettings;
  subjectDifficulty: Record<SubjectKey, SubjectDifficultyEntry>;
  difficultySelection: DifficultySelection;
}

// ───────────────────────── grassCuttingConfig.json ─────────────────────────

export interface PlayerSettings {
  playerHpBase: number;
  playerMoveSpeed: number;
  playerRadius: number;
  invulnerableDuration: number;
  playerContactDamageCooldown: number;
}

export interface MonsterSettings {
  monsterHpBase: number;
  monsterHpGrowthPerLevel: number;
  monsterDamageBase: number;
  monsterDamageGrowthPerLevel: number;
  monsterMoveSpeedBase: number;
  monsterMoveSpeedGrowthPerLevel: number;
  monsterSpawnIntervalWithinWave: number;
  monsterRadius: number;
  monsterMaxAlive: number;
  monsterSpawnMargin: number;
  monsterScoreBase: number;
  /** 接触击退速度（像素/秒） */
  monsterKnockback: number;
  /** 接触击退持续时长（秒） */
  monsterKnockbackDuration: number;
}

export interface ComboSettings {
  comboTimeWindow: number;
  comboDamageGrowth: number;
  comboSkillDurationGrowth: number;
  comboMaxDamageMultiplier: number;
}

/** 难度曲线插值方式：linear=线性，smoothstep=两端缓入缓出 */
export type DifficultyInterpolation = 'linear' | 'smoothstep';

/**
 * 生存关的时间驱动难度曲线。
 * t = 已用时间 / 本关总时长（0~1），各维在 [start, end] 之间按 interpolation 插值。
 */
export interface DifficultySettings {
  interpolation: DifficultyInterpolation;
  /** 每批小怪的时间间隔（秒） */
  spawnIntervalStart: number;
  spawnIntervalEnd: number;
  /** 每批生成的小怪数量 */
  batchSizeStart: number;
  batchSizeEnd: number;
  /** 生成时套用到基础血量上的倍率 */
  hpMultiplierStart: number;
  hpMultiplierEnd: number;
  /** 生成时套用到基础移速上的倍率 */
  moveSpeedMultiplierStart: number;
  moveSpeedMultiplierEnd: number;
}

export interface PerformanceSettings {
  maxAliveMonsters: number;
  damageCheckFrameInterval: number;
  maxHitTextAlive: number;
  monsterPoolSize: number;
  /** 弹丸对象池上限 */
  projectilePoolSize: number;
  /** 击杀碎片对象池上限 */
  shardPoolSize: number;
  /** 击杀扩散圆环对象池上限 */
  ringPoolSize: number;
  /** 击杀后尸体飞散的同屏上限 */
  corpsePoolSize: number;
}

/**
 * Boss 关数值（bossLevel=true 的关卡生效）。
 * 数值全部外置（GDD 1.4），代码不写死任何 Boss 属性。
 */
export interface BossSettings {
  /** Boss 生命值 */
  hp: number;
  /** 接触伤害 */
  damage: number;
  /** 移动速度（像素/秒） */
  speed: number;
  /** 碰撞半径（像素），也决定精灵显示尺寸 */
  radius: number;
  /** 击杀奖励分数 */
  scoreOnKill: number;
  /** 开局多少秒后生成 Boss */
  spawnDelay: number;
  /** Boss 存活期间，小怪每批刷新的间隔（秒） */
  minionSpawnInterval: number;
  /** Boss 存活期间，每批刷新的小怪数量 */
  minionPerWave: number;
}

// ───────────────────── T-022 5 Boss × 3 阶段化系统 ─────────────────────

/** Boss 技能类型。代码只读取 type 字段并 switch 到对应实现，所有数值仍在 JSON 里 */
export type BossSkillType =
  | 'ranged'
  | 'slam'
  | 'summon'
  | 'charge'
  | 'doomZone'
  | 'dashBarrage';

/** 单条技能配置（union 形状：每种 type 关心的字段不同，用可选字段表达） */
export interface SkillConfig {
  /** 技能类型（dispatch 关键字） */
  type: BossSkillType;
  /** 冷却时间（秒） */
  cooldown: number;
  /** 技能展示色（#RRGGBB），运行时按此用 Graphics 程序化生成 */
  color: string;

  // ranged：远程弹丸
  projectileSpeed?: number;
  projectileRadius?: number;
  /** 单次弹丸伤害 */
  damage?: number;
  /** 单发飞行最大距离 */
  range?: number;
  /** 多发撒射数量（ranged_spread 风格） */
  pelletCount?: number;
  /** 散布总张角（度） */
  spread?: number;

  // slam：AOE 范围攻击
  duration?: number;
  /** AOE / doomZone 半径（像素） */
  radius?: number;

  // charge / dashBarrage：冲刺
  speed?: number;
  /** dashBarrage 的冲刺次数 */
  dashes?: number;
  /** dashBarrage 单次冲刺时长（秒） */
  dashDuration?: number;
  /** dashBarrage 两次冲刺间隔（秒） */
  dashGap?: number;
  /** dashBarrage 单次冲刺速度（像素/秒，区别于 charge.speed 的「瞬时位移速度」） */
  dashSpeed?: number;

  // doomZone：持续伤害区域
  /** 单跳伤害（player 站在区域内受到的伤害） */
  tickInterval?: number;
  /** 减速系数 0~1（可选，time_freeze_trap 用） */
  slowFactor?: number;

  // summon：召唤小怪
  count?: number;
  hpMultiplier?: number;
}

/** 单个 Boss 阶段配置 */
export interface BossPhase {
  /** 阶段序号 0..n（0 为初始阶段） */
  phaseIndex: number;
  /** HP 比例阈值：进入此阶段时 boss.hp/maxHp ≤ threshold */
  hpThreshold: number;
  /** 移速倍率 */
  speedMult: number;
  /** 伤害倍率 */
  damageMult: number;
  /** 该阶段 Boss 的攻击间隔（Boss 自身出手节拍） */
  spawnDelay: number;
  /** 该阶段激活的技能 id 列表 */
  skills: string[];
}

/** 单个 Boss 模板（一整套数值 + 阶段 + 技能字典） */
export interface BossTemplate {
  id: string;
  name: string;
  /** 学科 key（'math' | 'english' | 'science' | 'ultimate'） */
  subject: string;
  /** 所在关卡 */
  levelNumber: number;
  hp: number;
  damage: number;
  speed: number;
  radius: number;
  scoreOnKill: number;
  spawnDelay: number;
  minionSpawnInterval: number;
  minionPerWave: number;
  /** 阶段表（hpThreshold 必须严格递增，phaseIndex 与数组下标一致） */
  phases: BossPhase[];
  /** 技能字典：key = skillId */
  skills: Record<string, SkillConfig>;
}

/** Boss 公共配置：所有 Boss 共享的「相同时长类」参数 */
export interface BossCommonConfig {
  /** 最大阶段数（理论上不超过 4，4 给「考神」用） */
  maxPhases: number;
  /** 技能视觉默认存续（秒，DoomZone 之类以这个为占位） */
  skillVisualTtl: number;
  /** 技能施法警告持续（秒，预留） */
  skillCastWarnDuration: number;
}

/** Boss 全集：common 公共配置 + roster 模板列表 */
export interface BossRoster {
  common: BossCommonConfig;
  roster: BossTemplate[];
}

/** Boss 沙雕过场文案钩子（死亡/阶段切换/入场） */
export interface BossDialogueEntry {
  intro: Record<string, string>;
  phase: Record<string, string[]>;
  death: Record<string, string>;
}

/**
 * 解析后的单阶段 Boss 运行时数据（由 BossTemplate 的某个 phase 展开而来）。
 * 数值已乘上 phase 的 speedMult/damageMult/spawnDelay，可直接被 MonsterSpawner 消费。
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
export interface ResolvedBossTemplate {
  bossId: string;
  bossName: string;
  subject: string;
  levelNumber: number;
  hp: number;
  damage: number;
  speed: number;
  radius: number;
  scoreOnKill: number;
  spawnDelay: number;
  minionSpawnInterval: number;
  minionPerWave: number;
  phases: ResolvedBossPhase[];
  skills: Record<string, SkillConfig>;
}

export interface SubjectCoefficientEntry {
  skillDamageCoefficient: number;
  skillRangeCoefficient: number;
}

/**
 * 触屏操作设置（移动端虚拟摇杆）。
 * 坐标基于逻辑分辨率 960×640，摇杆中心须落在左下角安全区（避开底部居中的武器栏热区）。
 */
export interface TouchSettings {
  /** 摇杆底座圆心 x */
  joystickCenterX: number;
  /** 摇杆底座圆心 y */
  joystickCenterY: number;
  /** 摇杆底座半径 */
  joystickBaseRadius: number;
  /** 摇杆头（可拖动的手柄）半径 */
  joystickKnobRadius: number;
  /** 死区半径：位移小于该值时不产生移动，避免手指轻微抖动导致角色漂移 */
  joystickDeadZone: number;
  /** 未激活时的整体透明度 */
  joystickIdleAlpha: number;
  /** 激活（正在拖动）时的整体透明度 */
  joystickActiveAlpha: number;
}

export interface GrassCuttingConfig {
  version: string;
  touchSettings: TouchSettings;
  playerSettings: PlayerSettings;
  monsterSettings: MonsterSettings;
  comboSettings: ComboSettings;
  difficultySettings: DifficultySettings;
  performanceSettings: PerformanceSettings;
  /** Boss 关数值（levelConfig 里 bossLevel=true 的关卡消费） */
  bossSettings: BossSettings;
  /** T-022 Boss 全集：common 公共配置 + roster 模板列表 */
  bossRoster?: BossRoster;
  /** T-022 Boss 沙雕过场文案钩子（红线条目：内容由 T-024 content-builder 填，本任务先建 schema） */
  bossDialogue?: BossDialogueEntry;
  subjectCoefficientSettings: Record<SubjectKey, SubjectCoefficientEntry>;
}

// ──────────────────────────── weaponConfig.json ────────────────────────────

/** 武器攻击形态：近战扇形 / 远程单发 / 远程多发散布 */
export type WeaponAttackType = 'melee_sector' | 'ranged_bolt' | 'ranged_spread';

/** 单把武器的全部数值（GDD 1.4：零硬编码，全部来自 JSON） */
export interface WeaponEntry {
  /** 稳定标识，代码与贴图 key 都以此为锚点 */
  id: string;
  name: string;
  attackType: WeaponAttackType;
  /** 单次命中的基础伤害 */
  damage: number;
  /** 出手间隔（秒），会被答题「持续」乘数缩减 */
  cooldown: number;
  /** 近战=扇形半径；远程=弹丸最大飞行距离 */
  range: number;
  /** 近战扇形张角（度），远程武器忽略 */
  sectorAngle: number;
  /** 弹丸速度（像素/秒），近战武器忽略 */
  projectileSpeed: number;
  /** 弹丸命中判定半径（像素），近战武器填 0（用扇形判定） */
  projectileRadius: number;
  /** 可穿透的小怪数量，0=命中即消失 */
  pierce: number;
  /** 一次出手发射的弹丸数，近战武器固定 1 */
  pelletCount: number;
  /** 散射总张角（度），单发武器用作随机抖动幅度 */
  spread: number;
  /** 命中击退速度（像素/秒） */
  knockback: number;
  /** 等级成长系数：damage × (1 + growth × (level - 1)) */
  damageGrowthPerLevel: number;
  /** 击杀顿帧时长（毫秒） */
  hitstopDuration: number;
  /** 击杀时的相机震动强度，受 killFx.cameraShakeEnabled 开关约束 */
  shakeIntensity: number;
}

/** 自动瞄准设置：锁定最近敌人，避免玩家被「朝向操作」拖住 */
export interface AutoAimSettings {
  enabled: boolean;
  /** 搜索半径（像素），超出则用移动朝向 */
  searchRadius: number;
  /** 瞄准辅助的最大转向速率（度/秒），避免朝向瞬移造成的视觉抖动 */
  aimAssistAngle: number;
}

/** 击杀打击感设置（顿帧 / 爆散 / 闪白 / 强化击退） */
export interface KillFxSettings {
  /** 顿帧总开关（无障碍与低端机可关） */
  hitstopEnabled: boolean;
  /** 顿帧期间的时间缩放，越小越「卡肉」 */
  hitstopTimeScale: number;
  shardCount: number;
  shardSize: number;
  shardSpeed: number;
  /** 碎片存活时长（秒） */
  shardLife: number;
  /** 击杀白闪时长（毫秒） */
  flashDuration: number;
  /** 受击闪白时长（毫秒） */
  hitFlashDuration: number;
  /** 击杀时击退力相对受击击退的倍率 */
  killKnockbackMultiplier: number;
  ringFromScale: number;
  ringToScale: number;
  /** 扩散圆环时长（毫秒） */
  ringDuration: number;
  /** 击杀后小怪「尸体」沿命中方向飞出的存活时长（秒），0=不飞散 */
  corpseLife: number;
  /** 尸体飞散时的自转角速度（弧度/秒） */
  corpseSpin: number;
  /** 尸体飞散速度的阻尼系数（越大减速越快） */
  corpseDrag: number;
  /**
   * 两次顿帧之间的最小真实间隔（毫秒）。
   * 顿帧期间不叠加新请求，且必须等够这个间隔才能再次触发，
   * 避免高频击杀把游戏卡成永久慢动作。
   */
  hitstopMinInterval: number;
  /** 碎片飞散速度的阻尼系数（越大减速越快） */
  shardDrag: number;
  /** 相机震动总开关（GDD 1.2：camera.shake 受限使用且必须可关闭） */
  cameraShakeEnabled: boolean;
  /** 伤害数字升档的连击门槛（大） */
  comboBigThreshold: number;
  /** 伤害数字升档的连击门槛（特大） */
  comboHugeThreshold: number;
}

export interface WeaponConfig {
  version: string;
  autoAim: AutoAimSettings;
  killFx: KillFxSettings;
  weapons: WeaponEntry[];
}

// ───────────────────────────── levelConfig.json ─────────────────────────────

export type PrimaryDimension =
  | 'none'
  | 'monsterHp'
  | 'monsterCount'
  | 'monsterSpeed'
  | 'answerSpeed';

export interface LevelEntry {
  level: number;
  name: string;
  subject: SubjectKey;
  unlockCondition: string;
  questionCount: number;
  bossLevel: boolean;
  breatherLevel: boolean;
  difficultyScale: number;
  gameTime: number;
  primaryDimension: PrimaryDimension;
  nextLevelUnlockCondition: string;
}

export interface LevelDifficultyGrowth {
  questionCountGrowth: number;
  difficultyScaleStep: number;
  breatherInterval: number;
}

export interface LevelConfig {
  version: string;
  levels: LevelEntry[];
  levelDifficultyGrowth: LevelDifficultyGrowth;
  /**
   * T-022：Boss 关 → Boss 模板 id 的索引。
   * key 为字符串形式的关卡号（与 levelConfig.levels[].level 一致），
   * value 为 grassCuttingConfig.bossRoster.roster[].id。
   * Boss 关改用此索引定位模板，取代旧「单一 bossSettings」机制。
   */
  bossLevels?: Record<string, string>;
}

// ──────────────────────────── rewardConfig.json ────────────────────────────

export interface ComboRewardEntry {
  combo: number;
  rewardTime: number;
  rewardSkillDuration: number;
}

export interface OtherRewards {
  perfectAnswerReward: number;
  fastAnswerReward: number;
  fastAnswerTimeThreshold: number;
  noDamageReward: number;
}

export interface ScoreSettings {
  scorePerKill: number;
  scorePerCorrectAnswer: number;
  scoreComboBonusPerCombo: number;
  expPerKill: number;
  expPerCorrectAnswer: number;
  expLevelClearBonus: number;
}

export interface RewardLimits {
  dailyRewardTimeMax: number;
  singleRewardTimeMax: number;
  comboRewardTimeMax: number;
}

export interface RewardConfig {
  version: string;
  comboRewards: ComboRewardEntry[];
  otherRewards: OtherRewards;
  scoreSettings: ScoreSettings;
  rewardLimits: RewardLimits;
}

// ─────────────────────────── subjectConfig.json ───────────────────────────

export interface SubjectEntry {
  displayName: string;
  unlockLevel: number;
  /** 主题色，#RRGGBB 字符串，运行时由 Palette 解析为数值 */
  themeColor: string;
  accentColor: string;
  skillName: string;
  description: string;
}

export interface SubjectConfig {
  version: string;
  subjects: Record<SubjectKey, SubjectEntry>;
}

// ─────────────────────────── questionBank.json ───────────────────────────

export interface QuestionEntry {
  id: string;
  subject: SubjectKey;
  difficulty: number;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  /** 解题思路（T-016）：儿童友好语言，说明正确答案的关键判断依据，答错时展示 */
  solution: string;
}

export interface QuestionBank {
  version: string;
  description: string;
  questions: QuestionEntry[];
}

/**
 * 答题结果 → 割草属性的三大乘数。
 * 三者由同一公式算出、结构完全一致，仅钳制区间不同（见 resolve.ts computeGrassCuttingBonus）。
 */
export interface GrassCuttingBonus {
  damageMultiplier: number;
  rangeMultiplier: number;
  durationMultiplier: number;
  /** 计算过程拆解，供结算面板透明展示来源 */
  breakdown: import('./resolve').BonusBreakdown;
}

/** 所有配置模块的联合类型表，ConfigLoader.getConfig<T> 的索引来源 */
export interface ConfigModuleMap {
  gameSettings: GameSettings;
  questionConfig: QuestionConfig;
  grassCuttingConfig: GrassCuttingConfig;
  levelConfig: LevelConfig;
  rewardConfig: RewardConfig;
  subjectConfig: SubjectConfig;
  questionBank: QuestionBank;
  weaponConfig: WeaponConfig;
}
