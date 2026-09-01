/**
 * 配置强类型校验器（src/config/validator.ts）
 * 职责：在配置进入游戏前完成「存在性 + 类型 + 数值区间 + 跨表关联合法性」四层检测，
 *      失败时抛出明确的中文错误并阻断启动，绝不允许脏配置进入运行环境（GDD 1.4 强类型校验原则）。
 * 设计：手写轻量校验器，不引入 zod 等额外依赖；错误全部收集后一次性抛出，便于一次性修完所有问题。
 */

import type { ConfigModuleMap, ConfigModuleName } from './types';

/** 单条配置错误：定位到「文件 → 字段路径 → 具体原因」 */
export interface ConfigIssue {
  file: ConfigModuleName;
  path: string;
  message: string;
}

/** 聚合后的配置校验异常，message 为可直接展示给开发者的中文报告 */
export class ConfigValidationError extends Error {
  public readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super(ConfigValidationError.composeMessage(issues));
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }

  /** 把错误列表拼成人类可读的中文报告 */
  private static composeMessage(issues: ConfigIssue[]): string {
    const header = `配置校验失败，共发现 ${issues.length} 处问题，游戏已阻断启动：\n`;
    const body = issues
      .map((it, i) => `  ${i + 1}. [${it.file}] ${it.path}\n     → ${it.message}`)
      .join('\n');
    return header + body;
  }
}

interface NumberRule {
  min?: number;
  max?: number;
  integer?: boolean;
  /** 是否允许等于边界，默认允许（闭区间） */
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
}

/** 校验上下文：累积 issues，提供一组「取并校验」的原语 */
class Validator {
  public readonly issues: ConfigIssue[] = [];

  constructor(public readonly file: ConfigModuleName) {}

  /** 记录一条错误 */
  private fail(path: string, message: string): void {
    this.issues.push({ file: this.file, path, message });
  }

  isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /** 取子对象；缺失或类型错误时返回空对象并记录，保证后续校验能继续跑完 */
  object(parent: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
    const value = parent[key];
    if (!this.isRecord(value)) {
      this.fail(path, `应为对象（object），实际为 ${describeType(value)}`);
      return {};
    }
    return value;
  }

  /** 取数组；可校验最小长度 */
  array(parent: Record<string, unknown>, key: string, path: string, minLen = 0): unknown[] {
    const value = parent[key];
    if (!Array.isArray(value)) {
      this.fail(path, `应为数组（array），实际为 ${describeType(value)}`);
      return [];
    }
    if (value.length < minLen) {
      this.fail(path, `数组至少需要 ${minLen} 项，实际只有 ${value.length} 项`);
    }
    return value;
  }

  /** 取数值并按区间规则校验 */
  number(
    parent: Record<string, unknown>,
    key: string,
    path: string,
    rule: NumberRule = {},
  ): number {
    const value = parent[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(path, `应为有限数值（number），实际为 ${describeType(value)}`);
      return rule.min ?? 0;
    }
    if (rule.integer && !Number.isInteger(value)) {
      this.fail(path, `应为整数（integer），实际为 ${value}`);
    }
    if (rule.min !== undefined) {
      const ok = rule.exclusiveMin ? value > rule.min : value >= rule.min;
      if (!ok) {
        this.fail(path, `应${rule.exclusiveMin ? '大于' : '不小于'} ${rule.min}，实际为 ${value}`);
      }
    }
    if (rule.max !== undefined) {
      const ok = rule.exclusiveMax ? value < rule.max : value <= rule.max;
      if (!ok) {
        this.fail(path, `应${rule.exclusiveMax ? '小于' : '不大于'} ${rule.max}，实际为 ${value}`);
      }
    }
    return value;
  }

  /** 取整数 */
  integer(
    parent: Record<string, unknown>,
    key: string,
    path: string,
    rule: NumberRule = {},
  ): number {
    return this.number(parent, key, path, { ...rule, integer: true });
  }

  /** 取非空字符串；enum 非空时还需命中允许值 */
  string(
    parent: Record<string, unknown>,
    key: string,
    path: string,
    enumValues?: readonly string[],
  ): string {
    const value = parent[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      this.fail(path, `应为非空字符串（string），实际为 ${describeType(value)}`);
      return '';
    }
    if (enumValues && enumValues.length > 0 && !enumValues.includes(value)) {
      this.fail(path, `取值非法，允许范围为 [${enumValues.join(' | ')}]，实际为 "${value}"`);
    }
    return value;
  }

  /** 取布尔值 */
  boolean(parent: Record<string, unknown>, key: string, path: string): boolean {
    const value = parent[key];
    if (typeof value !== 'boolean') {
      this.fail(path, `应为布尔值（boolean），实际为 ${describeType(value)}`);
      return false;
    }
    return value;
  }

  /** 取 #RRGGBB 颜色字符串 */
  hexColor(parent: Record<string, unknown>, key: string, path: string): string {
    const value = parent[key];
    if (typeof value !== 'string' || !/^#([0-9a-fA-F]{6})$/.test(value.trim())) {
      this.fail(path, `应为 #RRGGBB 格式的十六进制颜色，实际为 ${describeType(value)}`);
      return '#ff00ff';
    }
    return value.trim();
  }

  /** 手动追加一条业务级关联错误 */
  custom(path: string, message: string): void {
    this.fail(path, message);
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * 跨表关联校验用的宽松读取工具。
 * 这些函数不会报错，只负责「安全地取出原值」，真正的类型错误由各模块的严格校验负责提示，
 * 这样即使某张表字段写错，关联校验依然能给出准确的中文定位而不是崩溃。
 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 校验全部配置模块。
 * @param raw 以模块名为键的原始 JSON 数据（尚未做类型断言）
 * @throws ConfigValidationError 任何一项不合法时抛出，阻断启动
 */
export function validateAllConfigs(raw: Record<ConfigModuleName, unknown>): void {
  const issues: ConfigIssue[] = [];

  const modules: ConfigModuleName[] = [
    'gameSettings',
    'questionConfig',
    'grassCuttingConfig',
    'levelConfig',
    'rewardConfig',
    'subjectConfig',
    'questionBank',
    'weaponConfig',
  ];
  for (const name of modules) {
    if (raw[name] === undefined || raw[name] === null) {
      issues.push({ file: name, path: '(整个文件)', message: '配置文件缺失或为空，无法加载' });
    }
  }
  if (issues.length > 0) throw new ConfigValidationError(issues);

  const game = validateGameSettings(raw.gameSettings);
  const question = validateQuestionConfig(raw.questionConfig);
  const grass = validateGrassCuttingConfig(raw.grassCuttingConfig);
  const level = validateLevelConfig(raw.levelConfig);
  const reward = validateRewardConfig(raw.rewardConfig);
  const subject = validateSubjectConfig(raw.subjectConfig);
  const bank = validateQuestionBank(raw.questionBank);
  const weapon = validateWeaponConfig(raw.weaponConfig);

  issues.push(
    ...game.issues,
    ...question.issues,
    ...grass.issues,
    ...level.issues,
    ...reward.issues,
    ...subject.issues,
    ...bank.issues,
    ...weapon.issues,
  );

  // ───────────── 跨表关联校验（GDD 1.4 多表关联原则） ─────────────
  // 关联校验直接读原始 JSON（而不是各模块的 Validator 实例），
  // 这样即使某张表的字段类型写错，关联检查依然能给出准确的中文定位。
  const cross = new Validator('gameSettings');

  const subjectKeys = new Set(Object.keys(asRecord(asRecord(raw.subjectConfig).subjects)));
  const unlockKeys = new Set(
    Object.keys(asRecord(asRecord(asRecord(raw.gameSettings).otherSettings).subjectUnlockLevel)),
  );
  const difficultyKeys = new Set(Object.keys(asRecord(asRecord(raw.questionConfig).subjectDifficulty)));
  const coefficientKeys = new Set(
    Object.keys(asRecord(asRecord(raw.grassCuttingConfig).subjectCoefficientSettings)),
  );

  // 1. 四张表的学科 key 必须完全一致，否则解析时会出现 undefined 系数
  const allKeys = new Set<string>([
    ...subjectKeys,
    ...unlockKeys,
    ...difficultyKeys,
    ...coefficientKeys,
  ]);
  for (const key of allKeys) {
    const missing: string[] = [];
    if (!subjectKeys.has(key)) missing.push('subjectConfig.subjects');
    if (!unlockKeys.has(key)) missing.push('gameSettings.otherSettings.subjectUnlockLevel');
    if (!difficultyKeys.has(key)) missing.push('questionConfig.subjectDifficulty');
    if (!coefficientKeys.has(key)) missing.push('grassCuttingConfig.subjectCoefficientSettings');
    if (missing.length > 0) {
      cross.custom(
        `subject="${key}"`,
        `学科 key 在各表中不一致，缺失于：${missing.join('、')}。请保证四张表的学科 key 完全相同。`,
      );
    }
  }

  /** 关卡表解析结果（宽松解析，类型错误由各自的模块校验负责报错） */
  interface LooseLevel {
    level: number;
    subject: string;
    questionCount: number;
    primaryDimension: string;
  }
  const looseLevels: LooseLevel[] = readArray(asRecord(raw.levelConfig).levels).map((item) => {
    const r = asRecord(item);
    return {
      level: asNumber(r.level),
      subject: asString(r.subject),
      questionCount: asNumber(r.questionCount),
      primaryDimension: asString(r.primaryDimension),
    };
  });

  // 2. 关卡表引用的学科必须已定义
  for (const entry of looseLevels) {
    if (!subjectKeys.has(entry.subject)) {
      cross.custom(
        `levelConfig.levels[level=${entry.level}].subject`,
        `关卡引用了未定义的学科 "${entry.subject}"，可用学科为 [${[...subjectKeys].join(', ')}]`,
      );
    }
  }

  // 3. 题库学科必须已定义
  const bankSubjects = new Set(
    readArray(asRecord(raw.questionBank).questions)
      .map((q) => asString(asRecord(q).subject))
      .filter((s) => s.length > 0),
  );
  for (const key of bankSubjects) {
    if (!subjectKeys.has(key)) {
      cross.custom(
        `questionBank.questions[subject="${key}"]`,
        `题库引用了未定义的学科 "${key}"，可用学科为 [${[...subjectKeys].join(', ')}]`,
      );
    }
  }

  // 4. 关卡表必须至少配置一个学科，否则游戏无法开始
  const levelSubjects = new Set(looseLevels.map((e) => e.subject));
  if (levelSubjects.size === 0) {
    cross.custom('levelConfig.levels', '关卡表未配置任何学科，游戏无法开始');
  }

  // 4.5 学科解锁等级在 gameSettings 与 subjectConfig 中必须一致，防止两份数据漂移
  const unlockRaw = asRecord(asRecord(asRecord(raw.gameSettings).otherSettings).subjectUnlockLevel);
  const subjectsRaw = asRecord(asRecord(raw.subjectConfig).subjects);
  for (const key of Object.keys(subjectsRaw)) {
    const fromSettings = unlockRaw[key];
    const fromSubject = asRecord(subjectsRaw[key]).unlockLevel;
    if (typeof fromSettings === 'number' && typeof fromSubject === 'number' && fromSettings !== fromSubject) {
      cross.custom(
        `subject="${key}"`,
        `学科解锁等级不一致：gameSettings.otherSettings.subjectUnlockLevel 为 ${fromSettings}，subjectConfig.subjects.${key}.unlockLevel 为 ${fromSubject}`,
      );
    }
  }

  // 5. 奖励上限必须满足「单次 ≤ 每日」的常识约束
  const limits = asRecord(asRecord(raw.rewardConfig).rewardLimits);
  const singleMax = asNumber(limits.singleRewardTimeMax);
  const dailyMax = asNumber(limits.dailyRewardTimeMax);
  if (singleMax > dailyMax) {
    cross.custom(
      'rewardConfig.rewardLimits',
      `单次奖励上限（${singleMax}）不应大于每日奖励上限（${dailyMax}）`,
    );
  }

  // 6. 连对奖励门槛必须可达，且单档奖励不得超过单次上限
  const maxQuestionCount = looseLevels.reduce((max, e) => Math.max(max, e.questionCount), 0);
  const comboRewards = readArray(asRecord(raw.rewardConfig).comboRewards);
  for (const item of comboRewards) {
    const r = asRecord(item);
    const combo = asNumber(r.combo);
    const rewardTime = asNumber(r.rewardTime);
    if (combo > maxQuestionCount) {
      cross.custom(
        `rewardConfig.comboRewards[combo=${combo}]`,
        `连对门槛 ${combo} 超过了关卡最大题目数 ${maxQuestionCount}，该档奖励永远无法触发`,
      );
    }
    if (rewardTime > singleMax) {
      cross.custom(
        `rewardConfig.comboRewards[combo=${combo}].rewardTime`,
        `单档奖励时间 ${rewardTime} 超过单次奖励上限 ${singleMax}`,
      );
    }
  }

  // 7. 主升维度取值合法（GDD 2.3：每关只有一个主升维度，防止多维度同时膨胀）
  const allowedDimensions = ['none', 'monsterHp', 'monsterCount', 'monsterSpeed', 'answerSpeed'];
  for (const entry of looseLevels) {
    if (!allowedDimensions.includes(entry.primaryDimension)) {
      cross.custom(
        `levelConfig.levels[level=${entry.level}].primaryDimension`,
        `主升维度取值非法："${entry.primaryDimension}"，允许值为 [${allowedDimensions.join(' | ')}]`,
      );
    }
  }

  // 8. 答案速度区间必须足够宽，保证等级成长带来的速度变化可被感知
  const speedSettings = asRecord(asRecord(raw.questionConfig).speedSettings);
  const minSpeedLimit = asNumber(speedSettings.minSpeedLimit);
  const maxSpeedLimit = asNumber(speedSettings.maxSpeedLimit);
  if (maxSpeedLimit - minSpeedLimit < 100) {
    cross.custom(
      'questionConfig.speedSettings',
      `速度区间过窄（${minSpeedLimit}~${maxSpeedLimit}），等级成长带来的速度变化玩家感知不到，建议区间跨度 ≥ 100`,
    );
  }

  issues.push(...cross.issues);

  if (issues.length > 0) throw new ConfigValidationError(issues);
}

// ─────────────────────────── 各模块独立校验 ───────────────────────────

function validateGameSettings(raw: unknown): Validator {
  const v = new Validator('gameSettings');
  const root = v.isRecord(raw) ? raw : {};
  v.string(root, 'version', 'gameSettings.version');

  const ls = v.object(root, 'levelSettings', 'gameSettings.levelSettings');
  v.integer(ls, 'maxLevel', 'gameSettings.levelSettings.maxLevel', { min: 1, max: 999 });
  v.number(ls, 'levelUpGradeBase', 'gameSettings.levelSettings.levelUpGradeBase', { min: 1 });
  v.number(ls, 'levelUpGradeGrowth', 'gameSettings.levelSettings.levelUpGradeGrowth', { min: 1 });
  v.string(ls, 'levelUpGradeGrowthType', 'gameSettings.levelSettings.levelUpGradeGrowthType', [
    'linear',
    'exponential',
  ]);

  const rs = v.object(root, 'rewardSettings', 'gameSettings.rewardSettings');
  v.number(rs, 'dailyRewardLimit', 'gameSettings.rewardSettings.dailyRewardLimit', { min: 0 });
  v.number(rs, 'singleRewardLimit', 'gameSettings.rewardSettings.singleRewardLimit', { min: 0 });
  v.number(rs, 'consecutiveRewardBase', 'gameSettings.rewardSettings.consecutiveRewardBase', { min: 0 });
  v.number(rs, 'consecutiveRewardGrowth', 'gameSettings.rewardSettings.consecutiveRewardGrowth', { min: 1 });

  const os = v.object(root, 'otherSettings', 'gameSettings.otherSettings');
  v.number(os, 'defaultGameTime', 'gameSettings.otherSettings.defaultGameTime', { min: 1 });
  v.number(os, 'maxGameTimeLimit', 'gameSettings.otherSettings.maxGameTimeLimit', { min: 1 });
  v.number(os, 'minGameTimeLimit', 'gameSettings.otherSettings.minGameTimeLimit', { min: 1 });
  const unlock = v.object(os, 'subjectUnlockLevel', 'gameSettings.otherSettings.subjectUnlockLevel');
  for (const key of Object.keys(unlock)) {
    v.number(unlock, key, `gameSettings.otherSettings.subjectUnlockLevel.${key}`, { min: 1 });
  }
  if (os.minGameTimeLimit !== undefined && os.maxGameTimeLimit !== undefined) {
    if ((os.minGameTimeLimit as number) > (os.maxGameTimeLimit as number)) {
      v.custom('gameSettings.otherSettings', 'minGameTimeLimit 必须小于或等于 maxGameTimeLimit');
    }
  }

  const bs = v.object(root, 'grassCuttingBonusSettings', 'gameSettings.grassCuttingBonusSettings');
  v.number(bs, 'baseBonusGrowthPerLevel', 'gameSettings.grassCuttingBonusSettings.baseBonusGrowthPerLevel', { min: 0, max: 1 });
  v.number(bs, 'accuracyBaseline', 'gameSettings.grassCuttingBonusSettings.accuracyBaseline', { min: 0, max: 1 });
  v.number(bs, 'accuracyWeight', 'gameSettings.grassCuttingBonusSettings.accuracyWeight', { min: 0 });
  v.number(bs, 'accuracyTermMin', 'gameSettings.grassCuttingBonusSettings.accuracyTermMin', { min: 0 });
  v.number(bs, 'accuracyTermMax', 'gameSettings.grassCuttingBonusSettings.accuracyTermMax', { min: 0 });
  v.number(bs, 'speedFactorBase', 'gameSettings.grassCuttingBonusSettings.speedFactorBase', { min: 0 });
  v.number(bs, 'speedFactorWeight', 'gameSettings.grassCuttingBonusSettings.speedFactorWeight', { min: 0 });
  v.number(bs, 'speedFactorMin', 'gameSettings.grassCuttingBonusSettings.speedFactorMin', { min: 0 });
  v.number(bs, 'speedFactorMax', 'gameSettings.grassCuttingBonusSettings.speedFactorMax', { min: 0 });
  v.number(bs, 'comboFactorPerCombo', 'gameSettings.grassCuttingBonusSettings.comboFactorPerCombo', { min: 0 });
  v.number(bs, 'comboFactorMax', 'gameSettings.grassCuttingBonusSettings.comboFactorMax', { min: 1 });

  const floor = v.object(bs, 'multiplierFloor', 'gameSettings.grassCuttingBonusSettings.multiplierFloor');
  const ceiling = v.object(bs, 'multiplierCeiling', 'gameSettings.grassCuttingBonusSettings.multiplierCeiling');
  for (const key of ['damage', 'range', 'duration'] as const) {
    v.number(floor, key, `gameSettings.grassCuttingBonusSettings.multiplierFloor.${key}`, { min: 0 });
    v.number(ceiling, key, `gameSettings.grassCuttingBonusSettings.multiplierCeiling.${key}`, { min: 0 });
    const f = floor[key];
    const c = ceiling[key];
    if (typeof f === 'number' && typeof c === 'number' && f >= c) {
      v.custom(
        `gameSettings.grassCuttingBonusSettings.multiplier.${key}`,
        `保底下限（${f}）必须小于上限（${c}），否则加成区间失效`,
      );
    }
  }
  return v;
}

function validateQuestionConfig(raw: unknown): Validator {
  const v = new Validator('questionConfig');
  const root = v.isRecord(raw) ? raw : {};
  v.string(root, 'version', 'questionConfig.version');

  const ss = v.object(root, 'speedSettings', 'questionConfig.speedSettings');
  v.string(ss, 'curveType', 'questionConfig.speedSettings.curveType', ['linear', 'exponential', 'hybrid']);
  v.number(ss, 'baseSpeed', 'questionConfig.speedSettings.baseSpeed', { min: 1 });
  v.number(ss, 'minSpeedLimit', 'questionConfig.speedSettings.minSpeedLimit', { min: 1 });
  v.number(ss, 'maxSpeedLimit', 'questionConfig.speedSettings.maxSpeedLimit', { min: 1 });
  v.number(ss, 'speedReductionPerLevel', 'questionConfig.speedSettings.speedReductionPerLevel', { min: 0 });
  v.number(ss, 'speedReductionGrowth', 'questionConfig.speedSettings.speedReductionGrowth', { min: 0, max: 1 });
  if (
    typeof ss.minSpeedLimit === 'number' &&
    typeof ss.maxSpeedLimit === 'number' &&
    ss.minSpeedLimit >= ss.maxSpeedLimit
  ) {
    v.custom(
      'questionConfig.speedSettings',
      `答案移动速度的下限（${ss.minSpeedLimit}）必须小于上限（${ss.maxSpeedLimit}）`,
    );
  }

  const qs = v.object(root, 'questionSettings', 'questionConfig.questionSettings');
  v.integer(qs, 'questionCountPerRound', 'questionConfig.questionSettings.questionCountPerRound', { min: 1, max: 50 });
  v.number(qs, 'questionTimeLimit', 'questionConfig.questionSettings.questionTimeLimit', { min: 1 });
  v.number(qs, 'timeLimitGrowth', 'questionConfig.questionSettings.timeLimitGrowth', { min: 1 });
  v.number(qs, 'maxTimeLimit', 'questionConfig.questionSettings.maxTimeLimit', { min: 1 });
  v.number(qs, 'minTimeLimit', 'questionConfig.questionSettings.minTimeLimit', { min: 1 });
  v.number(qs, 'correctBonusTime', 'questionConfig.questionSettings.correctBonusTime', { min: 0 });
  v.integer(qs, 'consecutiveCorrectThreshold', 'questionConfig.questionSettings.consecutiveCorrectThreshold', { min: 1 });
  if (
    typeof qs.minTimeLimit === 'number' &&
    typeof qs.maxTimeLimit === 'number' &&
    qs.minTimeLimit > qs.maxTimeLimit
  ) {
    v.custom('questionConfig.questionSettings', 'minTimeLimit 必须小于或等于 maxTimeLimit');
  }

  const as = v.object(root, 'answerSettings', 'questionConfig.answerSettings');
  v.string(as, 'mode', 'questionConfig.answerSettings.mode', ['arrow', 'track', 'cursor']);
  v.string(as, 'movementType', 'questionConfig.answerSettings.movementType', ['circular', 'linear']);
  v.string(as, 'movementEasing', 'questionConfig.answerSettings.movementEasing', ['linear']);
  v.number(as, 'stopThreshold', 'questionConfig.answerSettings.stopThreshold', { min: 0, max: 1 });
  v.number(as, 'overlapThreshold', 'questionConfig.answerSettings.overlapThreshold', { min: 0.05, max: 1 });
  v.number(as, 'bounceVelocity', 'questionConfig.answerSettings.bounceVelocity', { min: 0, max: 3 });
  v.number(as, 'dragDamping', 'questionConfig.answerSettings.dragDamping', { min: 0, max: 1 });
  v.number(as, 'optionCardWidth', 'questionConfig.answerSettings.optionCardWidth', { min: 40 });
  v.number(as, 'optionCardHeight', 'questionConfig.answerSettings.optionCardHeight', { min: 30 });
  v.number(as, 'trackCenterX', 'questionConfig.answerSettings.trackCenterX', { min: 0 });
  v.number(as, 'trackCenterY', 'questionConfig.answerSettings.trackCenterY', { min: 0 });
  v.number(as, 'trackRadiusX', 'questionConfig.answerSettings.trackRadiusX', { min: 20 });
  v.number(as, 'trackRadiusY', 'questionConfig.answerSettings.trackRadiusY', { min: 20 });
  v.number(as, 'linearTrackSpan', 'questionConfig.answerSettings.linearTrackSpan', { min: 100 });
  v.number(as, 'selectionZoneWidth', 'questionConfig.answerSettings.selectionZoneWidth', { min: 40 });
  v.number(as, 'selectionZoneHeight', 'questionConfig.answerSettings.selectionZoneHeight', { min: 30 });
  v.number(as, 'stopSettleDuration', 'questionConfig.answerSettings.stopSettleDuration', { min: 0, max: 2 });
  v.number(as, 'feedbackHoldDuration', 'questionConfig.answerSettings.feedbackHoldDuration', { min: 0, max: 5 });
  v.number(as, 'explanationHoldDuration', 'questionConfig.answerSettings.explanationHoldDuration', { min: 0, max: 8 });
  v.number(as, 'arrowInterval', 'questionConfig.answerSettings.arrowInterval', { min: 0.4, max: 4 });
  v.string(as, 'arrowLayout', 'questionConfig.answerSettings.arrowLayout', ['row', 'grid']);
  v.number(as, 'cursorCycleDuration', 'questionConfig.answerSettings.cursorCycleDuration', { min: 0.8, max: 6 });
  v.number(as, 'cursorHitZoneWidth', 'questionConfig.answerSettings.cursorHitZoneWidth', { min: 40, max: 300 });
  v.number(as, 'cursorHitZoneHeight', 'questionConfig.answerSettings.cursorHitZoneHeight', { min: 30, max: 200 });

  // 判定区必须至少和选项卡片一样大，否则永远无法达到 100% 重叠
  if (
    typeof as.selectionZoneWidth === 'number' &&
    typeof as.optionCardWidth === 'number' &&
    as.selectionZoneWidth < as.optionCardWidth
  ) {
    v.custom(
      'questionConfig.answerSettings',
      `判定区宽度（${as.selectionZoneWidth}）小于选项卡片宽度（${as.optionCardWidth}），最大重叠比例无法达到 1`,
    );
  }

  const sd = v.object(root, 'subjectDifficulty', 'questionConfig.subjectDifficulty');
  for (const key of Object.keys(sd)) {
    const entry = v.object(sd, key, `questionConfig.subjectDifficulty.${key}`);
    v.number(entry, 'difficultyCoefficient', `questionConfig.subjectDifficulty.${key}.difficultyCoefficient`, { min: 0.1, max: 5 });
    v.number(entry, 'speedCoefficient', `questionConfig.subjectDifficulty.${key}.speedCoefficient`, { min: 0.1, max: 5 });
  }
  if (Object.keys(sd).length === 0) {
    v.custom('questionConfig.subjectDifficulty', '至少需要配置一个学科的 difficultyCoefficient');
  }

  const ds = v.object(root, 'difficultySelection', 'questionConfig.difficultySelection');
  v.integer(ds, 'lowLevelMax', 'questionConfig.difficultySelection.lowLevelMax', { min: 1 });
  v.integer(ds, 'midLevelMax', 'questionConfig.difficultySelection.midLevelMax', { min: 1 });
  for (const band of ['weightsLow', 'weightsMid', 'weightsHigh'] as const) {
    const weights = v.object(ds, band, `questionConfig.difficultySelection.${band}`);
    let sum = 0;
    for (const diffKey of ['1', '2', '3']) {
      const w = v.number(weights, diffKey, `questionConfig.difficultySelection.${band}.${diffKey}`, { min: 0, max: 1 });
      sum += w;
    }
    if (Math.abs(sum - 1) > 0.001) {
      v.custom(
        `questionConfig.difficultySelection.${band}`,
        `三个难度档的权重之和必须为 1，当前为 ${sum.toFixed(3)}，会导致抽题逻辑异常`,
      );
    }
  }
  return v;
}

function validateGrassCuttingConfig(raw: unknown): Validator {
  const v = new Validator('grassCuttingConfig');
  const root = v.isRecord(raw) ? raw : {};
  v.string(root, 'version', 'grassCuttingConfig.version');

  const ts = v.object(root, 'touchSettings', 'grassCuttingConfig.touchSettings');
  v.number(ts, 'joystickCenterX', 'grassCuttingConfig.touchSettings.joystickCenterX', { min: 0 });
  v.number(ts, 'joystickCenterY', 'grassCuttingConfig.touchSettings.joystickCenterY', { min: 0 });
  const joystickBaseRadius = v.number(ts, 'joystickBaseRadius', 'grassCuttingConfig.touchSettings.joystickBaseRadius', { min: 10, max: 200 });
  const joystickKnobRadius = v.number(ts, 'joystickKnobRadius', 'grassCuttingConfig.touchSettings.joystickKnobRadius', { min: 5, max: 160 });
  const joystickDeadZone = v.number(ts, 'joystickDeadZone', 'grassCuttingConfig.touchSettings.joystickDeadZone', { min: 0 });
  v.number(ts, 'joystickIdleAlpha', 'grassCuttingConfig.touchSettings.joystickIdleAlpha', { min: 0, max: 1 });
  v.number(ts, 'joystickActiveAlpha', 'grassCuttingConfig.touchSettings.joystickActiveAlpha', { min: 0, max: 1 });
  // 结构红线：摇杆头必须能放进底座，死区必须小于底座半径，否则摇杆不可用
  if (joystickKnobRadius >= joystickBaseRadius) {
    v.custom(
      'grassCuttingConfig.touchSettings',
      `摇杆头半径（${joystickKnobRadius}）必须小于底座半径（${joystickBaseRadius}）`,
    );
  }
  if (joystickDeadZone >= joystickBaseRadius) {
    v.custom(
      'grassCuttingConfig.touchSettings',
      `死区半径（${joystickDeadZone}）必须小于底座半径（${joystickBaseRadius}），否则摇杆永远推不动`,
    );
  }

  const ps = v.object(root, 'playerSettings', 'grassCuttingConfig.playerSettings');
  v.number(ps, 'playerHpBase', 'grassCuttingConfig.playerSettings.playerHpBase', { min: 1 });
  v.number(ps, 'playerMoveSpeed', 'grassCuttingConfig.playerSettings.playerMoveSpeed', { min: 1 });
  v.number(ps, 'playerRadius', 'grassCuttingConfig.playerSettings.playerRadius', { min: 4 });
  v.number(ps, 'invulnerableDuration', 'grassCuttingConfig.playerSettings.invulnerableDuration', { min: 0 });
  v.number(ps, 'playerContactDamageCooldown', 'grassCuttingConfig.playerSettings.playerContactDamageCooldown', { min: 0 });

  const ms = v.object(root, 'monsterSettings', 'grassCuttingConfig.monsterSettings');
  v.number(ms, 'monsterHpBase', 'grassCuttingConfig.monsterSettings.monsterHpBase', { min: 0.1 });
  v.number(ms, 'monsterHpGrowthPerLevel', 'grassCuttingConfig.monsterSettings.monsterHpGrowthPerLevel', { min: 1, max: 3 });
  v.number(ms, 'monsterDamageBase', 'grassCuttingConfig.monsterSettings.monsterDamageBase', { min: 0 });
  v.number(ms, 'monsterDamageGrowthPerLevel', 'grassCuttingConfig.monsterSettings.monsterDamageGrowthPerLevel', { min: 0 });
  v.number(ms, 'monsterMoveSpeedBase', 'grassCuttingConfig.monsterSettings.monsterMoveSpeedBase', { min: 1 });
  v.number(ms, 'monsterMoveSpeedGrowthPerLevel', 'grassCuttingConfig.monsterSettings.monsterMoveSpeedGrowthPerLevel', { min: 0 });
  v.number(ms, 'monsterSpawnIntervalWithinWave', 'grassCuttingConfig.monsterSettings.monsterSpawnIntervalWithinWave', { min: 0.02 });
  v.number(ms, 'monsterRadius', 'grassCuttingConfig.monsterSettings.monsterRadius', { min: 4 });
  v.integer(ms, 'monsterMaxAlive', 'grassCuttingConfig.monsterSettings.monsterMaxAlive', { min: 1, max: 200 });
  v.number(ms, 'monsterSpawnMargin', 'grassCuttingConfig.monsterSettings.monsterSpawnMargin', { min: 0 });
  v.number(ms, 'monsterScoreBase', 'grassCuttingConfig.monsterSettings.monsterScoreBase', { min: 0 });
  v.number(ms, 'monsterKnockback', 'grassCuttingConfig.monsterSettings.monsterKnockback', { min: 0 });
  v.number(ms, 'monsterKnockbackDuration', 'grassCuttingConfig.monsterSettings.monsterKnockbackDuration', { min: 0.01 });

  const cs = v.object(root, 'comboSettings', 'grassCuttingConfig.comboSettings');
  v.number(cs, 'comboTimeWindow', 'grassCuttingConfig.comboSettings.comboTimeWindow', { min: 0.1 });
  v.number(cs, 'comboDamageGrowth', 'grassCuttingConfig.comboSettings.comboDamageGrowth', { min: 0 });
  v.number(cs, 'comboSkillDurationGrowth', 'grassCuttingConfig.comboSettings.comboSkillDurationGrowth', { min: 0 });
  v.number(cs, 'comboMaxDamageMultiplier', 'grassCuttingConfig.comboSettings.comboMaxDamageMultiplier', { min: 1 });

  const ds = v.object(root, 'difficultySettings', 'grassCuttingConfig.difficultySettings');
  v.string(ds, 'interpolation', 'grassCuttingConfig.difficultySettings.interpolation', ['linear', 'smoothstep']);
  v.number(ds, 'spawnIntervalStart', 'grassCuttingConfig.difficultySettings.spawnIntervalStart', { min: 0.02 });
  v.number(ds, 'spawnIntervalEnd', 'grassCuttingConfig.difficultySettings.spawnIntervalEnd', { min: 0.02 });
  v.number(ds, 'batchSizeStart', 'grassCuttingConfig.difficultySettings.batchSizeStart', { min: 1 });
  v.number(ds, 'batchSizeEnd', 'grassCuttingConfig.difficultySettings.batchSizeEnd', { min: 1 });
  v.number(ds, 'hpMultiplierStart', 'grassCuttingConfig.difficultySettings.hpMultiplierStart', { min: 0.1 });
  v.number(ds, 'hpMultiplierEnd', 'grassCuttingConfig.difficultySettings.hpMultiplierEnd', { min: 0.1 });
  v.number(ds, 'moveSpeedMultiplierStart', 'grassCuttingConfig.difficultySettings.moveSpeedMultiplierStart', { min: 0.1 });
  v.number(ds, 'moveSpeedMultiplierEnd', 'grassCuttingConfig.difficultySettings.moveSpeedMultiplierEnd', { min: 0.1 });

  const pf = v.object(root, 'performanceSettings', 'grassCuttingConfig.performanceSettings');
  v.integer(pf, 'maxAliveMonsters', 'grassCuttingConfig.performanceSettings.maxAliveMonsters', { min: 1, max: 200 });
  v.integer(pf, 'damageCheckFrameInterval', 'grassCuttingConfig.performanceSettings.damageCheckFrameInterval', { min: 1, max: 10 });
  v.integer(pf, 'maxHitTextAlive', 'grassCuttingConfig.performanceSettings.maxHitTextAlive', { min: 0, max: 64 });
  v.integer(pf, 'monsterPoolSize', 'grassCuttingConfig.performanceSettings.monsterPoolSize', { min: 8, max: 400 });
  v.integer(pf, 'projectilePoolSize', 'grassCuttingConfig.performanceSettings.projectilePoolSize', { min: 8, max: 400 });
  v.integer(pf, 'shardPoolSize', 'grassCuttingConfig.performanceSettings.shardPoolSize', { min: 0, max: 400 });
  v.integer(pf, 'ringPoolSize', 'grassCuttingConfig.performanceSettings.ringPoolSize', { min: 0, max: 120 });
  v.integer(pf, 'corpsePoolSize', 'grassCuttingConfig.performanceSettings.corpsePoolSize', { min: 0, max: 120 });

  // 性能红线：对象池必须能容纳同屏上限 + 一次波次的余量
  if (typeof pf.monsterPoolSize === 'number' && typeof pf.maxAliveMonsters === 'number') {
    if (pf.monsterPoolSize < pf.maxAliveMonsters) {
      v.custom(
        'grassCuttingConfig.performanceSettings',
        `对象池容量（${pf.monsterPoolSize}）小于同屏小怪上限（${pf.maxAliveMonsters}），运行时会退化成动态创建，违反性能零妥协原则`,
      );
    }
  }

  const sc = v.object(root, 'subjectCoefficientSettings', 'grassCuttingConfig.subjectCoefficientSettings');
  for (const key of Object.keys(sc)) {
    const entry = v.object(sc, key, `grassCuttingConfig.subjectCoefficientSettings.${key}`);
    v.number(entry, 'skillDamageCoefficient', `grassCuttingConfig.subjectCoefficientSettings.${key}.skillDamageCoefficient`, { min: 0.1, max: 5 });
    v.number(entry, 'skillRangeCoefficient', `grassCuttingConfig.subjectCoefficientSettings.${key}.skillRangeCoefficient`, { min: 0.1, max: 5 });
  }
  if (Object.keys(sc).length === 0) {
    v.custom('grassCuttingConfig.subjectCoefficientSettings', '至少需要配置一个学科的 skillDamageCoefficient');
  }
  return v;
}

/** weaponConfig.json：三把武器 + 自动瞄准 + 击杀打击感 */
function validateWeaponConfig(raw: unknown): Validator {
  const v = new Validator('weaponConfig');
  const root = v.isRecord(raw) ? raw : {};
  v.string(root, 'version', 'weaponConfig.version');

  const aim = v.object(root, 'autoAim', 'weaponConfig.autoAim');
  v.boolean(aim, 'enabled', 'weaponConfig.autoAim.enabled');
  v.number(aim, 'searchRadius', 'weaponConfig.autoAim.searchRadius', { min: 0 });
  // 瞄准辅助转向速率（度/秒）：0 表示瞬间对齐，值越小转向越柔和
  v.number(aim, 'aimAssistAngle', 'weaponConfig.autoAim.aimAssistAngle', { min: 0 });

  const fx = v.object(root, 'killFx', 'weaponConfig.killFx');
  v.boolean(fx, 'hitstopEnabled', 'weaponConfig.killFx.hitstopEnabled');
  v.number(fx, 'hitstopTimeScale', 'weaponConfig.killFx.hitstopTimeScale', { min: 0.01, max: 1 });
  v.integer(fx, 'shardCount', 'weaponConfig.killFx.shardCount', { min: 0, max: 32 });
  v.number(fx, 'shardSize', 'weaponConfig.killFx.shardSize', { min: 1 });
  v.number(fx, 'shardSpeed', 'weaponConfig.killFx.shardSpeed', { min: 0 });
  v.number(fx, 'shardLife', 'weaponConfig.killFx.shardLife', { min: 0.05 });
  v.number(fx, 'flashDuration', 'weaponConfig.killFx.flashDuration', { min: 0 });
  v.number(fx, 'hitFlashDuration', 'weaponConfig.killFx.hitFlashDuration', { min: 0 });
  v.number(fx, 'killKnockbackMultiplier', 'weaponConfig.killFx.killKnockbackMultiplier', { min: 0 });
  v.number(fx, 'ringFromScale', 'weaponConfig.killFx.ringFromScale', { min: 0.05 });
  v.number(fx, 'ringToScale', 'weaponConfig.killFx.ringToScale', { min: 0.05 });
  v.number(fx, 'ringDuration', 'weaponConfig.killFx.ringDuration', { min: 0 });
  v.number(fx, 'corpseLife', 'weaponConfig.killFx.corpseLife', { min: 0 });
  v.number(fx, 'corpseSpin', 'weaponConfig.killFx.corpseSpin', { min: 0 });
  v.number(fx, 'corpseDrag', 'weaponConfig.killFx.corpseDrag', { min: 0 });
  v.number(fx, 'hitstopMinInterval', 'weaponConfig.killFx.hitstopMinInterval', { min: 0 });
  v.number(fx, 'shardDrag', 'weaponConfig.killFx.shardDrag', { min: 0 });
  v.boolean(fx, 'cameraShakeEnabled', 'weaponConfig.killFx.cameraShakeEnabled');
  v.integer(fx, 'comboBigThreshold', 'weaponConfig.killFx.comboBigThreshold', { min: 1 });
  v.integer(fx, 'comboHugeThreshold', 'weaponConfig.killFx.comboHugeThreshold', { min: 1 });

  const list = v.array(root, 'weapons', 'weaponConfig.weapons', 1);
  const ids = new Set<string>();

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!v.isRecord(item)) {
      v.custom(`weaponConfig.weapons[${i}]`, `应为对象（object），实际为 ${describeType(item)}`);
      continue;
    }
    const p = `weaponConfig.weapons[${i}]`;
    const id = v.string(item, 'id', `${p}.id`);
    v.string(item, 'name', `${p}.name`);
    const type = v.string(item, 'attackType', `${p}.attackType`, [
      'melee_sector',
      'ranged_bolt',
      'ranged_spread',
    ]);
    v.number(item, 'damage', `${p}.damage`, { min: 0.1 });
    v.number(item, 'cooldown', `${p}.cooldown`, { min: 0.02 });
    v.number(item, 'range', `${p}.range`, { min: 1 });
    v.number(item, 'sectorAngle', `${p}.sectorAngle`, { min: 0, max: 360 });
    v.number(item, 'projectileSpeed', `${p}.projectileSpeed`, { min: 0 });
    v.number(item, 'projectileRadius', `${p}.projectileRadius`, { min: 0 });
    v.integer(item, 'pierce', `${p}.pierce`, { min: 0, max: 20 });
    v.integer(item, 'pelletCount', `${p}.pelletCount`, { min: 1, max: 32 });
    v.number(item, 'spread', `${p}.spread`, { min: 0, max: 360 });
    v.number(item, 'knockback', `${p}.knockback`, { min: 0 });
    v.number(item, 'damageGrowthPerLevel', `${p}.damageGrowthPerLevel`, { min: 0 });
    v.number(item, 'hitstopDuration', `${p}.hitstopDuration`, { min: 0, max: 300 });
    v.number(item, 'shakeIntensity', `${p}.shakeIntensity`, { min: 0, max: 0.02 });

    // id 是贴图 key 与切换索引的锚点，必须唯一
    if (id.length > 0) {
      if (ids.has(id)) {
        v.custom(`weaponConfig.weapons[${i}].id`, `武器 id 重复：「${id}」，同一 id 会导致贴图与索引错位`);
      }
      ids.add(id);
    }

    // 远程武器必须能飞：没有弹速就打不到任何东西
    if (type !== 'melee_sector' && item.projectileSpeed === 0) {
      v.custom(`${p}.projectileSpeed`, '远程武器（ranged_bolt / ranged_spread）的 projectileSpeed 必须大于 0');
    }
    if (type !== 'melee_sector' && item.projectileRadius === 0) {
      v.custom(`${p}.projectileRadius`, '远程武器（ranged_bolt / ranged_spread）的 projectileRadius 必须大于 0，否则命中判定恒不成立');
    }
    // 近战靠扇形判定，张角不能为 0，否则永远打不中
    if (type === 'melee_sector' && !((item.sectorAngle as number) > 0)) {
      v.custom(`${p}.sectorAngle`, '近战武器（melee_sector）的 sectorAngle 必须大于 0');
    }
  }

  return v;
}

function validateLevelConfig(raw: unknown): Validator {
  const v = new Validator('levelConfig');
  const root = v.isRecord(raw) ? raw : {};
  v.string(root, 'version', 'levelConfig.version');

  const levels = v.array(root, 'levels', 'levelConfig.levels', 1);
  const seen = new Set<number>();
  let previous = 0;
  levels.forEach((item, index) => {
    if (!v.isRecord(item)) {
      v.custom(`levelConfig.levels[${index}]`, '关卡条目应为对象');
      return;
    }
    const base = `levelConfig.levels[${index}]`;
    const level = v.integer(item, 'level', `${base}.level`, { min: 1 });
    v.string(item, 'name', `${base}.name`);
    v.string(item, 'subject', `${base}.subject`);
    v.string(item, 'unlockCondition', `${base}.unlockCondition`);
    v.integer(item, 'questionCount', `${base}.questionCount`, { min: 1, max: 50 });
    v.boolean(item, 'bossLevel', `${base}.bossLevel`);
    v.boolean(item, 'breatherLevel', `${base}.breatherLevel`);
    v.number(item, 'difficultyScale', `${base}.difficultyScale`, { min: 0.1, max: 10 });
    v.number(item, 'gameTime', `${base}.gameTime`, { min: 5 });
    v.string(item, 'primaryDimension', `${base}.primaryDimension`);
    v.string(item, 'nextLevelUnlockCondition', `${base}.nextLevelUnlockCondition`);

    if (seen.has(level)) {
      v.custom(`${base}.level`, `关卡号 ${level} 重复，level 必须唯一（多表关联的唯一外键）`);
    }
    seen.add(level);
    if (index > 0 && level <= previous) {
      v.custom(`${base}.level`, `关卡号必须严格递增，上一关为 ${previous}，当前为 ${level}`);
    }
    previous = level;
  });

  const lg = v.object(root, 'levelDifficultyGrowth', 'levelConfig.levelDifficultyGrowth');
  v.number(lg, 'questionCountGrowth', 'levelConfig.levelDifficultyGrowth.questionCountGrowth', { min: 1 });
  v.number(lg, 'difficultyScaleStep', 'levelConfig.levelDifficultyGrowth.difficultyScaleStep', { min: 0, max: 0.3 });
  v.integer(lg, 'breatherInterval', 'levelConfig.levelDifficultyGrowth.breatherInterval', { min: 2, max: 10 });
  return v;
}

function validateRewardConfig(raw: unknown): Validator {
  const v = new Validator('rewardConfig');
  const root = v.isRecord(raw) ? raw : {};
  v.string(root, 'version', 'rewardConfig.version');

  const combos = v.array(root, 'comboRewards', 'rewardConfig.comboRewards', 1);
  let previousCombo = 0;
  combos.forEach((item, index) => {
    if (!v.isRecord(item)) {
      v.custom(`rewardConfig.comboRewards[${index}]`, '连对奖励条目应为对象');
      return;
    }
    const base = `rewardConfig.comboRewards[${index}]`;
    const combo = v.integer(item, 'combo', `${base}.combo`, { min: 1 });
    v.number(item, 'rewardTime', `${base}.rewardTime`, { min: 0 });
    v.number(item, 'rewardSkillDuration', `${base}.rewardSkillDuration`, { min: 0 });
    if (combo <= previousCombo) {
      v.custom(`${base}.combo`, '连对门槛必须严格递增，否则阶梯奖励逻辑失效');
    }
    previousCombo = combo;
  });

  const or = v.object(root, 'otherRewards', 'rewardConfig.otherRewards');
  v.number(or, 'perfectAnswerReward', 'rewardConfig.otherRewards.perfectAnswerReward', { min: 0 });
  v.number(or, 'fastAnswerReward', 'rewardConfig.otherRewards.fastAnswerReward', { min: 0 });
  v.number(or, 'fastAnswerTimeThreshold', 'rewardConfig.otherRewards.fastAnswerTimeThreshold', { min: 0.5 });
  v.number(or, 'noDamageReward', 'rewardConfig.otherRewards.noDamageReward', { min: 0 });

  const sc = v.object(root, 'scoreSettings', 'rewardConfig.scoreSettings');
  v.number(sc, 'scorePerKill', 'rewardConfig.scoreSettings.scorePerKill', { min: 0 });
  v.number(sc, 'scorePerCorrectAnswer', 'rewardConfig.scoreSettings.scorePerCorrectAnswer', { min: 0 });
  v.number(sc, 'scoreComboBonusPerCombo', 'rewardConfig.scoreSettings.scoreComboBonusPerCombo', { min: 0 });
  v.number(sc, 'expPerKill', 'rewardConfig.scoreSettings.expPerKill', { min: 0 });
  v.number(sc, 'expPerCorrectAnswer', 'rewardConfig.scoreSettings.expPerCorrectAnswer', { min: 0 });
  v.number(sc, 'expLevelClearBonus', 'rewardConfig.scoreSettings.expLevelClearBonus', { min: 0 });

  const rl = v.object(root, 'rewardLimits', 'rewardConfig.rewardLimits');
  v.number(rl, 'dailyRewardTimeMax', 'rewardConfig.rewardLimits.dailyRewardTimeMax', { min: 0 });
  v.number(rl, 'singleRewardTimeMax', 'rewardConfig.rewardLimits.singleRewardTimeMax', { min: 0 });
  v.number(rl, 'comboRewardTimeMax', 'rewardConfig.rewardLimits.comboRewardTimeMax', { min: 0 });
  return v;
}

function validateSubjectConfig(raw: unknown): Validator {
  const v = new Validator('subjectConfig');
  const root = v.isRecord(raw) ? raw : {};
  v.string(root, 'version', 'subjectConfig.version');

  const subjects = v.object(root, 'subjects', 'subjectConfig.subjects');
  const keys = Object.keys(subjects);
  if (keys.length === 0) {
    v.custom('subjectConfig.subjects', '至少需要配置一个学科');
  }
  for (const key of keys) {
    const entry = v.object(subjects, key, `subjectConfig.subjects.${key}`);
    v.string(entry, 'displayName', `subjectConfig.subjects.${key}.displayName`);
    v.integer(entry, 'unlockLevel', `subjectConfig.subjects.${key}.unlockLevel`, { min: 1 });
    v.hexColor(entry, 'themeColor', `subjectConfig.subjects.${key}.themeColor`);
    v.hexColor(entry, 'accentColor', `subjectConfig.subjects.${key}.accentColor`);
    v.string(entry, 'skillName', `subjectConfig.subjects.${key}.skillName`);
    v.string(entry, 'description', `subjectConfig.subjects.${key}.description`);
  }
  return v;
}

function validateQuestionBank(raw: unknown): Validator {
  const v = new Validator('questionBank');
  const root = v.isRecord(raw) ? raw : {};
  v.string(root, 'version', 'questionBank.version');

  const questions = v.array(root, 'questions', 'questionBank.questions', 1);
  const ids = new Set<string>();
  questions.forEach((item, index) => {
    if (!v.isRecord(item)) {
      v.custom(`questionBank.questions[${index}]`, '题目条目应为对象');
      return;
    }
    const base = `questionBank.questions[${index}]`;
    const id = v.string(item, 'id', `${base}.id`);
    if (id && ids.has(id)) {
      v.custom(`${base}.id`, `题目 id "${id}" 重复，会导致抽题与错题统计错乱`);
    }
    if (id) ids.add(id);

    v.string(item, 'subject', `${base}.subject`);
    v.integer(item, 'difficulty', `${base}.difficulty`, { min: 1, max: 3 });
    v.string(item, 'question', `${base}.question`);

    const options = v.array(item, 'options', `${base}.options`, 4);
    if (options.length !== 4) {
      v.custom(`${base}.options`, `每题必须恰好 4 个选项，实际为 ${options.length} 个`);
    }
    const optionSet = new Set<string>();
    options.forEach((opt, oi) => {
      if (typeof opt !== 'string' || opt.trim().length === 0) {
        v.custom(`${base}.options[${oi}]`, '选项内容应为非空字符串');
        return;
      }
      if (optionSet.has(opt)) {
        v.custom(`${base}.options[${oi}]`, `选项内容 "${opt}" 与其他选项重复，会造成无法区分的干扰项`);
      }
      optionSet.add(opt);
    });

    const answerIndex = v.integer(item, 'answerIndex', `${base}.answerIndex`, { min: 0 });
    if (options.length > 0 && answerIndex >= options.length) {
      v.custom(
        `${base}.answerIndex`,
        `正确答案索引 ${answerIndex} 超出选项范围（共 ${options.length} 项，合法索引 0~${options.length - 1}）`,
      );
    }
    v.string(item, 'explanation', `${base}.explanation`);
  });
  return v;
}

/** 供外部脚本（scripts/validate-config.mjs 之外）复用的类型化断言入口 */
export type ValidatedConfigs = ConfigModuleMap;
export type { ConfigModuleName };
