/**
 * 机关枪过热状态机单元测试（tests/weapon-overheat.test.ts，T-033）
 * 覆盖：连射累计热量 → 打满锁定 → 锁定期 tryAttack 拒绝 → 停手散热 → 解锁恢复。
 * 运行：npm test（esbuild 转译 + node --test，零外部依赖）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WeaponSystem } from '../src/systems/WeaponSystem';
import type { ResolvedWeapon } from '../src/config/resolve';

function makeWeapons(): ResolvedWeapon[] {
  return [
    {
      id: 'smg', name: '机关枪', attackType: 'ranged_bolt',
      damage: 7.5, cooldown: 0.1, range: 500, sectorAngle: 0,
      projectileSpeed: 780, projectileRadius: 5, pierce: 1, pelletCount: 1, spread: 4,
      knockback: 40, damageGrowthPerLevel: 0.2, hitstopDuration: 18, shakeIntensity: 0.0015,
      overheat: { shotsToOverheat: 5, coolPerSec: 2, lockSec: 2 },
    },
    {
      id: 'blade', name: '大刀', attackType: 'melee_sector',
      damage: 30, cooldown: 0.46, range: 150, sectorAngle: 120,
      projectileSpeed: 0, projectileRadius: 0, pierce: 0, pelletCount: 1, spread: 0,
      knockback: 260, damageGrowthPerLevel: 0.2, hitstopDuration: 70, shakeIntensity: 0.006,
    },
  ] as unknown as ResolvedWeapon[];
}

function makeSystem(): WeaponSystem {
  return new WeaponSystem({
    weapons: makeWeapons(),
    autoAim: { enabled: false, searchRadius: 300, aimAssistAngle: 0 },
  });
}

test('连射 5 发后过热锁定：tryAttack 拒绝出手', () => {
  const ws = makeSystem();
  for (let i = 0; i < 5; i++) {
    assert.ok(ws.tryAttack(0, 0, 0) !== null, `第 ${i + 1} 发应成功`);
    ws.update(0.1); // 推进一个冷却周期（连续开火：出手帧不散热）
  }
  assert.equal(ws.heatRatio(0), 1);
  assert.equal(ws.isLocked(0), true);
  assert.equal(ws.tryAttack(0, 0, 0), null, '锁定中不得出手');
});

test('锁定期满自动恢复（2 秒）', () => {
  const ws = makeSystem();
  for (let i = 0; i < 5; i++) { ws.tryAttack(0, 0, 0); ws.update(0.1); }
  // 锁定 2 秒：期间不出手
  ws.update(1.0); ws.update(1.0);
  assert.equal(ws.isLocked(0), false);
  assert.ok(ws.tryAttack(0, 0, 0) !== null, '锁定结束后恢复出手');
});

test('停手散热：不射击时热量按 coolPerSec 下降', () => {
  const ws = makeSystem();
  for (let i = 0; i < 4; i++) { ws.tryAttack(0, 0, 0); ws.update(0.1); }
  const before = ws.heatRatio(0);
  for (let i = 0; i < 50; i++) ws.update(0.1); // 5 秒不射击 → 热量清零
  assert.ok(ws.heatRatio(0) < before);
  assert.equal(ws.heatRatio(0), 0);
});

test('持续射击热量只增不减（出手帧不散热）', () => {
  const ws = makeSystem();
  for (let i = 0; i < 3; i++) { ws.tryAttack(0, 0, 0); ws.update(0.1); }
  const after3 = ws.heatRatio(0);
  assert.ok(after3 > 0);
  assert.ok(Math.abs(after3 - 3 / 5) < 0.01, `3 连射后热量应为 3/5，实际 ${after3}`);
});

test('切到无过热武器：热量保留且该武器 heatRatio 恒 0', () => {
  const ws = makeSystem();
  for (let i = 0; i < 3; i++) { ws.tryAttack(0, 0, 0); ws.update(0.1); }
  ws.switchTo(1);
  assert.equal(ws.heatRatio(1), 0, '大刀无过热配置');
  // 切走后 smg 不开火 → 持续散热
  for (let i = 0; i < 50; i++) ws.update(0.1);
  assert.equal(ws.heatRatio(0), 0, '切走期间 smg 被动散热清零');
});

test('reset 清空热量与锁定', () => {
  const ws = makeSystem();
  for (let i = 0; i < 5; i++) { ws.tryAttack(0, 0, 0); ws.update(0.1); }
  ws.reset();
  assert.equal(ws.heatRatio(0), 0);
  assert.equal(ws.isLocked(0), false);
});
