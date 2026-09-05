/**
 * 配置加载中心（src/config/ConfigLoader.ts）
 * 职责：以单例模式统一加载 public/config/ 下的全部 JSON 配置，提供
 *      loadAllConfigs()（并行 fetch + 缓存）、hotReloadConfig()（热更新）、getConfig<T>(module)（类型安全读取）。
 * 设计要点：
 *  - 严格遵循 GDD 1.1 配置热更新原则：MVP 不接云，但 reload() 会重新 fetch，开发期改 JSON 后刷新即生效；
 *  - 加载完成后立即执行 validateAllConfigs()，校验失败直接抛错阻断，脏配置绝不进入游戏；
 *  - 并行 fetch 所有模块，避免串行请求拖慢启动。
 */

import type { ConfigModuleMap, ConfigModuleName } from './types';
import { validateAllConfigs } from './validator';

/** 配置文件所在目录（相对站点根） */
const CONFIG_BASE_PATH = 'config/';

/** 需要加载的全部配置模块 */
const CONFIG_MODULES: ConfigModuleName[] = [
  'gameSettings',
  'questionConfig',
  'grassCuttingConfig',
  'levelConfig',
  'rewardConfig',
  'subjectConfig',
  'questionBank',
  'weaponConfig',
  'bossDialogue',
  'resultFlavor',
  'sfxConfig',
  'bgmConfig',
  'achievementConfig',
];

/** 单个模块的加载结果：成功标记 + 原始数据 */
interface RawModule {
  name: ConfigModuleName;
  data: unknown;
}

export class ConfigLoader {
  private static instance: ConfigLoader | null = null;

  /** 配置缓存：非空表示已加载完成（校验通过后才写入，因此内容一定是完整的） */
  private cache: ConfigModuleMap | null = null;

  /** 正在进行的加载 Promise，避免并发调用触发多次 fetch */
  private pending: Promise<ConfigModuleMap> | null = null;

  /** 私有构造，强制走 getInstance() */
  private constructor() {}

  /** 获取全局唯一实例 */
  public static getInstance(): ConfigLoader {
    if (ConfigLoader.instance === null) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  /**
   * 并行加载全部配置并校验；已加载则直接返回缓存。
   * @throws 校验失败或网络失败时抛出中文错误，调用方必须阻断启动
   */
  public async loadAllConfigs(): Promise<ConfigModuleMap> {
    if (this.cache !== null) return this.cache as ConfigModuleMap;
    if (this.pending !== null) return this.pending;

    this.pending = (async (): Promise<ConfigModuleMap> => {
      const results = await Promise.all(
        CONFIG_MODULES.map(async (name): Promise<RawModule> => {
          const data = await this.fetchModule(name);
          return { name, data };
        }),
      );

      const raw = {} as Record<ConfigModuleName, unknown>;
      for (const r of results) raw[r.name] = r.data;

      // 校验通过才会写入缓存：保证运行期拿到的配置一定是合法的
      validateAllConfigs(raw);

      const validated = raw as ConfigModuleMap;
      this.cache = validated;
      this.pending = null;
      return validated;
    })();

    try {
      return await this.pending;
    } catch (error) {
      // 失败时清空 pending，允许调用方修正配置后重试
      this.pending = null;
      throw error;
    }
  }

  /**
   * 热重载配置：清空缓存后重新 fetch 并校验。
   * 校验失败时保留旧缓存（若存在），避免线上热更新把游戏搞崩（GDD 1.1 版本回溯机制的本地版）。
   */
  public async hotReloadConfig(): Promise<ConfigModuleMap> {
    const previous = this.cache;
    this.cache = null;
    this.pending = null;
    try {
      return await this.loadAllConfigs();
    } catch (error) {
      if (previous !== null) {
        this.cache = previous;
        throw new Error(
          `配置热更新失败，已回滚到上一版配置。原因：${(error as Error).message}`,
        );
      }
      throw error;
    }
  }

  /**
   * 类型安全地读取某个配置模块。
   * @throws 配置尚未加载时抛出，提醒调用方先 await loadAllConfigs()
   */
  public getConfig<T extends ConfigModuleName>(module: T): ConfigModuleMap[T] {
    if (this.cache === null) {
      throw new Error(`配置尚未加载，请先 await ConfigLoader.getInstance().loadAllConfigs() 再读取「${module}」`);
    }
    const value = this.cache[module];
    if (value === undefined) {
      throw new Error(`配置模块「${module}」不存在于缓存中`);
    }
    return value;
  }

  /** 判断配置是否已完成加载 */
  public isLoaded(): boolean {
    return this.cache !== null;
  }

  /** 读取某个模块的原始版本字符串，便于 UI 显示与问题定位 */
  public getVersion(module: ConfigModuleName): string {
    const data = this.getConfig(module) as { version?: string };
    return data.version ?? 'unknown';
  }

  /** 拉取单个配置模块，失败时给出中文错误 */
  private async fetchModule(name: ConfigModuleName): Promise<unknown> {
    const url = `${CONFIG_BASE_PATH}${name}.json`;
    let response: Response;
    try {
      response = await fetch(url, { cache: 'no-cache' });
    } catch {
      throw new Error(`无法读取配置文件 ${url}，请确认 public/config/${name}.json 存在且开发服务器已启动`);
    }
    if (!response.ok) {
      throw new Error(`读取配置文件 ${url} 失败：HTTP ${response.status} ${response.statusText}`);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new Error(`配置文件 ${url} 不是合法 JSON，请检查是否多了逗号或缺少引号`);
    }
  }
}
