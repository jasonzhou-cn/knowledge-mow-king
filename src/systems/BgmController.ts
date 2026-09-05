/**
 * 程序化 BGM（src/systems/BgmController.ts）
 * 职责：用 WebAudio 实时合成各场景循环背景音乐（menu / question / grass / boss），
 *      不依赖任何音频素材（零外部素材约束），调用方只需 bgm.play('grass')。
 *
 * 实现：轻量步进音序器——定时器每 200ms 醒来一次，把未来 0.4s 内的音符
 *      （低音 + 主旋律两条轨）精确调度到 AudioContext 时间轴上；
 *      切场景换轨道即换序列参数，无装载、无解码、无 GC 压力。
 *
 * 浏览器自动播放策略：AudioContext 必须在用户手势后才能出声。
 * 首次 play() 若 context 仍处于 suspended，会注册一次性全局手势监听，
 * 玩家第一次点击/按键时自动恢复——期间不产生任何可感知延迟。
 *
 * 任何异常都被静默吞掉：BGM 故障绝不影响游戏主流程（与 SfxController 同规）。
 */

import type { BgmConfig, BgmTrackSettings } from '../config/types';

export type BgmTrackName = keyof BgmConfig['tracks'];

/** 调度提前量（秒）：定时器醒来时至少要预排多远的音符 */
const SCHEDULE_AHEAD_SEC = 0.4;
/** 定时器唤醒间隔（毫秒） */
const TIMER_INTERVAL_MS = 200;
/** MIDI 音符号 → 频率（Hz） */
function noteFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class BgmController {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private config: BgmConfig | null = null;
  /** 当前轨道名；null = 停止 */
  private current: BgmTrackName | null = null;
  /** 是否收到过「切换轨道」的请求但被自动播放策略拦下（等手势后恢复） */
  private pendingTrack: BgmTrackName | null = null;
  private timer: number | null = null;
  /** 下一个待调度步的 AudioContext 时间 */
  private nextStepTime = 0;
  /** 下一个待调度步的序列下标（bass/lead 各自独立推进，长度不同自然错拍） */
  private bassIndex = 0;
  private leadIndex = 0;
  /** 手势解锁监听是否已注册 */
  private unlockRegistered = false;

  /** 绑定 BGM 配置（BootScene 在配置校验通过后调用） */
  bind(config: BgmConfig): void {
    this.config = config;
  }

  /** 是否处于开启状态（enabled 开关 + 配置存在） */
  get isEnabled(): boolean {
    return this.config?.enabled ?? false;
  }

  /**
   * 切换到指定场景轨道（重复调用同轨道无副作用）。
   * @param track 轨道名
   */
  play(track: BgmTrackName): void {
    if (!this.isEnabled) return;
    if (this.current === track) return;

    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      // 自动播放策略：等用户手势，恢复后继续这次切换
      this.pendingTrack = track;
      this.registerUnlock();
      void ctx.resume().then(() => this.flushPending()).catch(() => undefined);
      return;
    }

    this.startTrack(track);
  }

  /** 停止 BGM（关卡结束进结算前的静默间隙等；一般场景切换直接切轨道即可） */
  stop(): void {
    this.current = null;
    this.pendingTrack = null;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  /** context 恢复后补上被拦下的轨道切换 */
  private flushPending(): void {
    if (this.pendingTrack === null) return;
    const track = this.pendingTrack;
    this.pendingTrack = null;
    if (this.ctx && this.ctx.state === 'running') this.startTrack(track);
  }

  /** 真正启动一条轨道的音序器 */
  private startTrack(track: BgmTrackName): void {
    const ctx = this.ctx;
    const cfg = this.config;
    if (!ctx || !cfg) return;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.current = track;
    this.bassIndex = 0;
    this.leadIndex = 0;
    this.nextStepTime = ctx.currentTime + 0.05;

    this.scheduleLoop();
    this.timer = window.setInterval(() => this.scheduleLoop(), TIMER_INTERVAL_MS);
  }

  /** 注册一次性手势监听：玩家第一次交互时恢复被暂停的 AudioContext */
  private registerUnlock(): void {
    if (this.unlockRegistered) return;
    this.unlockRegistered = true;
    const unlock = (): void => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      this.unlockRegistered = false;
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().then(() => this.flushPending()).catch(() => undefined);
      }
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }

  /** 把 [nextStepTime, now + AHEAD) 窗口内的全部音符调度到时间轴 */
  private scheduleLoop(): void {
    const ctx = this.ctx;
    const cfg = this.config;
    if (!ctx || !cfg || this.current === null) return;
    const track: BgmTrackSettings | undefined = cfg.tracks[this.current];
    if (!track || track.stepSec <= 0) return;

    const deadline = ctx.currentTime + SCHEDULE_AHEAD_SEC;
    // 防御：长时间挂后台后回来，nextStepTime 可能远远落后，直接追到当前时间附近
    if (this.nextStepTime < ctx.currentTime - 0.5) {
      this.nextStepTime = ctx.currentTime + 0.05;
    }

    while (this.nextStepTime < deadline) {
      const t = this.nextStepTime;
      const bassNote = track.bass[this.bassIndex % track.bass.length];
      const leadNote = track.lead[this.leadIndex % track.lead.length];
      if (bassNote >= 0) {
        this.scheduleNote(ctx, track.bassWave, noteFrequency(track.rootNote + bassNote), t, track.stepSec * 0.95, track.bassGain * cfg.masterGain);
      }
      if (leadNote >= 0) {
        this.scheduleNote(ctx, track.leadWave, noteFrequency(track.rootNote + leadNote), t, track.stepSec * 0.9, track.leadGain * cfg.masterGain);
      }
      this.bassIndex++;
      this.leadIndex++;
      this.nextStepTime += track.stepSec;
    }
  }

  /** 调度单音符：起音 12ms 到达峰值、自然衰减到零 */
  private scheduleNote(
    ctx: AudioContext,
    wave: OscillatorType,
    freq: number,
    startAt: number,
    duration: number,
    gainValue: number,
  ): void {
    try {
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, startAt);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

      osc.connect(gain);
      gain.connect(this.master ?? ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration + 0.02);
    } catch {
      // 单音符失败静默跳过
    }
  }

  /** 懒加载 AudioContext 与主增益节点 */
  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      return this.ctx;
    } catch {
      return null;
    }
  }
}

/** 全局 BGM 单例 */
export const bgm = new BgmController();
