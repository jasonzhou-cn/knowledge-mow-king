/**
 * QuizEngine 单元测试（tests/quiz-engine.test.ts）
 * 覆盖：题目生命周期（推进/结束）、判题（对/错/超时/未命中）、连对统计、
 *       未命中不消耗题目数、结果汇总口径（正确率/平均耗时/连对峰值）。
 * 运行：npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { QuizEngine } from '../src/systems/QuizEngine';
import type { DrawnQuestion } from '../src/data/QuestionBank';

function makeQuestions(count: number): DrawnQuestion[] {
  const qs: DrawnQuestion[] = [];
  for (let i = 0; i < count; i++) {
    qs.push({
      id: `q${i}`,
      subject: 'math',
      difficulty: 1,
      question: `第 ${i + 1} 题`,
      options: ['A', 'B', 'C', 'D'],
      answerIndex: 0,
      correctText: 'A',
      explanation: 'exp',
    });
  }
  return qs;
}

test('空题目列表构造抛错', () => {
  assert.throws(() => new QuizEngine({ questions: [], timeLimit: 10 }), /至少需要一道题目/);
});

test('答对推进题号并累计连对', () => {
  const engine = new QuizEngine({ questions: makeQuestions(3), timeLimit: 10 });
  assert.equal(engine.currentNumber, 1);
  const r1 = engine.submit(0);
  assert.equal(r1.outcome, 'correct');
  assert.equal(engine.currentCombo, 1);
  assert.equal(engine.currentNumber, 2);
  const r2 = engine.submit(0);
  assert.equal(r2.outcome, 'correct');
  assert.equal(engine.currentCombo, 2);
  assert.equal(engine.bestCombo, 2);
});

test('答错清零连对', () => {
  const engine = new QuizEngine({ questions: makeQuestions(3), timeLimit: 10 });
  engine.submit(0);
  const r = engine.submit(1);
  assert.equal(r.outcome, 'wrong');
  assert.equal(engine.currentCombo, 0);
});

test('update 按 dt 递减剩余时间，超时返回 timeout', () => {
  const engine = new QuizEngine({ questions: makeQuestions(2), timeLimit: 10 });
  engine.update(4);
  assert.equal(engine.remainingTime, 6);
  const result = engine.update(7);
  assert.equal(result, 'timeout');
  assert.equal(engine.remainingTime, 0);
});

test('registerTimeout 计入超时并推进题目', () => {
  const engine = new QuizEngine({ questions: makeQuestions(2), timeLimit: 10 });
  const r = engine.registerTimeout();
  assert.equal(r.outcome, 'timeout');
  assert.equal(engine.currentNumber, 2);
  const result = engine.getResult();
  assert.equal(result.timeoutCount, 1);
  assert.equal(result.correctCount, 0);
});

test('registerMiss 不消耗题目数但清零连对', () => {
  const engine = new QuizEngine({ questions: makeQuestions(2), timeLimit: 10 });
  engine.submit(0);
  assert.equal(engine.currentNumber, 2, '答完第一题后题号应推进到 2');
  const r = engine.registerMiss();
  assert.equal(r.outcome, 'miss');
  assert.equal(engine.currentCombo, 0, '未命中应清零连对');
  assert.equal(engine.currentNumber, 2, '未命中不应推进题号');
  const result = engine.getResult();
  assert.equal(result.missCount, 1);
  assert.equal(result.totalQuestions, 1, '未命中不计入已答题目数');
  assert.equal(engine.getMissRecords().length, 1);
});

test('getResult 汇总正确率、平均耗时与连对峰值', () => {
  const engine = new QuizEngine({ questions: makeQuestions(4), timeLimit: 10 });
  engine.submit(0); // correct, 耗时 0
  engine.update(4);
  engine.submit(0); // correct, 耗时 4
  engine.submit(1); // wrong, 耗时 0
  engine.registerTimeout(); // timeout, 耗时 10
  const r = engine.getResult();
  assert.equal(r.totalQuestions, 4);
  assert.equal(r.correctCount, 2);
  assert.equal(r.timeoutCount, 1);
  assert.equal(r.accuracy, 0.5);
  assert.equal(r.maxCombo, 2);
  assert.equal(r.averageAnswerTime, (0 + 4 + 0 + 10) / 4);
  assert.equal(r.records.length, 4);
});

test('答完所有题后 isFinished 为 true 且不再推进', () => {
  const engine = new QuizEngine({ questions: makeQuestions(2), timeLimit: 10 });
  engine.submit(0);
  assert.equal(engine.isFinished, false);
  engine.submit(0);
  assert.equal(engine.isFinished, true);
  assert.equal(engine.currentNumber, 2);
  // 结束后 update 不再返回超时
  assert.equal(engine.update(99), null);
});

test('current 与 total 在边界外仍安全（不越界崩溃）', () => {
  const engine = new QuizEngine({ questions: makeQuestions(1), timeLimit: 10 });
  assert.equal(engine.total, 1);
  assert.equal(engine.current.id, 'q0');
  engine.submit(0);
  assert.equal(engine.current.id, 'q0', '结束后 current 应停留最后一题而非越界');
});
