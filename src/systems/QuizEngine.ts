/**
 * 答题流程引擎（src/systems/QuizEngine.ts）
 * 职责：管理一轮答题的生命周期——出题、计时、判题、连对统计、超时处理、结果汇总。
 * 说明：本类不接触任何渲染，纯逻辑，便于单独测试；渲染与交互由 QuestionScene 驱动。
 */

import type { AnswerRecord, QuizResult } from '../config/resolve';
import type { DrawnQuestion } from '../data/QuestionBank';

/** 单次作答的判定结果 */
export type AnswerOutcome = 'correct' | 'wrong' | 'miss' | 'timeout';

/** 引擎构造参数 */
export interface QuizEngineOptions {
  questions: DrawnQuestion[];
  /** 每题限时（秒） */
  timeLimit: number;
}

/**
 * 一轮答题引擎。
 * 状态机：running →（每道题提交后）→ 下一题 / 结束
 */
export class QuizEngine {
  private readonly questions: DrawnQuestion[];
  private readonly timeLimit: number;

  private index = 0;
  private remaining = 0;
  private combo = 0;
  private maxCombo = 0;
  private correctCount = 0;
  private missCount = 0;
  private timeoutCount = 0;
  private totalTime = 0;
  /** 已提交 / 已超时的作答记录（未命中不计入，因为题目还在继续） */
  private readonly records: AnswerRecord[] = [];
  /** 未命中记录，单独存放以区分「答错」与「没停准」 */
  private readonly missRecords: AnswerRecord[] = [];
  private finished = false;

  constructor(opts: QuizEngineOptions) {
    if (opts.questions.length === 0) {
      throw new Error('QuizEngine 至少需要一道题目才能启动');
    }
    this.questions = opts.questions;
    this.timeLimit = opts.timeLimit;
    this.remaining = opts.timeLimit;
  }

  /** 当前题目 */
  get current(): DrawnQuestion {
    return this.questions[Math.min(this.index, this.questions.length - 1)];
  }

  /** 当前题号（从 1 开始） */
  get currentNumber(): number {
    return Math.min(this.index + 1, this.questions.length);
  }

  /** 总题数 */
  get total(): number {
    return this.questions.length;
  }

  /** 本题剩余时间（秒） */
  get remainingTime(): number {
    return Math.max(0, this.remaining);
  }

  /** 每题总限时（秒） */
  get limit(): number {
    return this.timeLimit;
  }

  /** 当前连对数 */
  get currentCombo(): number {
    return this.combo;
  }

  /** 本轮最大连对数 */
  get bestCombo(): number {
    return this.maxCombo;
  }

  /** 是否已答完所有题 */
  get isFinished(): boolean {
    return this.finished;
  }

  /**
   * 推进计时器。
   * @param dt 帧间隔（秒）
   * @returns 超时则返回 'timeout'，否则返回 null
   */
  update(dt: number): 'timeout' | null {
    if (this.finished) return null;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.remaining = 0;
      return 'timeout';
    }
    return null;
  }

  /**
   * 提交一次选择（命中了某个选项）。
   * @param selectedIndex 玩家选中的选项索引
   */
  submit(selectedIndex: number): { outcome: AnswerOutcome; record: AnswerRecord } {
    const timeSpent = this.timeLimit - this.remaining;
    const correct = selectedIndex === this.current.answerIndex;
    const record = this.commit({
      questionId: this.current.id,
      correct,
      missed: false,
      timedOut: false,
      timeSpent,
      selectedIndex,
    });
    return { outcome: correct ? 'correct' : 'wrong', record };
  }

  /**
   * 未命中：点停时没有任何选项达到重叠阈值。
   *
   * 规则（主理人定稿）：未命中算答错，提示「没停准，再试一次」，但**不消耗题目数**，
   * 玩家可以继续尝试本题直到超时。
   * 因此这里只记录统计并清零连对，**不推进题号、不重置计时器**，避免玩家靠反复点停拖延时间。
   */
  registerMiss(): { outcome: AnswerOutcome; record: AnswerRecord } {
    const record: AnswerRecord = {
      questionId: this.current.id,
      correct: false,
      missed: true,
      timedOut: false,
      timeSpent: 0,
      selectedIndex: -1,
    };
    this.missRecords.push(record);
    this.missCount++;
    // 未命中会打断连对（因为它确实是一次错误的作答尝试）
    this.combo = 0;
    return { outcome: 'miss', record };
  }

  /** 超时：未能在限时内提交 */
  registerTimeout(): { outcome: AnswerOutcome; record: AnswerRecord } {
    const record = this.commit({
      questionId: this.current.id,
      correct: false,
      missed: false,
      timedOut: true,
      timeSpent: this.timeLimit,
      selectedIndex: -1,
    });
    return { outcome: 'timeout', record };
  }

  /**
   * 汇总本轮答题结果。
   * 分母口径：正确率与平均耗时只统计「已提交的题目」，
   * 未命中（没停准）不占用题目数，也不计入正确率，避免操作失误污染知识掌握度的评价。
   */
  getResult(): QuizResult {
    const answered = this.records.length;
    return {
      totalQuestions: answered,
      correctCount: this.correctCount,
      missCount: this.missCount,
      timeoutCount: this.timeoutCount,
      accuracy: answered > 0 ? this.correctCount / answered : 0,
      maxCombo: this.maxCombo,
      averageAnswerTime: answered > 0 ? this.totalTime / answered : 0,
      totalAnswerTime: this.totalTime,
      records: this.records.slice(),
    };
  }

  /** 未命中记录（供结算面板展示「没停准」次数） */
  getMissRecords(): AnswerRecord[] {
    return this.missRecords.slice();
  }

  /** 记录一次作答并推进到下一题 */
  private commit(record: AnswerRecord): AnswerRecord {
    this.records.push(record);
    this.totalTime += record.timeSpent;

    if (record.correct) {
      this.correctCount++;
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    } else {
      this.combo = 0;
      if (record.missed) this.missCount++;
      if (record.timedOut) this.timeoutCount++;
    }

    this.index++;
    if (this.index >= this.questions.length) {
      this.finished = true;
      this.remaining = 0;
    } else {
      // 进入下一题，重置计时
      this.remaining = this.timeLimit;
    }
    return record;
  }
}
