/**
 * 极简音效合成（src/systems/SfxController.ts）
 * 职责：用 WebAudio 实时合成极短提示音，不依赖任何 mp3/wav 素材（零外部素材约束）。
 * 设计：全站只暴露一个 sfx.play(name) 接口，业务代码不需要知道实现细节；
 *      任何异常都被静默吞掉，音效故障绝不影响游戏主流程。
 * 说明：MVP 只做「答题对/错/停住、击杀、受伤、升级」六个关键反馈音，
 *      后续要接入真实音频素材时，只需替换本文件的实现，调用方无需改动。
 */

/** 支持的音效名 */
export type SfxName = 'stop' | 'correct' | 'wrong' | 'kill' | 'hurt' | 'levelUp';

/**
 * 音频设置。`minIntervalMs` = 同名音效的最小触发间隔（毫秒），0 表示不限制。
 * 由编排层在配置校验通过后 bind() 进来，未 bind 时用 DEFAULT_MIN_INTERVAL_MS 兜底。
 */
export interface AudioSettings {
  minIntervalMs: Partial<Record<SfxName, number>>;
}

/**
 * 兜底节流表（未 bind 配置时生效）。
 *
 * TODO(T-013-B)：迁移到 public/config 走「JSON → types → validator → resolve」四段式
 * 管线后删除本常量。本轮按 team-lead 要求暂缓改动 public/config/ 与 src/config/。
 *
 * 取值规则 ≈ 该音效自身时长 + 10~80ms 间隙：
 * 既压得掉同帧叠音，又保留连杀时的节奏颗粒感，不会把一串连杀压成一声。
 */
const DEFAULT_MIN_INTERVAL_MS: Record<SfxName, number> = {
  stop: 120, // 时长 0.08s
  correct: 200, // 时长 0.16s
  wrong: 240, // 时长 0.20s
  kill: 70, // 时长 0.06s：连杀要听得清「哒哒哒」，只压同帧爆发
  hurt: 220, // 时长 0.18s
  levelUp: 500, // 时长 0.42s
};

/** 单个音效的振荡器参数 */
interface ToneSpec {
  /** 起始频率（Hz） */
  from: number;
  /** 结束频率（Hz），做滑音 */
  to: number;
  /** 时长（秒） */
  duration: number;
  /** 波形 */
  type: OscillatorType;
  /** 音量（0~1） */
  gain: number;
}

/** 音效参数表：改这里就能调整听感，不需要动任何业务代码 */
const TONES: Record<SfxName, ToneSpec> = {
  stop: { from: 520, to: 320, duration: 0.08, type: 'triangle', gain: 0.14 },
  correct: { from: 660, to: 990, duration: 0.16, type: 'sine', gain: 0.2 },
  wrong: { from: 300, to: 180, duration: 0.2, type: 'sawtooth', gain: 0.14 },
  kill: { from: 880, to: 1200, duration: 0.06, type: 'square', gain: 0.07 },
  hurt: { from: 240, to: 120, duration: 0.18, type: 'sawtooth', gain: 0.16 },
  levelUp: { from: 520, to: 1040, duration: 0.42, type: 'sine', gain: 0.22 },
};

class SfxController {
  private ctx: AudioContext | null = null;
  private enabled = true;
  /** 同名音效的最小触发间隔（毫秒）；未 bind 时为兜底表 */
  private minIntervalMs: Record<SfxName, number> = { ...DEFAULT_MIN_INTERVAL_MS };
  /** 每个音效上一次真正发声的墙钟时刻（ms），用于节流 */
  private lastPlayedAt = new Map<SfxName, number>();

  /** 关闭 / 开启音效（设置页可接） */
  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  /**
   * 绑定音频设置。配置里没写到的音效沿用兜底值，保证任何情况下都有节流保护。
   * 调用点：编排层在配置校验通过之后（参考 BootScene.bootstrap 里 progression.bind 的位置）。
   */
  bind(settings: AudioSettings): void {
    this.minIntervalMs = { ...DEFAULT_MIN_INTERVAL_MS, ...settings.minIntervalMs };
  }

  /** 是否处于开启状态 */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 播放一个音效。
   * 首次调用时才创建 AudioContext，避开浏览器自动播放策略；
   * 同名音效按 minIntervalMs 节流，避免高频击杀时同一音色叠加糊成一片。
   */
  play(name: SfxName): void {
    if (!this.enabled) return;
    if (!this.passThrottle(name)) return;
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume();

      const spec = TONES[name];
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(spec.from, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), now + spec.duration);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(spec.gain, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + spec.duration + 0.02);
    } catch {
      // 音效永远不该阻断游戏
    }
  }

  /**
   * 节流判定：距离上次播放同名音效不足 minIntervalMs 则丢弃本次。
   *
   * 用 `performance.now()` 的墙钟时间，不用游戏的 dt —— 顿帧压慢的是游戏世界
   * （scene.time.timeScale），不该把音效的节奏也一起压慢。
   *
   * 主要目标不是限制连杀的持续速率（实测约 5 杀/秒，间隔 200ms，全都放得过去），
   * 而是压掉**同帧爆发**：霰弹枪一次 5 颗弹丸可能同帧击杀 5 只，
   * 5 个同音色振荡器同时起振会叠加削波，听感是一声爆音而不是 5 声击杀。
   */
  private passThrottle(name: SfxName): boolean {
    const gap = this.minIntervalMs[name] ?? 0;
    if (gap <= 0) return true;

    const now = performance.now();
    const last = this.lastPlayedAt.get(name);
    if (last !== undefined && now - last < gap) return false;

    this.lastPlayedAt.set(name, now);
    return true;
  }

  /** 懒加载 AudioContext */
  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }
}

/** 全局音效单例 */
export const sfx = new SfxController();
