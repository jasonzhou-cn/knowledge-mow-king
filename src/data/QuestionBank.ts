/**
 * 题库加载与抽题（src/data/QuestionBank.ts）
 * 职责：加载 questionBank.json，按「学科 + 难度档」抽题，并在每次抽题时随机打乱选项位置。
 * 铁律（GDD 1.3 答题公平原则）：4 个选项的移动方式、速度、尺寸、颜色完全一致，
 *      唯一的区别只有「内容」，且内容位置必须随机打乱，否则玩家会记住位置而非知识。
 */

import type { QuestionBank, QuestionEntry } from '../config/types';
import { shuffle } from '../utils/MathUtil';

/** 抽题后的问题对象：options 已被打乱，answerIndex 已重新映射 */
export interface DrawnQuestion extends Omit<QuestionEntry, 'options' | 'answerIndex'> {
  options: string[];
  answerIndex: number;
  /** 打乱前的原始正确内容，便于结算时展示 */
  correctText: string;
}

/** 抽题参数 */
export interface DrawOptions {
  subject: string;
  /** 需要的题数 */
  count: number;
  /** 难度权重，键为 "1" | "2" | "3"，值为权重 */
  difficultyWeights: Record<string, number>;
  /** 需要排除的题目 id（避免同一轮重复） */
  excludeIds?: string[];
}

export class QuestionBankStore {
  private questions: QuestionEntry[] = [];
  private bySubject = new Map<string, QuestionEntry[]>();
  private loaded = false;

  /** 已加载题目总数 */
  get size(): number {
    return this.questions.length;
  }

  /** 是否已加载 */
  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * 载入题库配置。
   * @param bank questionBank.json 的解析结果
   */
  load(bank: QuestionBank): void {
    this.questions = bank.questions.slice();
    this.bySubject.clear();
    for (const q of this.questions) {
      const list = this.bySubject.get(q.subject);
      if (list) list.push(q);
      else this.bySubject.set(q.subject, [q]);
    }
    this.loaded = true;
  }

  /** 统计某学科某难度的可用题数，供 UI 与校验展示 */
  countBy(subject: string, difficulty?: number): number {
    const list = this.bySubject.get(subject) ?? [];
    if (difficulty === undefined) return list.length;
    return list.filter((q) => q.difficulty === difficulty).length;
  }

  /** 列出题库中出现的全部学科 key */
  listSubjects(): string[] {
    return [...this.bySubject.keys()];
  }

  /**
   * 按学科与难度权重抽题。
   * @throws 题库未加载或可用题数为 0 时抛出中文错误
   */
  draw(options: DrawOptions): DrawnQuestion[] {
    if (!this.loaded) {
      throw new Error('题库尚未加载，请先调用 QuestionBankStore.load()');
    }
    const pool = (this.bySubject.get(options.subject) ?? []).filter(
      (q) => !options.excludeIds || !options.excludeIds.includes(q.id),
    );
    if (pool.length === 0) {
      throw new Error(
        `学科「${options.subject}」题库为空，无法出题。请检查 questionBank.json 是否包含该学科的题目。`,
      );
    }

    // 按权重把题数分摊到各难度档，再在档内随机抽取
    const weightEntries = Object.entries(options.difficultyWeights).filter(([, w]) => w > 0);
    const totalWeight = weightEntries.reduce((sum, [, w]) => sum + w, 0);

    const picked: QuestionEntry[] = [];
    const usedIds = new Set<string>();

    for (let i = 0; i < weightEntries.length; i++) {
      const [diffKey, weight] = weightEntries[i];
      const difficulty = Number(diffKey);
      // 保证总量精确等于 count：最后一档吃掉余数
      const isLast = i === weightEntries.length - 1;
      const share = isLast
        ? options.count - picked.length
        : Math.round((weight / Math.max(0.0001, totalWeight)) * options.count);

      const bucket = pool.filter((q) => q.difficulty === difficulty && !usedIds.has(q.id));
      if (bucket.length === 0 || share <= 0) continue;

      const shuffledBucket = shuffle(bucket.slice());
      const take = Math.min(share, shuffledBucket.length);
      for (let k = 0; k < take; k++) {
        const q = shuffledBucket[k];
        usedIds.add(q.id);
        picked.push(q);
      }
    }

    // 任何一档题量不足时，从全库补齐，保证题数始终满足关卡要求
    if (picked.length < options.count) {
      const filler = shuffle(
        pool.filter((q) => !usedIds.has(q.id)),
      );
      for (const q of filler) {
        if (picked.length >= options.count) break;
        usedIds.add(q.id);
        picked.push(q);
      }
    }

    // 打乱题目顺序，避免难度档总是按固定顺序出现
    return shuffle(picked.slice(0, options.count)).map((q) => this.shuffleOptions(q));
  }

  /**
   * 随机打乱某题的 4 个选项位置，并同步修正 answerIndex。
   * 这是答题公平原则的执行点：正确答案出现在四个位置上的概率完全相同。
   */
  private shuffleOptions(question: QuestionEntry): DrawnQuestion {
    const correctText = question.options[question.answerIndex];
    const indices = question.options.map((_, i) => i);
    shuffle(indices);

    const options = indices.map((i) => question.options[i]);
    const answerIndex = options.indexOf(correctText);

    return {
      id: question.id,
      subject: question.subject,
      difficulty: question.difficulty,
      question: question.question,
      explanation: question.explanation,
      options,
      answerIndex,
      correctText,
    };
  }
}

/**
 * 全局题库单例。
 * ES Module 天然单例，跨场景共享同一份已加载题库，避免重复解析。
 */
export const questionBank = new QuestionBankStore();

/**
 * 按等级选择难度权重（配置驱动）。
 * 低等级以难度 1 为主，中等级过渡到 2，高等级以 2、3 为主。
 */
export function pickDifficultyWeights(
  level: number,
  selection: { lowLevelMax: number; midLevelMax: number; weightsLow: Record<string, number>; weightsMid: Record<string, number>; weightsHigh: Record<string, number> },
): Record<string, number> {
  if (level <= selection.lowLevelMax) return selection.weightsLow;
  if (level <= selection.midLevelMax) return selection.weightsMid;
  return selection.weightsHigh;
}

/** 列出题库中出现的全部学科 key，供调试面板与启动自检展示 */
export function listSubjects(): string[] {
  return questionBank.listSubjects();
}

/** 按学科 / 难度统计题库分布，返回可直接展示的中文摘要 */
export function describeBank(): string {
  return questionBank
    .listSubjects()
    .map((subject) => {
      const total = questionBank.countBy(subject);
      const d1 = questionBank.countBy(subject, 1);
      const d2 = questionBank.countBy(subject, 2);
      const d3 = questionBank.countBy(subject, 3);
      return `${subject}: 共${total}题 (难度1:${d1} 难度2:${d2} 难度3:${d3})`;
    })
    .join('；');
}
