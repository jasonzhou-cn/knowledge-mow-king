/**
 * 小怪生成器（src/systems/MonsterSpawner.ts）
 * 职责：按「时间驱动难度曲线」从屏幕四边外围持续刷怪、驱动其追向玩家，
 *      并在击杀后让小怪沿命中方向飞散，全部精灵走对象池复用。
 *
 * 改造说明：原实现是「按波次刷怪、刷完 waveCount 波就结束」，
 *      现按生存关形态改为「整关持续涌来 + 难度随 t = 已用时间/总时长 连续爬升」，
 *      刷怪间隔、每批数量、血量倍率、移速倍率四项全部在 [start, end] 之间插值。
 *
 * 性能红线（GDD 1.2）：
 *  - 同屏存活数硬上限 maxAlive，超出即暂停生成，绝不无限创建；
 *  - 精灵（含尸体）全部预分配进对象池，运行期零 GC 压力；
 *  - 移动只做「归一化方向 × 速度」，不做任何物理碰撞。
 */

import Phaser from 'phaser';
import type { BossSettings, DifficultySettings, ResolvedBossTemplate } from '../config/types';
import { Palette } from '../ui/Palette';
import { clamp01, lerp } from '../utils/MathUtil';

/** 单只小怪的运行时数据 */
export interface Monster {
  sprite: Phaser.GameObjects.Image;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  score: number;
  radius: number;
  alive: boolean;
  /** 是否 Boss：不占小怪同屏名额、免疫击退、有专属血条与通关逻辑 */
  isBoss: boolean;
  /** T-027 是否迷你 Boss（考神召唤的环绕分身）：不占同屏名额、不追人、0 伤害、不计分 */
  isMiniboss: boolean;
  /** T-027 迷你 Boss 的主题底色（0 = 非迷你 Boss，refreshTint 走常规混色） */
  baseTint: number;
  /** 击退速度（像素/秒） */
  knockbackX: number;
  knockbackY: number;
  /** 击退剩余时间（秒） */
  knockbackTime: number;
  /** 受击闪白剩余时间（秒），0 表示未在闪白 */
  flashTime: number;
  /** 尸体飞散剩余时间（秒），> 0 表示已死亡但仍在飞 */
  corpseTime: number;
  /** 尸体自转角速度（弧度/秒） */
  corpseSpin: number;
}

/** 生成器参数（成长与难度曲线的原始数值全部来自 config，本文件只做插值） */
export interface MonsterSpawnerOptions {
  hp: number;
  damage: number;
  moveSpeed: number;
  /** 同屏存活上限（性能红线） */
  maxAlive: number;
  radius: number;
  scorePerKill: number;
  /** 接触击退速度（像素/秒） */
  knockback: number;
  /** 接触击退持续时长（秒） */
  knockbackDuration: number;
  /** 生成点距视口边缘的外扩距离（像素） */
  spawnMargin: number;
  poolSize: number;
  viewWidth: number;
  viewHeight: number;
  /** 时间驱动难度曲线的起止值 */
  difficulty: DifficultySettings;
  /** 击杀后尸体飞散的同屏上限，0 = 关闭尸体飞散 */
  corpsePoolSize: number;
  corpseLife: number;
  corpseSpin: number;
  corpseDrag: number;
  /** 是否 Boss 关（levelConfig.bossLevel）；true 时按 boss 数值生成 Boss */
  isBossLevel?: boolean;
  /** Boss 数值（仅 isBossLevel 时消费）。
   *  T-022 升级：兼容旧 BossSettings 形态，新接口消费 ResolvedBossTemplate（含阶段 + 技能）。 */
  boss?: BossSettings | ResolvedBossTemplate;
}

export class MonsterSpawner {
  private readonly scene: Phaser.Scene;
  private readonly opts: MonsterSpawnerOptions;
  private readonly pool: Monster[] = [];
  private readonly activeList: Monster[] = [];
  private readonly corpses: Monster[] = [];

  private spawnTimer = 0;
  private running = false;

  /** Boss 关：Boss 本体（存活时在 activeList 里，isBoss=true） */
  private bossMonster: Monster | null = null;
  /** Boss 生成倒计时（秒） */
  private bossSpawnTimer = 0;
  /** Boss 是否已生成 */
  private bossSpawnedFlag = false;
  /** T-022：Boss 当前阶段序号（0..n，未生成或已死亡时 = 0） */
  private bossCurrentPhase = 0;
  /** T-022：Boss 阶段切换回调列表（按订阅顺序触发） */
  private phaseChangeListeners: Array<(newPhaseIndex: number) => void> = [];
  /** T-022：Boss 死亡回调列表（用于 BossSkillController 停止调度） */
  private bossDeathListeners: Array<() => void> = [];
  /** T-027：存活迷你 Boss 数量（不占小怪同屏名额，计卡时剔除） */
  private minibossCount = 0;

  /** 由 setProgress 计算出的当前难度值 */
  private spawnInterval = 1;
  private batchSize = 1;
  private hpMultiplier = 1;
  private moveSpeedMultiplier = 1;

  constructor(scene: Phaser.Scene, opts: MonsterSpawnerOptions) {
    this.scene = scene;
    this.opts = opts;
    this.spawnInterval = opts.difficulty.spawnIntervalStart;
    this.batchSize = opts.difficulty.batchSizeStart;
    this.hpMultiplier = opts.difficulty.hpMultiplierStart;
    this.moveSpeedMultiplier = opts.difficulty.moveSpeedMultiplierStart;
    this.preallocate();
  }

  /** 当前存活的小怪列表（只读引用，勿在外部增删） */
  get monsters(): readonly Monster[] {
    return this.activeList;
  }

  /** 当前存活数量 */
  get aliveCount(): number {
    return this.activeList.length;
  }

  /** 当前正在飞散的尸体数量 */
  get corpseCount(): number {
    return this.corpses.length;
  }

  /** 当前刷怪间隔（秒），HUD 与调试用 */
  get currentSpawnInterval(): number {
    return this.spawnInterval;
  }

  /** 当前每批刷怪数量 */
  get currentBatchSize(): number {
    return this.batchSize;
  }

  /** 当前血量倍率 */
  get currentHpMultiplier(): number {
    return this.hpMultiplier;
  }

  /** 当前移速倍率 */
  get currentMoveSpeedMultiplier(): number {
    return this.moveSpeedMultiplier;
  }

  /** Boss 是否存活（生成且未被击杀） */
  get bossAlive(): boolean {
    return this.bossMonster !== null && this.bossMonster.alive;
  }

  /** Boss 是否已生成（用于区分「即将降临」与「战斗中」的 UI 文案） */
  get bossSpawned(): boolean {
    return this.bossSpawnedFlag;
  }

  /** Boss 当前血量比例 0~1；未生成或已死亡返回 0 */
  get bossHpRatio(): number {
    const b = this.bossMonster;
    if (!b || !b.alive || b.maxHp <= 0) return 0;
    return clamp01(b.hp / b.maxHp);
  }

  /** T-022：Boss 当前阶段序号（0..n） */
  get bossPhaseIndex(): number {
    return this.bossCurrentPhase;
  }

  /** T-022：注册 Boss 阶段切换回调（MonsterSpawner 在 hp 跨过阈值时触发）。
   *  返回退订函数，避免外部忘记解绑造成泄漏。 */
  onBossPhaseChange(listener: (newPhaseIndex: number) => void): () => void {
    this.phaseChangeListeners.push(listener);
    return () => {
      const idx = this.phaseChangeListeners.indexOf(listener);
      if (idx >= 0) this.phaseChangeListeners.splice(idx, 1);
    };
  }

  /** T-022：注册 Boss 死亡回调（用于 BossSkillController 停止调度）。 */
  onBossDeath(listener: () => void): () => void {
    this.bossDeathListeners.push(listener);
    return () => {
      const idx = this.bossDeathListeners.indexOf(listener);
      if (idx >= 0) this.bossDeathListeners.splice(idx, 1);
    };
  }

  /** Boss 当前坐标；未生成或已死亡返回 null（供自动瞄准验证/调试） */
  get bossPosition(): { x: number; y: number } | null {
    const b = this.bossMonster;
    if (!b || !b.alive) return null;
    return { x: b.sprite.x, y: b.sprite.y };
  }

  /** 开始刷怪 */
  start(): void {
    this.running = true;
    this.spawnTimer = 0;
    this.bossSpawnTimer = 0;
  }

  /** 停止刷怪（关卡结束时调用） */
  stop(): void {
    this.running = false;
  }

  /**
   * 按生存进度刷新难度。
   * @param t 已用时间 / 本关总时长，自动钳制到 [0, 1]
   */
  setProgress(t: number): void {
    const d = this.opts.difficulty;
    const k = d.interpolation === 'smoothstep' ? smoothstep(clamp01(t)) : clamp01(t);
    this.spawnInterval = lerp(d.spawnIntervalStart, d.spawnIntervalEnd, k);
    this.batchSize = lerp(d.batchSizeStart, d.batchSizeEnd, k);
    this.hpMultiplier = lerp(d.hpMultiplierStart, d.hpMultiplierEnd, k);
    this.moveSpeedMultiplier = lerp(d.moveSpeedMultiplierStart, d.moveSpeedMultiplierEnd, k);
  }

  /**
   * 推进生成与小怪移动。
   * @param dt 帧间隔（秒）
   * @param playerX 玩家 X
   * @param playerY 玩家 Y
   */
  update(dt: number, playerX: number, playerY: number): void {
    if (this.running) {
      this.updateSpawning(dt);
      this.updateBoss(dt);
      this.checkBossPhaseChange();
    }
    this.updateMonsters(dt, playerX, playerY);
    this.updateCorpses(dt);
  }

  /**
   * 对小怪造成伤害。
   * @returns 若本次伤害导致死亡则返回 true
   */
  applyDamage(monster: Monster, amount: number): boolean {
    if (!monster.alive) return false;
    monster.hp -= amount;
    if (monster.hp <= 0) {
      this.kill(monster);
      // T-022：Boss 死亡时通知外部停止技能调度
      if (monster.isBoss) {
        for (const fn of this.bossDeathListeners) {
          try { fn(); } catch { /* 忽略回调异常，避免影响战斗 */ }
        }
      }
      return true;
    }
    // 血量越低颜色越暗，给玩家「快死了」的即时反馈（无需额外血条对象）
    if (monster.flashTime <= 0) this.refreshTint(monster);
    return false;
  }

  /**
   * 沿单位方向击退小怪，避免贴脸糊成一团。
   * @param strength 击退速度（像素/秒）；缺省用配置的接触击退值
   */
  knockback(monster: Monster, dirX: number, dirY: number, strength?: number): void {
    // Boss 免疫击退：既是体量感（打不动的庞然大物），也避免它被反复推走导致玩家无脑放风筝
    if (monster.isBoss) return;
    monster.knockbackX = dirX * (strength ?? this.opts.knockback);
    monster.knockbackY = dirY * (strength ?? this.opts.knockback);
    monster.knockbackTime = this.opts.knockbackDuration;
  }

  /** 受击闪白：短暂整块填白，是「我打中了」最廉价也最直接的反馈 */
  flash(monster: Monster, duration: number): void {
    monster.flashTime = duration;
    monster.sprite.setTintFill(Palette.combat.monsterHurt);
  }

  /** 回收全部小怪与尸体（关卡切换时调用） */
  reset(): void {
    for (const m of this.activeList) this.release(m);
    this.activeList.length = 0;
    for (const c of this.corpses) this.release(c);
    this.corpses.length = 0;
    this.running = false;
    this.spawnTimer = 0;
    this.bossMonster = null;
    this.bossSpawnTimer = 0;
    this.bossSpawnedFlag = false;
    this.bossCurrentPhase = 0;
    this.phaseChangeListeners.length = 0;
    this.minibossCount = 0;
  }

  /** 销毁对象池 */
  destroy(): void {
    this.reset();
    for (const m of this.pool) m.sprite.destroy();
    this.pool.length = 0;
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  /** 预分配对象池，运行期不再 new 任何精灵 */
  private preallocate(): void {
    for (let i = 0; i < this.opts.poolSize; i++) {
      const sprite = this.scene.add.image(0, 0, 'monster');
      sprite.setActive(false).setVisible(false).setDepth(100);
      const size = this.opts.radius * 2;
      sprite.setDisplaySize(size, size);
      this.pool.push({
        sprite,
        hp: 0,
        maxHp: 1,
        damage: 0,
        speed: 0,
        score: 0,
        radius: this.opts.radius,
        alive: false,
        isBoss: false,
        isMiniboss: false,
        baseTint: 0,
        knockbackX: 0,
        knockbackY: 0,
        knockbackTime: 0,
        flashTime: 0,
        corpseTime: 0,
        corpseSpin: 0,
      });
    }
  }

  /** 按当前刷怪间隔成批生成，直到达到同屏上限 */
  private updateSpawning(dt: number): void {
    this.spawnTimer += dt;

    // Boss 关：Boss 存活时改为「每 minionSpawnInterval 秒刷 minionPerWave 只」的固定节奏；
    // 未生成前用现有难度曲线，但同屏上限压低到平时的 1/4，避免开局就被怪海淹没
    const bossActive = this.opts.isBossLevel && this.bossSpawnedFlag;
    const interval = bossActive ? this.opts.boss!.minionSpawnInterval : this.spawnInterval;
    const perBatch = bossActive
      ? this.opts.boss!.minionPerWave
      : Math.max(1, Math.round(this.batchSize));

    // 同屏上限（Boss 不占小怪名额）：bossAlive → 满额；boss 未生成 → 1/4 上限；普通关 → 满额
    const cap = this.opts.isBossLevel && !this.bossSpawnedFlag
      ? Math.max(2, Math.round(this.opts.maxAlive * 0.25))
      : this.opts.maxAlive;

    // 上限保护：单帧最多补 8 批，避免长卡顿后一次性涌入造成掉帧
    let guard = 0;
    while (this.spawnTimer >= interval && guard < 8) {
      this.spawnTimer -= interval;
      guard++;

      for (let i = 0; i < perBatch; i++) {
        // 同屏上限是硬红线：满了就等下一批，绝不超量生成（Boss 与迷你 Boss 不占名额）
        const minions = this.activeList.length - (this.bossAlive ? 1 : 0) - this.minibossCount;
        if (minions >= cap) return;
        this.spawnOne();
      }
    }
  }

  /** 从池里取一只，放到屏幕四边外围并初始化属性 */
  private spawnOne(): void {
    const monster = this.pool.find((m) => !m.alive && m.corpseTime <= 0);
    if (!monster) return;

    const { viewWidth, viewHeight, spawnMargin, radius } = this.opts;
    const edge = Phaser.Math.Between(0, 3);
    let x = 0;
    let y = 0;
    if (edge === 0) {
      // 上边：从视野上方走进来
      x = Phaser.Math.Between(-spawnMargin, viewWidth + spawnMargin);
      y = -spawnMargin - radius;
    } else if (edge === 1) {
      // 右边
      x = viewWidth + spawnMargin + radius;
      y = Phaser.Math.Between(-spawnMargin, viewHeight + spawnMargin);
    } else if (edge === 2) {
      // 下边
      x = Phaser.Math.Between(-spawnMargin, viewWidth + spawnMargin);
      y = viewHeight + spawnMargin + radius;
    } else {
      // 左边
      x = -spawnMargin - radius;
      y = Phaser.Math.Between(-spawnMargin, viewHeight + spawnMargin);
    }

    monster.sprite.setPosition(x, y);
    monster.sprite.setActive(true).setVisible(true);
    monster.sprite.setRotation(0);
    monster.sprite.setAlpha(1);
    monster.sprite.setDisplaySize(radius * 2, radius * 2);
    // 槽位可能被 Boss / 迷你 Boss 用过，必须先归零再上色，否则 refreshTint 会按 Boss 配色染普通小怪
    monster.isBoss = false;
    monster.isMiniboss = false;
    monster.baseTint = 0;
    monster.sprite.setTexture('monster');
    monster.radius = this.opts.radius;
    this.refreshTint(monster);

    // 难度曲线的即时产物：新生成的小怪直接吃到当前的血量与移速倍率
    monster.hp = this.opts.hp * this.hpMultiplier;
    monster.maxHp = monster.hp;
    monster.damage = this.opts.damage;
    monster.speed = this.opts.moveSpeed * this.moveSpeedMultiplier;
    monster.score = this.opts.scorePerKill;
    monster.alive = true;
    monster.knockbackTime = 0;
    monster.knockbackX = 0;
    monster.knockbackY = 0;
    monster.flashTime = 0;
    monster.corpseTime = 0;
    monster.corpseSpin = 0;

    this.activeList.push(monster);
  }

  /** Boss 关：开局计时，到点从屏幕正上方生成 Boss */
  private updateBoss(dt: number): void {
    if (!this.opts.isBossLevel || this.bossSpawnedFlag) return;
    this.bossSpawnTimer += dt;
    if (this.bossSpawnTimer >= this.opts.boss!.spawnDelay) {
      this.spawnBoss();
    }
  }

  /** 生成 Boss：从对象池取一只，扩成大体型、金色本体、Boss 数值 */
  private spawnBoss(): void {
    const b = this.opts.boss;
    if (!b) return;

    const monster = this.pool.find((m) => !m.alive && m.corpseTime <= 0);
    if (!monster) return;

    // 从屏幕正上方「压下来」，Boss 体型大，比侧边更醒目
    monster.sprite.setPosition(this.opts.viewWidth / 2, -b.radius - 4);
    monster.sprite.setActive(true).setVisible(true);
    monster.sprite.setRotation(0);
    monster.sprite.setAlpha(1);
    monster.sprite.setDisplaySize(b.radius * 2, b.radius * 2);

    monster.isBoss = true;
    monster.isMiniboss = false;
    monster.baseTint = 0;
    monster.radius = b.radius;
    monster.hp = b.hp;
    monster.maxHp = b.hp;
    monster.damage = b.damage;
    monster.speed = b.speed;
    monster.score = b.scoreOnKill;
    monster.alive = true;
    monster.knockbackTime = 0;
    monster.knockbackX = 0;
    monster.knockbackY = 0;
    monster.flashTime = 0;
    monster.corpseTime = 0;
    monster.corpseSpin = 0;
    this.refreshTint(monster);

    this.activeList.push(monster);
    this.bossMonster = monster;
    this.bossSpawnedFlag = true;
    this.bossCurrentPhase = 0;
  }

  /**
   * T-027：生成一只迷你 Boss（考神召唤的环绕分身）。
   * 与普通小怪共用对象池，但不占同屏名额、不追人（speed=0，位置由召唤系统驱动）、
   * 零伤害、零得分；贴图用白色灰度迷你圆底，运行期按主题色 tint。
   * @returns 生成的 Monster；池满时返回 null（调用方跳过即可）
   */
  spawnMiniboss(opts: { hp: number; radius: number; tint: number; texture?: string }): Monster | null {
    const monster = this.pool.find((m) => !m.alive && m.corpseTime <= 0);
    if (!monster) return null;

    monster.sprite.setPosition(-100, -100);
    monster.sprite.setActive(true).setVisible(true);
    monster.sprite.setRotation(0);
    monster.sprite.setAlpha(1);
    monster.sprite.setTexture(opts.texture ?? 'tex-buff-miniboss');
    monster.sprite.setDisplaySize(opts.radius * 2, opts.radius * 2);

    monster.isBoss = false;
    monster.isMiniboss = true;
    monster.baseTint = opts.tint;
    monster.radius = opts.radius;
    monster.hp = opts.hp;
    monster.maxHp = opts.hp;
    monster.damage = 0;
    monster.speed = 0;
    monster.score = 0;
    monster.alive = true;
    monster.knockbackTime = 0;
    monster.knockbackX = 0;
    monster.knockbackY = 0;
    monster.flashTime = 0;
    monster.corpseTime = 0;
    monster.corpseSpin = 0;
    this.refreshTint(monster);

    this.minibossCount++;
    this.activeList.push(monster);
    return monster;
  }

  /** T-022：检查 Boss HP 是否跨过阶段阈值；跨过则切换阶段 + 应用 phase.speedMult/damageMult + 通知监听者。 */
  private checkBossPhaseChange(): void {
    const b = this.bossMonster;
    if (!b || !b.alive) return;
    const boss = this.opts.boss;
    if (!boss) return;
    // 兼容旧 BossSettings（无 phases）：维持旧行为，不切阶段
    const phases = (boss as ResolvedBossTemplate).phases;
    if (!Array.isArray(phases) || phases.length === 0) return;

    const ratio = clamp01(b.hp / b.maxHp);
    // phases 按 phaseIndex 升序排列（hpThreshold 自然递减）。
    // 从最高阶段向低扫，**首次** ratio ≤ threshold 时锁定 nextPhaseIndex 并跳出。
    let nextPhaseIndex = this.bossCurrentPhase;
    for (let i = phases.length - 1; i >= 0; i--) {
      if (ratio <= phases[i].hpThreshold) {
        nextPhaseIndex = i;
        break;
      }
    }
    if (nextPhaseIndex === this.bossCurrentPhase) return;

    const prevPhase = phases[this.bossCurrentPhase];
    const newPhase = phases[nextPhaseIndex];
    // 应用阶段乘数：与上一阶段相比的差量套用
    const speedDelta = newPhase.speedMult - (prevPhase?.speedMult ?? 1);
    const damageDelta = newPhase.damageMult - (prevPhase?.damageMult ?? 1);
    b.speed = Math.max(1, b.speed * (1 + speedDelta));
    b.damage = Math.max(0, b.damage * (1 + damageDelta));
    this.bossCurrentPhase = nextPhaseIndex;

    for (const fn of this.phaseChangeListeners) {
      try { fn(nextPhaseIndex); } catch { /* 忽略回调异常，避免影响战斗 */ }
    }
  }

  /** 驱动所有小怪追向玩家 */
  private updateMonsters(dt: number, playerX: number, playerY: number): void {
    for (let i = this.activeList.length - 1; i >= 0; i--) {
      const m = this.activeList[i];

      if (m.flashTime > 0) {
        m.flashTime -= dt;
        if (m.flashTime <= 0) {
          m.flashTime = 0;
          this.refreshTint(m);
        }
      }

      if (m.knockbackTime > 0) {
        m.knockbackTime -= dt;
        m.sprite.x += m.knockbackX * dt;
        m.sprite.y += m.knockbackY * dt;
      } else {
        const dx = playerX - m.sprite.x;
        const dy = playerY - m.sprite.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0.001) {
          const step = m.speed * dt;
          m.sprite.x += (dx / len) * step;
          m.sprite.y += (dy / len) * step;
        }
      }
    }
  }

  /** 推进尸体飞散：带阻尼地飞出、自转、缩小淡出 */
  private updateCorpses(dt: number): void {
    if (this.corpses.length === 0) return;
    const drag = Math.exp(-this.opts.corpseDrag * dt);

    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.corpseTime -= dt;
      if (c.corpseTime <= 0) {
        this.corpses.splice(i, 1);
        this.release(c);
        continue;
      }

      c.knockbackX *= drag;
      c.knockbackY *= drag;
      c.sprite.x += c.knockbackX * dt;
      c.sprite.y += c.knockbackY * dt;
      c.sprite.setRotation(c.sprite.rotation + c.corpseSpin * dt);

      // 用 displaySize 而不是 scale 缩放：小怪精灵是按 radius 拉伸显示的，
      // 直接用 setScale 会让尸体在死亡瞬间跳回贴图原始尺寸
      const t = c.corpseTime / this.opts.corpseLife;
      const size = c.radius * 2 * Math.max(0.1, 0.5 + 0.5 * t);
      c.sprite.setAlpha(Math.max(0, t));
      c.sprite.setDisplaySize(size, size);
    }
  }

  /** 击杀并回收一只小怪；开启尸体飞散时改为沿当前击退速度飞出去 */
  private kill(monster: Monster): void {
    const index = this.activeList.indexOf(monster);
    if (index >= 0) this.activeList.splice(index, 1);
    monster.alive = false;
    monster.hp = 0;
    // T-027：迷你 Boss 死亡即不再占用「不占名额」的额度
    if (monster.isMiniboss && this.minibossCount > 0) this.minibossCount--;

    const canCorpse =
      this.opts.corpseLife > 0 &&
      this.opts.corpsePoolSize > 0 &&
      (monster.knockbackX !== 0 || monster.knockbackY !== 0);

    if (canCorpse) {
      // 尸体数量受 corpsePoolSize 硬上限约束；满了就先回收最老的一具（FIFO），
      // 让「刚刚这一刀」一定有飞散反馈，而不是被旧的尸体占着名额
      while (this.corpses.length >= this.opts.corpsePoolSize) {
        const oldest = this.corpses.shift();
        if (oldest) this.release(oldest);
        else break;
      }

      monster.corpseTime = this.opts.corpseLife;
      monster.corpseSpin = this.opts.corpseSpin;
      monster.flashTime = 0;
      // 尸体用最亮的颜色，让「被打飞」这一下看得清（迷你 Boss 保留主题底色）
      monster.sprite.setTint(monster.baseTint !== 0 ? monster.baseTint : Palette.combat.monsterElite);
      this.corpses.push(monster);
      return;
    }

    this.release(monster);
  }

  /** 回收到对象池 */
  private release(monster: Monster): void {
    monster.alive = false;
    // 注意：不重置 isBoss！Boss 的 onKill 回调在 release() 之后才执行
    //（CombatSystem.applyHit: kill → onKill），若在这里把 isBoss 清掉，
    // 场景的 onMonsterKilled 会把它当普通小怪处理，Boss 击杀就不触发通关。
    // isBoss 的归零由 spawnOne()（复用槽位刷普通小怪时）负责。
    monster.hp = 0;
    monster.knockbackTime = 0;
    monster.knockbackX = 0;
    monster.knockbackY = 0;
    monster.flashTime = 0;
    monster.corpseTime = 0;
    monster.corpseSpin = 0;
    monster.radius = this.opts.radius;
    monster.sprite.setRotation(0);
    monster.sprite.setAlpha(1);
    monster.sprite.setDisplaySize(monster.radius * 2, monster.radius * 2);
    monster.sprite.setActive(false).setVisible(false);
  }

  /** 按当前血量比例刷新颜色：血越少越接近精英色 */
  private refreshTint(monster: Monster): void {
    const ratio = Math.max(0.25, monster.maxHp > 0 ? monster.hp / monster.maxHp : 1);
    if (monster.isBoss) {
      // Boss 用金色本体 → 血量越低越红，与普通小怪的绿→橙区分开
      monster.sprite.setTint(mixColor(Palette.accent.gold, Palette.status.wrong, 1 - ratio));
      return;
    }
    // T-027：迷你 Boss 按各自主题底色向精英色过渡，普通小怪维持绿→橙
    const from = monster.baseTint !== 0 ? monster.baseTint : Palette.combat.monster;
    monster.sprite.setTint(mixColor(from, Palette.combat.monsterElite, 1 - ratio));
  }
}

/** 难度曲线的缓入缓出插值：两端平缓、中段爬升快，避免开局就吃满压力 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 在两个颜色之间线性插值，用于小怪受伤变色 */
function mixColor(from: number, to: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * k);
  const g = Math.round(fg + (tg - fg) * k);
  const b = Math.round(fb + (tb - fb) * k);
  return (r << 16) | (g << 8) | b;
}
