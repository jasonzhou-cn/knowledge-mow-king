/**
 * QuestionBankStore 单元测试（tests/question-bank.test.ts）
 * 覆盖：加载、学科/难度统计、权重抽题、excludeIds 去重、选项打乱与 answerIndex 重映射、
 *       难度权重档位选择（GDD 1.3 答题公平原则的执行点）。
 * 运行：npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { QuestionBankStore, pickDifficultyWeights } from '../src/data/QuestionBank';
import type { QuestionBank, QuestionEntry } from '../src/config/types';

/** 构造测试题库：3 学科 × 3 难度 × 6 题 = 54 题 */
function makeBank(): QuestionBank {
  const questions: QuestionEntry[] = [];
  let n = 1;
  for (const subject of ['math', 'english', 'science']) {
    for (const difficulty of [1, 2, 3]) {
      for (let i = 0; i < 6; i++) {
        questions.push({
          id: `${subject}-${difficulty}-${i}`,
          subject,
          difficulty,
          question: `Q${n++}`,
          options: ['A', 'B', 'C', 'D'],
          answerIndex: 0,
          explanation: 'expl',
        });
      }
    }
  }
  return { version: 'test', description: 'test bank', questions };
}

test('load 后 size 与 isLoaded 正确', () => {
  const store = new QuestionBankStore();
  assert.equal(store.isLoaded, false);
  store.load(makeBank());
  assert.equal(store.isLoaded, true);
  assert.equal(store.size, 54);
});

test('countBy 按学科与难度统计', () => {
  const store = new QuestionBankStore();
  store.load(makeBank());
  assert.equal(store.countBy('math'), 18);
  assert.equal(store.countBy('math', 2), 6);
  assert.equal(store.countBy('nope'), 0);
  assert.equal(store.countBy('math', 9), 0);
});

test('listSubjects 列出全部学科', () => {
  const store = new QuestionBankStore();
  store.load(makeBank());
  assert.deepEqual([...store.listSubjects()].sort(), ['english', 'math', 'science']);
});

test('draw 未加载时抛中文错误', () => {
  const store = new QuestionBankStore();
  assert.throws(() => store.draw({ subject: 'math', count: 3, difficultyWeights: { '1': 1 } }), /尚未加载/);
});

test('draw 空学科抛中文错误', () => {
  const store = new QuestionBankStore();
  store.load(makeBank());
  assert.throws(() => store.draw({ subject: 'nope', count: 3, difficultyWeights: { '1': 1 } }), /题库为空/);
});

test('draw 按权重分配难度档（最后一档吃余数）', () => {
  const store = new QuestionBankStore();
  store.load(makeBank());
  const drawn = store.draw({
    subject: 'math',
    count: 6,
    difficultyWeights: { '1': 0.5, '2': 0.5, '3': 0 },
  });
  assert.equal(drawn.length, 6);
  const byDiff = { 1: 0, 2: 0, 3: 0 };
  for (const q of drawn) byDiff[q.difficulty]++;
  assert.equal(byDiff[1], 3, '0.5 * 6 = 3 题难度 1');
  assert.equal(byDiff[2], 3, '余数档吃下 3 题难度 2');
  assert.equal(byDiff[3], 0);
});

test('draw 难度档题量不足时从全库补齐', () => {
  const store = new QuestionBankStore();
  store.load(makeBank());
  // 难度 1 只有 6 题，要 9 题，剩余 3 题应从其他难度补齐
  const drawn = store.draw({ subject: 'math', count: 9, difficultyWeights: { '1': 1, '2': 0, '3': 0 } });
  assert.equal(drawn.length, 9);
  const ids = new Set(drawn.map((q) => q.id));
  assert.equal(ids.size, 9, '同一轮题目 id 不应重复');
});

test('draw excludeIds 生效（数组传法）', () => {
  const store = new QuestionBankStore();
  store.load(makeBank());
  const first = store.draw({
    subject: 'math',
    count: 6,
    difficultyWeights: { '1': 1, '2': 0, '3': 0 },
  });
  const ids: string[] = first.map((q) => q.id);
  const second = store.draw({
    subject: 'math',
    count: 6,
    difficultyWeights: { '1': 1, '2': 0, '3': 0 },
    excludeIds: ids,
  });
  assert.equal(second.length, 6);
  for (const q of second) {
    assert.ok(!ids.includes(q.id), `excludeIds 未生效：${q.id} 被重复抽出`);
  }
});

test('draw excludeIds 兼容 Set 传法（防御性）', () => {
  const store = new QuestionBankStore();
  store.load(makeBank());
  const first = store.draw({
    subject: 'math',
    count: 6,
    difficultyWeights: { '1': 1, '2': 0, '3': 0 },
  });
  const ids = new Set(first.map((q) => q.id));
  const second = store.draw({
    subject: 'math',
    count: 6,
    difficultyWeights: { '1': 1, '2': 0, '3': 0 },
    excludeIds: ids,
  });
  assert.equal(second.length, 6);
  for (const q of second) {
    assert.ok(!ids.has(q.id), `excludeIds(Set) 未生效：${q.id} 被重复抽出`);
  }
});

test('draw 打乱选项但保持正确内容一致（答题公平原则）', () => {
  const store = new QuestionBankStore();
  store.load(makeBank());
  const drawn = store.draw({ subject: 'math', count: 6, difficultyWeights: { '1': 1, '2': 0, '3': 0 } });
  for (const q of drawn) {
    assert.equal(q.options.length, 4);
    assert.deepEqual([...q.options].sort(), ['A', 'B', 'C', 'D'], '打乱后选项集合必须与源题一致');
    assert.equal(q.correctText, 'A', 'correctText 应等于源题的正确选项');
    assert.equal(q.options[q.answerIndex], q.correctText, 'answerIndex 必须指向打乱后的正确选项');
  }
});

test('draw 多次抽取无重复题目（同轮内）', () => {
  const store = new QuestionBankStore();
  store.load(makeBank());
  const drawn = store.draw({ subject: 'science', count: 12, difficultyWeights: { '1': 1 / 3, '2': 1 / 3, '3': 1 / 3 } });
  assert.equal(drawn.length, 12);
  const ids = new Set(drawn.map((q) => q.id));
  assert.equal(ids.size, 12, '同轮抽题不允许出现重复题目');
});

test('pickDifficultyWeights 按等级选择权重档', () => {
  const selection = {
    lowLevelMax: 3,
    midLevelMax: 6,
    weightsLow: { '1': 0.8, '2': 0.2, '3': 0 },
    weightsMid: { '1': 0.2, '2': 0.6, '3': 0.2 },
    weightsHigh: { '1': 0, '2': 0.4, '3': 0.6 },
  };
  assert.deepEqual(pickDifficultyWeights(1, selection), selection.weightsLow);
  assert.deepEqual(pickDifficultyWeights(3, selection), selection.weightsLow);
  assert.deepEqual(pickDifficultyWeights(4, selection), selection.weightsMid);
  assert.deepEqual(pickDifficultyWeights(6, selection), selection.weightsMid);
  assert.deepEqual(pickDifficultyWeights(7, selection), selection.weightsHigh);
  assert.deepEqual(pickDifficultyWeights(50, selection), selection.weightsHigh);
});
