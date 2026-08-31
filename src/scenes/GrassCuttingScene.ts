/**
 * 割草场景（src/scenes/GrassCuttingScene.ts）
 * 职责：接收答题结果换算出的三项乘数，驱动「三武器手动割草 + 四面涌怪生存 + 连击 + 倒计时」的战斗，
 *      并在时间归零或生命归零后把战斗统计移交结算场景。
 *
 * 战斗形态（用户拍板）：
 *  - 瞄准自动、出手手动：武器自动锁定最近敌人，玩家按攻击键才出手；
 *  - 三把武器随时切：1/2/3 直切、Q/E 循环切，也可点底部武器栏；
 *  - 关卡是倒计时生存，难度随 t = 已用时间 / 总时长 连续爬升。
 *
 * 答题加成落点（GDD 1.3 核心绑定原则：答题质量必须决定割草爽感）：
 *  - damageMultiplier   → 武器伤害
 *  - rangeMultiplier    → 武器射程（近战扇形半径 / 远程弹丸射程）
 *  - durationMultiplier → 攻击节奏（作为冷却的除数，答得越好出手越快）
 *  三者均在 resolve.ts 的 resolveWeapons 里一次性乘好，本场景不再做任何数值计算。
 *
 * 性能设计（GDD 1.2 性能零妥协 / 碰撞精简原则）：
 *  - 全程不使用任何物理引擎，玩家、小怪、弹丸均无碰撞体；
 *  - 接触与群体判定统一走「跳帧检测 + 距离平方」，频率由 damageCheckFrameInterval 控制；
 *  - 小怪 / 弹丸 / 特效碎片数量均由配置硬上限约束，特效不使用 ParticleEmitter（配额 0）；
 *  - 背景装饰草丛只做静态绘制，不参与任何检测。
 */

import Phaser from 'phaser';
import { ConfigLoader } from '../config/ConfigLoader';
import { resolveLevel } from '../config/resolve';
import type { QuizResult, ResolvedLevelPackage } from '../config/resolve';
import type { GrassCuttingBonus } from '../config/types';
import { CombatSystem, type CombatHooks } from '../systems/CombatSystem';
import { ComboSystem } from '../systems/ComboSystem';
import { KillFxSystem } from '../systems/KillFxSystem';
import { MonsterSpawner, type Monster } from '../systems/MonsterSpawner';
import { ProjectileSystem, type ProjectileHitPayload } from '../systems/ProjectileSystem';
import { sfx } from '../systems/SfxController';
import { WeaponSystem, type AttackAction } from '../systems/WeaponSystem';
import { Palette, css, textStyle, weaponTint } from '../ui/Palette';
import { FloatingTextPool, cameraShake } from '../ui/Feedback';
import { CombatHud } from '../ui/Hud';
import { TouchJoystick } from '../ui/TouchJoystick';
import { WeaponBar } from '../ui/WeaponBar';
import { clamp } from '../utils/MathUtil';
import { SWING_TEXTURE_RADIUS, TextureKeys, WEAPON_TEXTURE_PREFIX } from './BootScene';
import type { GrassCuttingData } from './QuestionScene';

/** 交给结算场景的数据 */
export interface ResultSceneData {
  level: number;
  quiz: QuizResult;
  bonus: GrassCuttingBonus;
  kills: number;
  maxCombo: number;
  score: number;
  /** 时间耗尽且存活 = 通关 */
  cleared: boolean;
  /** 生命归零 = 失败 */
  died: boolean;
  /** 全程未受伤 */
  noDamage: boolean;
}

/** 移动端虚拟摇杆的输入向量契约（MVP 未实现摇杆 UI，仅预留接口） */
export interface MoveVector {
  x: number;
  y: number;
}

/** 底部文案与虚拟摇杆左边缘之间的避让间距（像素） */
const JOYSTICK_TEXT_GUTTER = 16;

/** 挥砍弧光的显示时长（毫秒）——纯视觉常量，与战斗数值无关 */
const SWING_DURATION = 180;

export class GrassCuttingScene extends Phaser.Scene {
  private data0: GrassCuttingData | null = null;
  private packed!: ResolvedLevelPackage;

  private player!: Phaser.GameObjects.Image;
  private weaponSprite!: Phaser.GameObjects.Image;
  private swing!: Phaser.GameObjects.Image;
  private muzzle!: Phaser.GameObjects.Image;

  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasd: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key> | null = null;
  private attackKeys: Phaser.Input.Keyboard.Key[] = [];
  private hotkeys: Phaser.Input.Keyboard.Key[] = [];
  private cycleKeys: Phaser.Input.Keyboard.Key[] = [];
  private pointerDown = false;
  /** 触屏专属虚拟摇杆；PC（无 touch 能力）为 null，摇杆相关分支全部短路 */
  private joystick: TouchJoystick | null = null;
  /** 占用摇杆的手指 id，null 表示摇杆空闲 */
  private joystickPointerId: number | null = null;
  /** 触发攻击的手指 id，null 表示没有手指在攻击 */
  private attackPointerId: number | null = null;

  /**
   * 指针事件处理器引用，shutdown 时精确解绑。
   * 多指规则：摇杆手指与攻击手指各自登记 pointer.id，互不干扰——
   * 一根手指拖摇杆走位的同时，另一根手指可以点击攻击。
   */
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    // 点在武器栏上只切换武器，不触发攻击
    if (this.weaponBar.contains(pointer.x, pointer.y)) return;
    // 落在摇杆判定区内 → 走位，且不能点亮攻击，否则「拖动走位」会变成「边走边砍」
    if (this.joystick && this.joystickPointerId === null && this.joystick.contains(pointer.x, pointer.y)) {
      this.joystickPointerId = pointer.id;
      this.joystick.activate(pointer);
      return;
    }
    this.pointerDown = true;
    this.attackPointerId = pointer.id;
  };
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (this.joystick && pointer.id === this.joystickPointerId) {
      this.joystick.updateFromPointer(pointer);
    }
  };
  private readonly onPointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.id === this.joystickPointerId) {
      this.joystickPointerId = null;
      this.joystick?.release();
    }
    if (pointer.id === this.attackPointerId) {
      this.attackPointerId = null;
      this.pointerDown = false;
    }
  };
  /** 武器栏冷却查询器：预先绑定，避免每帧新建闭包产生 GC 压力 */
  private readonly cooldownProvider = (index: number): number =>
    this.weaponSystem.cooldownRatio(index);

  private weaponSystem!: WeaponSystem;
  private projectiles!: ProjectileSystem;
  private killFx!: KillFxSystem;
  private combat!: CombatSystem;
  private spawner!: MonsterSpawner;
  private combo!: ComboSystem;
  private hud!: CombatHud;
  private weaponBar!: WeaponBar;
  private floaters!: FloatingTextPool;
  /** 底部加成文案的左起始 x（触屏时右移以避让虚拟摇杆） */
  private bottomTextX = 16;

  private hp = 1;
  private maxHp = 1;
  private timeLeft = 0;
  private totalTime = 1;
  private score = 0;
  private kills = 0;
  private tookDamage = false;
  private ended = false;

  /** 移动朝向：没有可瞄准目标时的兜底朝向 */
  private moveFacing = 0;
  /** 武器最终朝向（自动瞄准结果） */
  private facing = 0;
  private invulnerableTimer = 0;
  private contactCooldown = 0;
  private frameCounter = 0;
  private elapsed = 0;

  constructor() {
    super({ key: 'GrassCuttingScene' });
  }

  init(data: object): void {
    this.data0 = data as GrassCuttingData;
  }

  create(): void {
    const incoming = this.data0;
    if (!incoming) {
      this.scene.start('MenuScene');
      return;
    }

    // 答题加成在这里落地到三把武器上（GDD 1.3 核心绑定原则）
    this.packed = resolveLevel(incoming.level, incoming.bonus);
    const bonus = incoming.bonus;

    this.drawField();
    this.drawGrassTufts();

    const px = this.scale.width / 2;
    const py = this.scale.height / 2 + 40;

    this.player = this.add.image(px, py, TextureKeys.player);
    this.player.setDisplaySize(this.packed.player.radius * 2.6, this.packed.player.radius * 2.6);
    this.player.setDepth(200);
    this.player.setTint(Palette.combat.player);

    // 贴图与配色在 WeaponSystem 建好之后再刷新（见下方 applyWeaponVisual 调用）
    this.weaponSprite = this.add.image(px, py, this.weaponTextureKey(0));
    this.weaponSprite.setDepth(210);

    this.swing = this.add.image(px, py, TextureKeys.swing);
    this.swing.setDepth(150);
    this.swing.setAlpha(0);

    this.muzzle = this.add.image(px, py, TextureKeys.glow);
    this.muzzle.setDisplaySize(30, 30);
    this.muzzle.setDepth(211);
    this.muzzle.setTint(Palette.accent.gold);
    this.muzzle.setAlpha(0);

    this.maxHp = this.packed.player.hp;
    this.hp = this.maxHp;

    // 本关时长 = 关卡基础时长 + 上轮奖励时间，并受全局上限约束
    const otherSettings = ConfigLoader.getInstance().getConfig('gameSettings').otherSettings;
    this.timeLeft = clamp(
      this.packed.gameTime + (incoming.bonusTime ?? 0),
      otherSettings.minGameTimeLimit,
      otherSettings.maxGameTimeLimit,
    );
    this.totalTime = Math.max(1, this.timeLeft);

    this.combat = new CombatSystem(this, {
      damageCheckFrameInterval: this.packed.performance.damageCheckFrameInterval,
      killKnockbackMultiplier: this.packed.killFx.killKnockbackMultiplier,
      hooks: this.createCombatHooks(),
    });

    const m = this.packed.monster;
    this.spawner = new MonsterSpawner(this, {
      hp: m.hp,
      damage: m.damage,
      moveSpeed: m.moveSpeed,
      maxAlive: m.maxAlive,
      radius: m.radius,
      scorePerKill: m.scorePerKill,
      knockback: m.knockback,
      knockbackDuration: m.knockbackDuration,
      spawnMargin: m.spawnMargin,
      poolSize: this.packed.performance.monsterPoolSize,
      viewWidth: this.scale.width,
      viewHeight: this.scale.height,
      difficulty: this.packed.difficulty,
      corpsePoolSize: this.packed.performance.corpsePoolSize,
      corpseLife: this.packed.killFx.corpseLife,
      corpseSpin: this.packed.killFx.corpseSpin,
      corpseDrag: this.packed.killFx.corpseDrag,
    });

    this.projectiles = new ProjectileSystem(this, {
      poolSize: this.packed.performance.projectilePoolSize,
      viewWidth: this.scale.width,
      viewHeight: this.scale.height,
      despawnMargin: m.spawnMargin,
    });

    this.killFx = new KillFxSystem(this, {
      settings: this.packed.killFx,
      shardPoolSize: this.packed.performance.shardPoolSize,
      ringPoolSize: this.packed.performance.ringPoolSize,
    });

    this.weaponSystem = new WeaponSystem({
      weapons: this.packed.weapons,
      autoAim: this.packed.autoAim,
    });
    // 武器系统就绪后才能确定贴图配色
    this.applyWeaponVisual();

    this.combo = new ComboSystem({
      timeWindow: this.packed.combo.timeWindow,
      damageGrowth: this.packed.combo.damageGrowth,
      maxDamageMultiplier: this.packed.combo.maxDamageMultiplier,
    });

    this.floaters = new FloatingTextPool(this, this.packed.performance.maxHitTextAlive);

    // 虚拟摇杆只在触屏设备创建：PC 端 joystick 保持 null，观感与操作完全不变
    if (this.sys.game.device.input.touch) {
      this.joystick = new TouchJoystick(this, { settings: this.packed.touch });
      // 底部加成文案右移到摇杆右侧，避免被摇杆压住
      this.bottomTextX = this.joystick.rightEdge + JOYSTICK_TEXT_GUTTER;
    }

    this.hud = new CombatHud(this, {
      width: this.scale.width,
      height: this.scale.height,
      maxHp: this.maxHp,
      gameTime: this.timeLeft,
      level: incoming.level,
      levelName: this.packed.levelEntry.name,
      bottomTextX: this.bottomTextX,
    });
    this.hud.setBonus(bonus.damageMultiplier, bonus.rangeMultiplier, bonus.durationMultiplier);

    this.weaponBar = new WeaponBar(this, {
      width: this.scale.width,
      height: this.scale.height,
      weapons: this.weaponSystem.all,
      onSelect: (index) => this.switchWeapon(index),
    });

    this.setupInput();

    this.spawner.start();

    // 奖励时间到账提示（GDD 2.4：奖励发放必须有明确视觉提示）
    if ((incoming.bonusTime ?? 0) > 0) {
      this.floaters.spawn(
        this.scale.width / 2,
        150,
        `游戏时间 +${Math.round(incoming.bonusTime ?? 0)}s`,
        css(Palette.status.correct),
        '⏱',
      );
    }

    this.showIntro();

    // 供无头浏览器（CDP）自动化验证读取运行时状态。仅在开发模式（vite dev）暴露，
    // 生产构建时 import.meta.env.DEV 为 false，整块被 tree-shaking 剔除。
    // 只读 getter，不驱动任何游戏逻辑；取不到就返回 null，不伪造值。
    if (import.meta.env.DEV) {
      const self = this;
      (window as unknown as { __KB_DEBUG__?: unknown }).__KB_DEBUG__ = {
        // 关卡结束后返回 Ended，便于验证脚本识别场景已切走（句柄本身是旧场景的闭包）
        get scene()         { return self.ended ? 'Ended' : 'GrassCuttingScene'; },
        get weaponId()      { return self.weaponSystem ? self.weaponSystem.current.id : null; },
        get weaponIndex()   { return self.weaponSystem ? self.weaponSystem.currentIndex : null; },
        get weaponCount()   { return self.weaponSystem ? self.weaponSystem.count : null; },
        get kills()         { return self.kills; },
        get score()         { return self.score; },
        get combo()         { return self.combo ? self.combo.current : null; },
        get aliveMonsters() { return self.spawner ? self.spawner.monsters.filter((m) => m.alive).length : null; },
        get hp()            { return self.hp; },
        get timeLeft()      { return self.timeLeft; },
        get elapsed()       { return self.totalTime - self.timeLeft; },
        get projectiles()   { return self.projectiles ? self.projectiles.aliveCount : null; },
        // 玩家坐标：自动化验证「摇杆拖动是否真的让角色移动」的唯一入口，只读
        get playerX()       { return self.player ? self.player.x : null; },
        get playerY()       { return self.player ? self.player.y : null; },
        // 摇杆状态快照：只读，供自动化验证区分「走位」与「攻击」两条输入通道
        get joystickActive(){ return self.joystick ? self.joystick.isActive : false; },
        get joystickVector(){ return self.joystick ? self.joystick.vector : null; },
      };
    }
  }

  override update(_time: number, delta: number): void {
    if (this.ended) return;

    // 顿帧必须用真实时间倒计时：若用被缩放的 dt，timeScale=0.05 会把 70ms 拉成 1.4 秒
    const rawDt = Math.min(delta, 100) / 1000;
    this.killFx.update(rawDt);

    // 其余系统全部走缩放后的 dt，顿帧期间整个世界一起「卡住」
    const dt = rawDt * this.time.timeScale;
    this.frameCounter++;
    this.elapsed += dt;

    this.updateSwitchInput();
    this.updateMovement(dt);
    this.updateFacing(dt);
    this.updateWeaponVisual();

    this.weaponSystem.update(dt);
    this.updateAttack();

    const progress = clamp(this.elapsed / this.totalTime, 0, 1);
    this.spawner.setProgress(progress);
    this.spawner.update(dt, this.player.x, this.player.y);

    this.projectiles.update(dt, this.spawner.monsters, (payload) => this.onProjectileHit(payload));

    this.combat.update();
    this.updateContact(dt);
    this.killFx.updateFx(dt);

    this.updateTimer(dt);
    this.updateHud();
  }

  // ───────────────────────── 输入 ─────────────────────────

  /** 绑定键盘与指针输入 */
  private setupInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

    const KeyCodes = Phaser.Input.Keyboard.KeyCodes;
    // 攻击键：J / 空格（按住连发，机关枪手感的关键）
    this.attackKeys = [KeyCodes.J, KeyCodes.SPACE].map((code) => keyboard.addKey(code, true, false));
    // 直切键：1 / 2 / 3
    this.hotkeys = [KeyCodes.ONE, KeyCodes.TWO, KeyCodes.THREE].map((code) =>
      keyboard.addKey(code, true, false),
    );
    // 循环切：Q 上一把 / E 下一把
    this.cycleKeys = [KeyCodes.Q, KeyCodes.E].map((code) => keyboard.addKey(code, true, false));

    // 鼠标 / 触屏：点在武器栏上只切换武器，不触发攻击；点在摇杆上走位，不触发攻击
    this.input.on('pointerdown', this.onPointerDown);
    // 摇杆拖动全靠 pointermove，缺了这一行触屏走位完全不工作
    this.input.on('pointermove', this.onPointerMove);
    this.input.on('pointerup', this.onPointerUp);
  }

  /** 处理武器切换按键（只在按下的那一帧生效） */
  private updateSwitchInput(): void {
    for (let i = 0; i < this.hotkeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(this.hotkeys[i])) this.switchWeapon(i);
    }
    if (this.cycleKeys[0] && Phaser.Input.Keyboard.JustDown(this.cycleKeys[0])) {
      this.switchWeapon((this.weaponSystem.currentIndex - 1 + this.weaponSystem.count) % this.weaponSystem.count);
    }
    if (this.cycleKeys[1] && Phaser.Input.Keyboard.JustDown(this.cycleKeys[1])) {
      this.switchWeapon((this.weaponSystem.currentIndex + 1) % this.weaponSystem.count);
    }
  }

  /** 切换武器并同步武器栏高亮 */
  private switchWeapon(index: number): void {
    if (this.weaponSystem.switchTo(index)) {
      this.weaponBar.setIndex(this.weaponSystem.currentIndex);
      this.applyWeaponVisual();
    }
  }

  /** 攻击键是否处于按下状态（键盘或指针） */
  private isAttackHeld(): boolean {
    for (const key of this.attackKeys) {
      if (key.isDown) return true;
    }
    return this.pointerDown;
  }

  // ───────────────────────── 各子系统更新 ─────────────────────────

  /** 玩家移动：键盘为主，虚拟摇杆只需替换 getMoveVector() 的实现 */
  private updateMovement(dt: number): void {
    const v = this.getMoveVector();
    const speed = this.packed.player.moveSpeed;
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    if (len > 0.001) {
      const nx = v.x / len;
      const ny = v.y / len;
      this.player.x += nx * speed * dt;
      this.player.y += ny * speed * dt;
      this.moveFacing = Math.atan2(ny, nx);
    }

    const margin = this.packed.player.radius;
    this.player.x = clamp(this.player.x, margin, this.scale.width - margin);
    this.player.y = clamp(this.player.y, margin + 64, this.scale.height - margin);
  }

  /**
   * 读取移动输入向量：键盘（方向键 + WASD）与虚拟摇杆的向量相加，
   * 由 updateMovement 统一归一化——两者同时输入时方向合并、速度不叠加。
   */
  private getMoveVector(): MoveVector {
    let x = 0;
    let y = 0;
    if (this.cursors) {
      if (this.cursors.left?.isDown) x -= 1;
      if (this.cursors.right?.isDown) x += 1;
      if (this.cursors.up?.isDown) y -= 1;
      if (this.cursors.down?.isDown) y += 1;
    }
    if (this.wasd) {
      if (this.wasd.A.isDown) x -= 1;
      if (this.wasd.D.isDown) x += 1;
      if (this.wasd.W.isDown) y -= 1;
      if (this.wasd.S.isDown) y += 1;
    }
    if (this.joystick) {
      const v = this.joystick.vector;
      x += v.x;
      y += v.y;
    }
    return { x, y };
  }

  /** 自动瞄准：锁定最近敌人，没有目标时沿用移动朝向 */
  private updateFacing(dt: number): void {
    this.facing = this.weaponSystem.resolveFacing(
      this.player.x,
      this.player.y,
      this.spawner.monsters,
      this.moveFacing,
      dt,
    );
  }

  /** 把角色与武器贴图摆到当前朝向 */
  private updateWeaponVisual(): void {
    this.player.setRotation(this.facing);
    const hold = this.packed.player.radius;
    this.weaponSprite.setPosition(
      this.player.x + Math.cos(this.facing) * hold,
      this.player.y + Math.sin(this.facing) * hold,
    );
    this.weaponSprite.setRotation(this.facing);
    // 朝左时上下翻转，避免刀刃朝天、枪管倒挂
    const mirrored = Math.cos(this.facing) < 0;
    this.weaponSprite.setFlipY(mirrored);
  }

  /** 切换武器时刷新武器贴图与配色 */
  private applyWeaponVisual(): void {
    const weapon = this.weaponSystem.current;
    this.weaponSprite.setTexture(this.weaponTextureKey(this.weaponSystem.currentIndex));
    this.weaponSprite.setTint(weaponTint(weapon.attackType));
    this.weaponSprite.setAlpha(1);
  }

  /** 由武器 id 推导贴图 key（约定：贴图名为 weapon-<id>） */
  private weaponTextureKey(index: number): string {
    const weapon = this.packed.weapons[index] ?? this.packed.weapons[0];
    return `${WEAPON_TEXTURE_PREFIX}${weapon.id}`;
  }

  /** 出膛点距角色中心的距离：握持距离 + 半个武器长度，全部来自贴图尺寸 */
  private muzzleDistance(): number {
    return this.packed.player.radius + this.weaponSprite.displayWidth * 0.5;
  }

  /** 出手：冷却由 WeaponSystem 判定，命中由 CombatSystem / ProjectileSystem 结算 */
  private updateAttack(): void {
    if (!this.isAttackHeld()) return;
    const action = this.weaponSystem.tryAttack(this.player.x, this.player.y, this.facing);
    if (!action) return;
    this.performAttack(action);
  }

  /** 落地一次攻击：近战立即结算扇形，远程发射弹丸 */
  private performAttack(action: AttackAction): void {
    const w = action.weapon;

    if (w.attackType === 'melee_sector') {
      const result = this.combat.sweepSector({
        x: action.x,
        y: action.y,
        facing: action.facing,
        range: w.range,
        sectorAngle: w.sectorAngle,
        damage: w.damage,
        comboMultiplier: this.combo.damageMultiplier,
        knockback: w.knockback,
        monsters: this.spawner.monsters,
      });
      this.showSwing(action);
      if (result.hits > 0) this.killFx.shake(w.shakeIntensity, 130);
      return;
    }

    const isSpread = w.attackType === 'ranged_spread';
    const texture = isSpread ? TextureKeys.pellet : TextureKeys.bolt;
    const dist = this.muzzleDistance();
    const mx = action.x + Math.cos(action.facing) * dist;
    const my = action.y + Math.sin(action.facing) * dist;
    const pellets = Math.max(1, Math.round(w.pelletCount));
    const spreadRad = (w.spread * Math.PI) / 180;

    for (let i = 0; i < pellets; i++) {
      // 多发：在张角内均匀铺开；单发：用 spread 当作随机抖动幅度
      const offset =
        pellets > 1
          ? (i / (pellets - 1) - 0.5) * spreadRad
          : Phaser.Math.FloatBetween(-spreadRad, spreadRad) * 0.5;
      this.projectiles.fire({
        x: mx,
        y: my,
        angle: action.facing + offset,
        speed: w.projectileSpeed,
        damage: w.damage,
        pierce: w.pierce,
        knockback: w.knockback,
        range: w.range,
        radius: w.projectileRadius,
        texture,
        tint: weaponTint(w.attackType),
        weaponId: w.id,
      });
    }

    this.showMuzzleFlash(mx, my);
    this.killFx.shake(w.shakeIntensity * 0.5, 80);
  }

  /** 近战挥砍弧光 */
  private showSwing(action: AttackAction): void {
    const base = action.weapon.range / SWING_TEXTURE_RADIUS;
    this.tweens.killTweensOf(this.swing);
    this.swing.setPosition(action.x, action.y);
    this.swing.setRotation(action.facing);
    this.swing.setTint(weaponTint(action.weapon.attackType));
    this.swing.setAlpha(0.85);
    this.swing.setScale(base * 0.72);
    this.tweens.add({
      targets: this.swing,
      scale: base * 1.06,
      alpha: 0,
      duration: SWING_DURATION,
      ease: 'Cubic.easeOut',
    });
  }

  /** 枪口火光 */
  private showMuzzleFlash(x: number, y: number): void {
    this.tweens.killTweensOf(this.muzzle);
    this.muzzle.setPosition(x, y);
    this.muzzle.setAlpha(0.9);
    this.muzzle.setScale(1.15);
    this.tweens.add({
      targets: this.muzzle,
      alpha: 0,
      scale: 0.6,
      duration: 90,
      ease: 'Cubic.easeOut',
    });
  }

  /** 弹丸命中：统一交给命中结算中心处理 */
  private onProjectileHit(payload: ProjectileHitPayload): void {
    this.combat.applyHit({
      monster: payload.monster,
      damage: payload.damage,
      comboMultiplier: this.combo.damageMultiplier,
      dirX: payload.dirX,
      dirY: payload.dirY,
      knockback: payload.knockback,
    });
    this.killFx.spark(payload.x, payload.y, Palette.combat.monsterElite);
  }

  // ───────────────────────── 命中结算回调 ─────────────────────────

  /** 组装命中结算中心需要的外部能力 */
  private createCombatHooks(): CombatHooks {
    return {
      applyDamage: (monster, amount) => this.spawner.applyDamage(monster, amount),
      knockback: (monster, dirX, dirY, strength) =>
        this.spawner.knockback(monster, dirX, dirY, strength),
      showDamage: (monster, amount) => {
        this.spawner.flash(monster, this.packed.killFx.hitFlashDuration / 1000);
        this.floaters.damage(monster.sprite.x, monster.sprite.y - 12, amount, this.comboTier());
      },
      onKill: (monster, x, y, dirX, dirY) => this.onMonsterKilled(monster, x, y, dirX, dirY),
      registerKill: () => {
        this.combo.registerKill();
      },
    };
  }

  /**
   * 小怪击杀结算：击杀特效 → 顿帧 → 震动 → 得分飘字。
   * 注意此时 ComboSystem 还没登记本次击杀（按「击杀特效 → 连击登记」的顺序排在后面），
   * 因此展示用的连击数是当前值 + 1。
   */
  private onMonsterKilled(monster: Monster, x: number, y: number, dirX: number, dirY: number): void {
    const gained = monster.score;
    this.kills++;
    sfx.play('kill');
    this.score += gained;

    const nextCombo = this.combo.current + 1;
    const tier = this.comboTier(nextCombo);
    this.floaters.kill(x, y - 14, gained, tier);
    if (nextCombo >= 2) {
      this.floaters.combo(this.player.x, this.player.y - 42, nextCombo);
    }

    // 击杀三件套：爆散 / 顿帧 / 震动，全部走对象池与可配置开关
    this.killFx.burst(x, y, Palette.combat.monsterElite, dirX, dirY);
    this.killFx.requestHitstop(this.weaponSystem.current.hitstopDuration);
    this.killFx.shake(this.weaponSystem.current.shakeIntensity, 140);
  }

  /** 伤害数字的视觉档位：0 普通 / 1 大连击 / 2 超大连击 */
  private comboTier(combo = this.combo.current): number {
    const fx = this.packed.killFx;
    if (combo >= fx.comboHugeThreshold) return 2;
    if (combo >= fx.comboBigThreshold) return 1;
    return 0;
  }

  /** 玩家与小怪的接触伤害：跳帧 + 距离平方判定，不使用物理碰撞 */
  private updateContact(dt: number): void {
    if (this.invulnerableTimer > 0) this.invulnerableTimer -= dt;
    if (this.contactCooldown > 0) this.contactCooldown -= dt;

    this.combo.update(dt);

    if (!this.combat.shouldCheckThisFrame()) return;

    const pr = this.packed.player.radius;
    const monsters = this.spawner.monsters;
    for (const monster of monsters) {
      if (!monster.alive) continue;
      const dx = monster.sprite.x - this.player.x;
      const dy = monster.sprite.y - this.player.y;
      const reach = pr + monster.radius;
      if (dx * dx + dy * dy > reach * reach) continue;

      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      // 接触时把小怪推开，避免它持续贴在玩家身上每帧掉血
      this.spawner.knockback(monster, dx / len, dy / len);
      if (this.invulnerableTimer <= 0 && this.contactCooldown <= 0) {
        this.applyDamageToPlayer(monster.damage);
      }
      break;
    }
  }

  /** 玩家受伤处理 */
  private applyDamageToPlayer(amount: number): void {
    this.hp -= amount;
    sfx.play('hurt');
    this.tookDamage = true;
    this.invulnerableTimer = this.packed.player.invulnerableDuration;
    this.contactCooldown = this.packed.player.contactDamageCooldown;

    cameraShake(this, 0.006, 160);
    this.floaters.spawn(this.player.x, this.player.y - 34, `-${Math.round(amount)}`, css(Palette.status.wrong), '♥');

    // 无敌帧闪烁提示
    this.tweens.add({
      targets: this.player,
      alpha: { from: 0.3, to: 1 },
      duration: 90,
      yoyo: true,
      repeat: 2,
    });

    if (this.hp <= 0) {
      this.hp = 0;
      this.finish(false, true);
    }
  }

  /** 倒计时推进 */
  private updateTimer(dt: number): void {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.finish(true, false);
    }
  }

  /** 刷新 HUD 与武器栏 */
  private updateHud(): void {
    this.hud.setHp(this.hp);
    this.hud.setTimeLeft(this.timeLeft);
    this.hud.updateScore(this.score);
    this.hud.updateCombo(this.combo.current);
    this.hud.setTimeWarning(this.timeLeft <= 10);
    this.weaponBar.update(this.cooldownProvider);
  }

  // ───────────────────────── 场景搭建与收尾 ─────────────────────────

  /** 绘制草地场地背景 */
  private drawField(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const g = this.add.graphics();
    g.fillStyle(Palette.background.grassField, 1);
    g.fillRect(0, 0, w, h);

    // 交替色带，制造草地层次
    g.fillStyle(Palette.background.grassFieldAlt, 1);
    for (let y = 0; y < h; y += 96) {
      g.fillRect(0, y, w, 48);
    }
    g.setDepth(-20);
  }

  /**
   * 绘制装饰草丛。
   * 性能说明：这些草丛是纯静态 Graphics，不注册任何碰撞体、不参与任何检测，
   * 完全符合 GDD 1.2「无碰撞交互的装饰物必须关闭碰撞检测」的要求。
   */
  private drawGrassTufts(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const g = this.add.graphics();
    g.setDepth(-10);

    // 用固定序列而非随机数，保证每次进入场景草地布局一致，避免视觉抖动
    let seed = 20240501;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < 90; i++) {
      const x = next() * w;
      const y = 64 + next() * (h - 64);
      const height = 8 + next() * 14;
      g.fillStyle(Palette.combat.monster, 0.22);
      g.fillTriangle(x - 5, y, x + 5, y, x, y - height);
    }
  }

  /** 入场提示：让玩家立刻知道怎么打 */
  private showIntro(): void {
    const w = this.scale.width;
    const tip = this.add
      .text(
        w / 2,
        this.scale.height / 2 - 90,
        'WASD 走位 · J/空格 出手 · 1/2/3 换武器',
        textStyle(24, css(Palette.accent.gold)),
      )
      .setOrigin(0.5)
      .setDepth(1200);
    this.tweens.add({
      targets: tip,
      alpha: 0,
      y: this.scale.height / 2 - 130,
      delay: 1400,
      duration: 700,
      onComplete: () => tip.destroy(),
    });
  }

  /** 结束关卡并移交结算 */
  private finish(cleared: boolean, died: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.spawner.stop();
    this.combat.reset();
    this.projectiles.clear();
    // 必须清空特效并恢复时间缩放，否则会带着慢动作与残留碎片进入结算场景
    this.killFx.clear();

    const data0 = this.data0;
    if (!data0) return;

    const payload: ResultSceneData = {
      level: data0.level,
      quiz: data0.quiz,
      bonus: data0.bonus,
      kills: this.kills,
      maxCombo: this.combo.max,
      score: this.score,
      cleared,
      died,
      noDamage: !this.tookDamage,
    };
    this.scene.start('ResultScene', payload);
  }

  /** 场景销毁时清理系统资源 */
  shutdown(): void {
    this.input.off('pointerdown', this.onPointerDown);
    this.input.off('pointermove', this.onPointerMove);
    this.input.off('pointerup', this.onPointerUp);
    this.joystick?.destroy();
    this.joystick = null;
    this.joystickPointerId = null;
    this.attackPointerId = null;
    this.spawner?.destroy();
    this.combat?.destroy();
    this.projectiles?.destroy();
    this.killFx?.destroy();
    this.floaters?.destroy();
    this.hud?.destroy();
    this.weaponBar?.destroy();
  }
}
