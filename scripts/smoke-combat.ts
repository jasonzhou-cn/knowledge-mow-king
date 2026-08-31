import { MonsterSpawner } from '../src/systems/MonsterSpawner';
import { CombatSystem } from '../src/systems/CombatSystem';
import { WeaponSystem } from '../src/systems/WeaponSystem';
import { ProjectileSystem } from '../src/systems/ProjectileSystem';
import { KillFxSystem } from '../src/systems/KillFxSystem';
import type { DifficultySettings } from '../src/config/types';

let failures = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log('  PASS  ' + label + (extra ? '  ' + extra : ''));
  } else {
    failures++;
    console.log('  FAIL  ' + label + (extra ? '  ' + extra : ''));
  }
}

/** 最小场景替身：只实现被测系统真正用到的接口 */
function makeScene() {
  const images = [];
  const add = {
    image: (_x, _y, texture) => {
      const img = {
        x: 0,
        y: 0,
        rotation: 0,
        alpha: 1,
        scale: 1,
        texture,
        displayWidth: 40,
        active: false,
        visible: false,
        tint: null,
        tintFilled: false,
        setPosition(x, y) {
          this.x = x;
          this.y = y;
          return this;
        },
        setTint(c) {
          this.tint = c;
          this.tintFilled = false;
          return this;
        },
        setTintFill(c) {
          this.tint = c;
          this.tintFilled = true;
          return this;
        },
        setAlpha(a) {
          this.alpha = a;
          return this;
        },
        setScale(s) {
          this.scale = s;
          return this;
        },
        setDisplaySize(w) {
          this.displayWidth = w;
          return this;
        },
        setRotation(r) {
          this.rotation = r;
          return this;
        },
        setTexture(t) {
          this.texture = t;
          return this;
        },
        setFlipY() {
          return this;
        },
        setActive(v) {
          this.active = v;
          return this;
        },
        setVisible(v) {
          this.visible = v;
          return this;
        },
        setDepth() {
          return this;
        },
        destroy() {},
      };
      images.push(img);
      return img;
    },
    zone: () => ({
      setOrigin() {
        return this;
      },
      setInteractive() {
        return this;
      },
      setDepth() {
        return this;
      },
      on() {
        return this;
      },
      destroy() {},
    }),
    text: () => ({
      setOrigin() {
        return this;
      },
      setDepth() {
        return this;
      },
      setText() {
        return this;
      },
      setColor() {
        return this;
      },
      setFontSize() {
        return this;
      },
      setScale() {
        return this;
      },
      destroy() {},
    }),
    graphics: () => ({
      clear() {
        return this;
      },
      fillStyle() {
        return this;
      },
      fillRoundedRect() {
        return this;
      },
      lineStyle() {
        return this;
      },
      strokeRoundedRect() {
        return this;
      },
      setDepth() {
        return this;
      },
      destroy() {},
    }),
  };
  return {
    add,
    time: { timeScale: 1 },
    cameras: { main: { shake: () => {} } },
    tweens: { add: () => {}, killTweensOf: () => {} },
    images,
  };
}

const difficulty: DifficultySettings = {
  interpolation: 'linear',
  spawnIntervalStart: 0.9,
  spawnIntervalEnd: 0.24,
  batchSizeStart: 2,
  batchSizeEnd: 6,
  hpMultiplierStart: 1,
  hpMultiplierEnd: 2.6,
  moveSpeedMultiplierStart: 1,
  moveSpeedMultiplierEnd: 1.55,
};

console.log('\n[1] MonsterSpawner：四边外围生成 + 难度曲线 + 同屏上限');
{
  const scene = makeScene();
  const spawner = new MonsterSpawner(scene as never, {
    hp: 10,
    damage: 1,
    moveSpeed: 100,
    maxAlive: 60,
    radius: 14,
    scorePerKill: 10,
    knockback: 340,
    knockbackDuration: 0.12,
    spawnMargin: 40,
    poolSize: 96,
    viewWidth: 960,
    viewHeight: 640,
    difficulty,
    corpsePoolSize: 16,
    corpseLife: 0.3,
    corpseSpin: 12,
    corpseDrag: 3,
  });

  spawner.setProgress(0);
  check('t=0 刷怪间隔取起始值', Math.abs(spawner.currentSpawnInterval - 0.9) < 1e-6);
  check('t=0 血量倍率取起始值', Math.abs(spawner.currentHpMultiplier - 1) < 1e-6);
  spawner.setProgress(0.5);
  check('t=0.5 刷怪间隔线性插值', Math.abs(spawner.currentSpawnInterval - 0.57) < 1e-6, `=${spawner.currentSpawnInterval}`);
  check('t=0.5 血量倍率线性插值', Math.abs(spawner.currentHpMultiplier - 1.8) < 1e-6);
  spawner.setProgress(1);
  check('t=1 刷怪间隔取终止值', Math.abs(spawner.currentSpawnInterval - 0.24) < 1e-6);
  check('t=1 移速倍率取终止值', Math.abs(spawner.currentMoveSpeedMultiplier - 1.55) < 1e-6);

  spawner.setProgress(0.5);
  spawner.start();
  spawner.update(10, 480, 320);
  check('持续刷怪（不再受波次数量限制）', spawner.aliveCount > 20, `alive=${spawner.aliveCount}`);
  check('同屏上限硬约束', spawner.aliveCount <= 60, `alive=${spawner.aliveCount}`);
  const hpAtMid = spawner.monsters[0].hp;
  check('新怪吃到当前血量倍率 1.8', Math.abs(hpAtMid - 18) < 1e-6, `hp=${hpAtMid}`);
  const speedAtMid = spawner.monsters[0].speed;
  check('新怪吃到当前移速倍率 1.275', Math.abs(speedAtMid - 127.5) < 1e-6, `speed=${speedAtMid}`);

  spawner.destroy();

  // 另起一个移速为 0 的生成器，保证检查到的就是「生成瞬间」的坐标
  const still = new MonsterSpawner(makeScene() as never, {
    hp: 10, damage: 1, moveSpeed: 0, maxAlive: 60, radius: 14, scorePerKill: 10,
    knockback: 340, knockbackDuration: 0.12, spawnMargin: 40, poolSize: 96,
    viewWidth: 960, viewHeight: 640, difficulty, corpsePoolSize: 16,
    corpseLife: 0.3, corpseSpin: 12, corpseDrag: 3,
  });
  still.setProgress(1);
  still.start();
  still.update(6, 480, 320);
  still.stop();
  let insideAtSpawn = 0;
  for (const m of still.monsters) {
    const x = m.sprite.x;
    const y = m.sprite.y;
    // 视口 960×640，spawnMargin=40，radius=14 → 生成点必须在这之外
    if (x > -54 && x < 1014 && y > -54 && y < 694) insideAtSpawn++;
  }
  check('新生成的小怪都在视口之外（从场外走进来）', insideAtSpawn === 0 && still.aliveCount > 0, `样本=${still.aliveCount} 场内=${insideAtSpawn}`);
  // 四条边都要有产出，才算「四面八方」
  const edges = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const m of still.monsters) {
    if (m.sprite.y < 0) edges.top++;
    else if (m.sprite.y > 640) edges.bottom++;
    else if (m.sprite.x > 960) edges.right++;
    else edges.left++;
  }
  check('四条边均有小怪生成（四面围攻）', edges.top > 0 && edges.bottom > 0 && edges.left > 0 && edges.right > 0, JSON.stringify(edges));
  still.destroy();
}

console.log('\n[2] WeaponSystem：自动瞄准 / 冷却 / 切换');
{
  const scene = makeScene();
  const weapons = [
    { id: 'blade', name: '大刀', icon: '', attackType: 'melee_sector', damage: 34, cooldown: 0.42, range: 132, sectorAngle: 130, projectileSpeed: 0, projectileRadius: 0, pierce: 0, pelletCount: 1, spread: 0, knockback: 300, hitstopDuration: 70, shakeIntensity: 0.006 },
    { id: 'smg', name: '机关枪', icon: '', attackType: 'ranged_bolt', damage: 9, cooldown: 0.09, range: 620, sectorAngle: 0, projectileSpeed: 780, projectileRadius: 5, pierce: 1, pelletCount: 1, spread: 4, knockback: 40, hitstopDuration: 18, shakeIntensity: 0.0015 },
    { id: 'scatter', name: '霰弹枪', icon: '', attackType: 'ranged_spread', damage: 13, cooldown: 0.62, range: 300, sectorAngle: 0, projectileSpeed: 640, projectileRadius: 4, pierce: 0, pelletCount: 5, spread: 26, knockback: 150, hitstopDuration: 40, shakeIntensity: 0.004 },
  ];
  const ws = new WeaponSystem({
    weapons,
    autoAim: { enabled: true, searchRadius: 460, aimAssistAngle: 1080 },
  });

  check('默认使用第一把武器', ws.current.id === 'blade');
  check('nextWeapon 循环切换', ws.nextWeapon() && ws.current.id === 'smg');
  check('prevWeapon 循环回绕', ws.prevWeapon() && ws.prevWeapon() && ws.current.id === 'scatter');
  check('switchTo 越界被拒绝', ws.switchTo(9) === false && ws.current.id === 'scatter');
  ws.switchTo(0);

  const spawner = new MonsterSpawner(scene as never, {
    hp: 10, damage: 1, moveSpeed: 0, maxAlive: 60, radius: 14, scorePerKill: 10,
    knockback: 340, knockbackDuration: 0.12, spawnMargin: 40, poolSize: 96,
    viewWidth: 960, viewHeight: 640, difficulty, corpsePoolSize: 16,
    corpseLife: 0.3, corpseSpin: 12, corpseDrag: 3,
  });
  spawner.start();
  spawner.update(2, 480, 320);
  spawner.stop();
  check('生成器产出小怪供瞄准测试', spawner.aliveCount > 0, `alive=${spawner.aliveCount}`);

  // 只留一只目标，避免其他小怪干扰断言
  const probe = spawner.monsters[0];
  for (const m of spawner.monsters) {
    if (m !== probe) m.alive = false;
  }
  probe.alive = true;
  probe.sprite.setPosition(680, 320);

  const oneMonster = [probe];
  const facingStep = ws.resolveFacing(480, 320, oneMonster, Math.PI, 1 / 60);
  check('自动瞄准按 aimAssistAngle 限速转向（一帧最多 18°）', Math.abs(facingStep - Math.PI) > 0.2 && Math.abs(facingStep - Math.PI) < 0.4, `facing=${facingStep.toFixed(3)}`);
  const facingFull = ws.resolveFacing(480, 320, oneMonster, Math.PI, 100);
  check('足够时间后完全对准目标（0 弧度）', Math.abs(facingFull) < 1e-6, `facing=${facingFull}`);

  // 没有敌人时沿用移动朝向
  const empty = ws.resolveFacing(480, 320, [], -Math.PI / 2, 1);
  check('无目标时沿用移动朝向', Math.abs(empty + Math.PI / 2) < 1e-6);

  // 超出搜索半径时不锁定
  probe.sprite.setPosition(480 + 900, 320);
  const far = ws.resolveFacing(480, 320, oneMonster, Math.PI / 2, 100);
  check('超出搜索半径（460）时用移动朝向', Math.abs(far - Math.PI / 2) < 1e-6);

  // 关闭自动瞄准后应完全沿用移动朝向
  const noAim = new WeaponSystem({
    weapons,
    autoAim: { enabled: false, searchRadius: 460, aimAssistAngle: 1080 },
  });
  probe.sprite.setPosition(680, 320);
  check('autoAim.enabled=false 时不改变朝向', noAim.resolveFacing(480, 320, oneMonster, Math.PI / 2, 100) === Math.PI / 2);
  spawner.destroy();

  const a1 = ws.tryAttack(100, 100, 0);
  check('首次出手成功（冷却初始为 0）', a1 !== null && a1.weapon.id === 'blade');
  const a2 = ws.tryAttack(100, 100, 0);
  check('冷却中再次出手被拒绝', a2 === null);
  check('冷却进度从 0 开始', Math.abs(ws.cooldownRatio()) < 1e-6);
  ws.update(0.21);
  check('半程冷却进度约 0.5', Math.abs(ws.cooldownRatio() - 0.5) < 0.02, `=${ws.cooldownRatio().toFixed(3)}`);
  ws.update(0.21);
  check('冷却走满后可再次出手', ws.tryAttack(100, 100, 0) !== null);
}

console.log('\n[3] CombatSystem：扇形命中、击杀死链、击退强化');
{
  const scene = makeScene();
  const spawner = new MonsterSpawner(scene as never, {
    hp: 10, damage: 1, moveSpeed: 100, maxAlive: 60, radius: 14, scorePerKill: 10,
    knockback: 340, knockbackDuration: 0.12, spawnMargin: 40, poolSize: 96,
    viewWidth: 960, viewHeight: 640, difficulty, corpsePoolSize: 16,
    corpseLife: 0.3, corpseSpin: 12, corpseDrag: 3,
  });
  spawner.start();
  spawner.update(3, 480, 320);
  for (const m of spawner.monsters) m.sprite.setPosition(480 + 9000, 320); // 先挪走

  let killedCount = 0;
  let damagedCount = 0;
  const knockStrengths: number[] = [];
  const combat = new CombatSystem(scene as never, {
    damageCheckFrameInterval: 2,
    killKnockbackMultiplier: 2.6,
    hooks: {
      applyDamage: (m, amount) => spawner.applyDamage(m, amount),
      knockback: (m, dx, dy, s) => {
        knockStrengths.push(s);
        spawner.knockback(m, dx, dy, s);
      },
      showDamage: (m) => {
        damagedCount++;
        spawner.flash(m, 0.07);
      },
      onKill: () => {
        killedCount++;
      },
      registerKill: () => {},
    },
  });

  const target = spawner.monsters[0];
  target.sprite.setPosition(560, 320); // 正右方 80px，在 132 射程内
  let res = combat.sweepSector({
    x: 480, y: 320, facing: 0, range: 132, sectorAngle: 130,
    damage: 34, comboMultiplier: 1, knockback: 300, monsters: spawner.monsters,
  });
  check('扇形内目标被命中并击杀', res.hits === 1 && res.kills === 1, JSON.stringify(res));
  check('击杀击退被强化到 300 × 2.6 = 780', knockStrengths[0] === 780, `=${knockStrengths[0]}`);
  check('击杀回调触发一次', killedCount === 1);
  check('击杀后进入尸体飞散队列', spawner.corpseCount === 1, `corpse=${spawner.corpseCount}`);

  // 背面的目标不该被扇形命中
  const behind = spawner.monsters[1];
  behind.sprite.setPosition(400, 320);
  res = combat.sweepSector({
    x: 480, y: 320, facing: 0, range: 132, sectorAngle: 130,
    damage: 1, comboMultiplier: 1, knockback: 10, monsters: spawner.monsters,
  });
  check('扇形背后的目标不被命中', res.hits === 0, JSON.stringify(res));

  // 射程外的目标不该被命中
  behind.sprite.setPosition(480 + 400, 320);
  res = combat.sweepSector({
    x: 480, y: 320, facing: 0, range: 132, sectorAngle: 130,
    damage: 1, comboMultiplier: 1, knockback: 10, monsters: spawner.monsters,
  });
  check('射程外的目标不被命中', res.hits === 0);

  // 未致死时走伤害飘字分支，且击退不强化
  damagedCount = 0;
  knockStrengths.length = 0;
  const tank = spawner.monsters[2];
  tank.sprite.setPosition(560, 320);
  tank.hp = 100;
  tank.maxHp = 100;
  combat.applyHit({ monster: tank, damage: 5, comboMultiplier: 2, dirX: 1, dirY: 0, knockback: 40 });
  check('未致死时扣血 = damage × 连击乘数', tank.hp === 90, `hp=${tank.hp}`);
  check('未致死时击退不强化', knockStrengths[0] === 40, `=${knockStrengths[0]}`);
  check('未致死时触发伤害飘字回调', damagedCount === 1);
  check('受击闪白生效（tintFill）', tank.sprite.tintFilled === true);

  // 跳帧检测
  combat.reset();
  combat.update();
  const f1 = combat.shouldCheckThisFrame();
  combat.update();
  const f2 = combat.shouldCheckThisFrame();
  check('跳帧检测按 damageCheckFrameInterval=2 隔帧生效', f1 !== f2, `frame1=${f1} frame2=${f2}`);

  spawner.destroy();
}

console.log('\n[4] ProjectileSystem：飞行 / 穿透 / 射程回收 / 池上限');
{
  const scene = makeScene();
  const spawner = new MonsterSpawner(scene as never, {
    hp: 1000, damage: 1, moveSpeed: 0, maxAlive: 60, radius: 14, scorePerKill: 10,
    knockback: 340, knockbackDuration: 0.12, spawnMargin: 40, poolSize: 96,
    viewWidth: 960, viewHeight: 640, difficulty, corpsePoolSize: 16,
    corpseLife: 0.3, corpseSpin: 12, corpseDrag: 3,
  });
  spawner.start();
  spawner.update(2, 480, 320);
  for (const m of spawner.monsters) m.sprite.setPosition(480 + 9000, 320);

  const proj = new ProjectileSystem(scene as never, {
    poolSize: 120, viewWidth: 960, viewHeight: 640, despawnMargin: 40,
  });
  check('对象池容量等于配置上限', proj.capacity === 120);

  const hits: string[] = [];
  proj.fire({ x: 100, y: 320, angle: 0, speed: 780, damage: 9, pierce: 0, knockback: 40, range: 620, radius: 5, texture: 'fx-bolt', tint: 0xffffff, weaponId: 'smg' });
  check('发射后存活数为 1', proj.aliveCount === 1);

  const m1 = spawner.monsters[0];
  m1.sprite.setPosition(300, 320);
  m1.hp = 1000;
  for (let i = 0; i < 60 && proj.aliveCount > 0; i++) {
    proj.update(1 / 60, spawner.monsters, (p) => {
      hits.push(p.monster === m1 ? 'm1' : 'other');
    });
  }
  check('弹丸飞行并命中路径上的小怪', hits.length >= 1, `hits=${hits.length}`);
  check('pierce=0 命中后立即回收', proj.aliveCount === 0);

  // 穿透
  hits.length = 0;
  const m2 = spawner.monsters[1];
  m2.hp = 1000;
  m2.sprite.setPosition(300, 320);
  const m3 = spawner.monsters[2];
  m3.hp = 1000;
  m3.sprite.setPosition(340, 320);
  proj.fire({ x: 100, y: 320, angle: 0, speed: 780, damage: 9, pierce: 1, knockback: 40, range: 620, radius: 5, texture: 'fx-bolt', tint: 0xffffff, weaponId: 'smg' });
  for (let i = 0; i < 60 && proj.aliveCount > 0; i++) {
    proj.update(1 / 60, spawner.monsters, () => hits.push('x'));
  }
  check('pierce=1 命中两只后才消失', hits.length >= 2, `hits=${hits.length}`);

  // 射程耗尽回收
  hits.length = 0;
  proj.fire({ x: 0, y: 320, angle: 0, speed: 780, damage: 9, pierce: 0, knockback: 40, range: 100, radius: 5, texture: 'fx-bolt', tint: 0xffffff, weaponId: 'smg' });
  proj.update(1 / 60, [], () => hits.push('x'));
  check('射程（100px）内不会误回收', proj.aliveCount === 1);
  for (let i = 0; i < 20 && proj.aliveCount > 0; i++) proj.update(1 / 60, [], () => {});
  check('飞满射程后自动回收', proj.aliveCount === 0);

  // 池上限
  proj.clear();
  let ok = 0;
  for (let i = 0; i < 200; i++) {
    if (proj.fire({ x: 0, y: 320, angle: 0, speed: 10, damage: 1, pierce: 0, knockback: 0, range: 1000, radius: 5, texture: 'fx-bolt', tint: 0xffffff, weaponId: 'smg' })) ok++;
  }
  check('池满后拒绝发射（绝不动态扩容）', ok === 120, `fired=${ok}`);
  spawner.destroy();
  proj.destroy();
}

console.log('\n[5] KillFxSystem：顿帧时间缩放 / 最小间隔节流 / 特效池');
{
  const scene = makeScene();
  const settings = {
    hitstopEnabled: true,
    hitstopTimeScale: 0.05,
    shardCount: 5,
    shardSize: 9,
    shardSpeed: 240,
    shardLife: 0.42,
    flashDuration: 90,
    hitFlashDuration: 70,
    killKnockbackMultiplier: 2.6,
    ringFromScale: 0.35,
    ringToScale: 2.6,
    ringDuration: 280,
    corpseLife: 0.3,
    corpseSpin: 12,
    corpseDrag: 3,
    hitstopMinInterval: 90,
    shardDrag: 4,
    cameraShakeEnabled: true,
    comboBigThreshold: 10,
    comboHugeThreshold: 25,
  };
  const fx = new KillFxSystem(scene as never, { settings, shardPoolSize: 60, ringPoolSize: 18 });
  const sc = scene as unknown as { time: { timeScale: number } };

  check('初始 timeScale 正常', sc.time.timeScale === 1);
  fx.requestHitstop(70);
  check('请求顿帧后 timeScale 被压到 0.05', sc.time.timeScale === 0.05);

  // 用真实时间推进 70ms 后恢复
  for (let i = 0; i < 5; i++) fx.update(1 / 60);
  check('70ms 顿帧用 5 帧真实时间结束并恢复 timeScale', sc.time.timeScale === 1, `ts=${sc.time.timeScale}`);

  // 最小间隔节流：刚结束就再请求应被忽略
  fx.requestHitstop(70);
  check('未满最小间隔（90ms）时不再触发顿帧', sc.time.timeScale === 1);
  fx.update(0.1);
  fx.requestHitstop(70);
  check('间隔足够后可再次触发顿帧', sc.time.timeScale === 0.05);
  fx.clear();
  check('clear() 恢复 timeScale', sc.time.timeScale === 1);

  // 顿帧期间不叠加
  fx.requestHitstop(70);
  const before = sc.time.timeScale;
  fx.requestHitstop(18);
  check('顿帧期间的新请求不叠加', sc.time.timeScale === before);
  fx.clear();

  // 特效池
  fx.burst(100, 100, 0xff0000, 1, 0);
  const visibleShards = scene.images.filter((i) => i.visible).length;
  check('击杀爆散生成碎片/圆环/白闪', visibleShards >= 5, `visible=${visibleShards}`);
  fx.updateFx(0.5);
  const afterFade = scene.images.filter((i) => i.visible).length;
  check('特效在存活时长后回收', afterFade < visibleShards, `visible=${afterFade}`);

  // 池上限：连续大量击杀不会超出池容量
  for (let i = 0; i < 50; i++) fx.burst(100, 100, 0xff0000, 1, 0);
  const capped = scene.images.filter((i) => i.visible).length;
  check('特效数量受对象池硬上限约束', capped <= 60 + 18 + 18, `visible=${capped}`);

  fx.clear();
  check('clear() 后无残留可见特效', scene.images.filter((i) => i.visible).length === 0);
  fx.destroy();
}

console.log('\n[6] 顿帧不会把游戏拖成永久慢动作（高频击杀压力测试）');
{
  const scene = makeScene();
  const settings = {
    hitstopEnabled: true, hitstopTimeScale: 0.05, shardCount: 5, shardSize: 9,
    shardSpeed: 240, shardLife: 0.42, flashDuration: 90, hitFlashDuration: 70,
    killKnockbackMultiplier: 2.6, ringFromScale: 0.35, ringToScale: 2.6, ringDuration: 280,
    corpseLife: 0.3, corpseSpin: 12, corpseDrag: 3, hitstopMinInterval: 90,
    shardDrag: 4, cameraShakeEnabled: true, comboBigThreshold: 10, comboHugeThreshold: 25,
  };
  const fx = new KillFxSystem(scene as never, { settings, shardPoolSize: 60, ringPoolSize: 18 });
  const sc = scene as unknown as { time: { timeScale: number } };

  // 模拟机关枪每 90ms 击杀一次，持续 5 秒
  let slowFrames = 0;
  let totalFrames = 0;
  let sinceKill = 0;
  for (let i = 0; i < 300; i++) {
    const rawDt = 1 / 60;
    sinceKill += rawDt;
    if (sinceKill >= 0.09) {
      sinceKill = 0;
      fx.requestHitstop(18);
    }
    fx.update(rawDt);
    fx.updateFx(rawDt * sc.time.timeScale);
    totalFrames++;
    if (fx.hitstopActive) slowFrames++;
  }
  const ratio = slowFrames / totalFrames;
  check('高频击杀下顿帧占比仍受控（<40%）', ratio < 0.4, `慢放占比=${(ratio * 100).toFixed(1)}%`);
  fx.destroy();
}

console.log('');
if (failures === 0) {
  console.log('全部断言通过');
} else {
  console.log('存在 ' + failures + ' 处断言失败');
  process.exitCode = 1;
}
