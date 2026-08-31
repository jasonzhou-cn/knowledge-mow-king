/**
 * 极简音效合成（src/systems/SfxController.ts）
 * 职责：用 WebAudio 实时合成极短提示音，不依赖任何 mp3/wav 素材（零外部素材约束）。
 * 设计：全站只暴露一个 sfx.play(name) 接口，业务代码不需要知道实现细节；
 *      任何异常都被静默吞掉，音效故障绝不影响游戏主流程。
 * 说明：MVP 只做「答题对/错/停住、击杀、受伤」五个关键反馈音，
 *      后续要接入真实音频素材时，只需替换本文件的实现，调用方无需改动。
 */

/** 支持的音效名 */
export type SfxName = 'stop' | 'correct' | 'wrong' | 'kill' | 'hurt' | 'levelUp';

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

  /** 关闭 / 开启音效（设置页可接） */
  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  /** 是否处于开启状态 */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 播放一个音效。
   * 首次调用时才创建 AudioContext，避开浏览器自动播放策略；
   * 击杀音在割草场景可能高频触发，内部做了节流，避免声音糊成一片。
   */
  play(name: SfxName): void {
    if (!this.enabled) return;
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
