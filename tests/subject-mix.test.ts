/**
 * 学科混排单元测试（tests/subject-mix.test.ts，T-032 小朋友试玩反馈）
 * 覆盖：pickSubjectForRound 的主学科概率回落、其他学科均匀混入、
 *       排除已用题后的可用性判定、主学科题池耗尽时的安全回落。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { QuestionBankStore } from '../src/data/QuestionBank';
import type { QuestionBank } from '../src/config/types';

function makeBank(counts: Record<string, number>): QuestionBankStore {
  const questions = Object.entries(counts).flatMap(([subject, n]) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${subject}_${i}`,
      subject,
      difficulty: 1,
      question: `Q ${subject} ${i}`,
      options: ['a', 'b', 'c', 'd'],
      answerIndex: 0,
      explanation: 'e',
      solution: 's',
    })),
  );
  const bank = new QuestionBankStore();
  bank.load({ version: 'test', description: '', questions } as unknown as QuestionBank);
  return bank;
}

test('primaryRatio=1 时始终主学科（旧行为）', () => {
  const bank = makeBank({ math: 5, english: 5 });
  for (let i = 0; i < 30; i++) {
    assert.equal(bank.pickSubjectForRound('math', 1), 'math');
  }
});

test('primaryRatio=0 时只出其他学科（若存在）', () => {
  const bank = makeBank({ math: 5, english: 5, science: 5 });
  for (let i = 0; i < 30; i++) {
    const picked = bank.pickSubjectForRound('math', 0);
    assert.ok(picked === 'english' || picked === 'science');
  }
});

test('listAvailableSubjects 尊重排除集：主学科耗尽后安全回落', () => {
  const bank = makeBank({ math: 2, english: 3 });
  const used = new Set(['math_0', 'math_1']);
  // 主学科全部用掉 → 不应再选 math
  for (let i = 0; i < 20; i++) {
    assert.notEqual(bank.pickSubjectForRound('math', 1, used), 'math');
  }
  assert.deepEqual(bank.listAvailableSubjects(used), ['english']);
});

test('题库只有一个学科时混排安全回落到主学科', () => {
  const bank = makeBank({ math: 3 });
  for (let i = 0; i < 20; i++) {
    assert.equal(bank.pickSubjectForRound('math', 0), 'math');
  }
});

test('混排确实产生多学科分布（统计性断言，宽松）', () => {
  const bank = makeBank({ math: 30, english: 30, science: 30 });
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) {
    seen.add(bank.pickSubjectForRound('math', 0.5));
  }
  assert.ok(seen.size >= 2, `60 次抽取只出现了 ${seen.size} 种学科`);
});
