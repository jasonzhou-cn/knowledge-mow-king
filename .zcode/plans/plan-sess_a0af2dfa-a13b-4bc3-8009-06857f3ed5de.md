# T-033 趣味性与平衡性改造：「武器各有用武之地」

## 根因（已核实数值）
机关枪是万能解：单目标 DPS 100（大刀 81、霰弹 65）、射程 620 全场最高、还能穿透；且**所有小怪 100% 同质**（同血量/速度、只会追身近战），切武器零成本零收益，自动瞄准 460 半径全角锁定——站桩机枪通关是必然。

## 一期实施内容（全部配置驱动 + validator）

### 1. 武器数值再平衡（weaponConfig.json）
- 机关枪：damage 9→7.5、cooldown 0.09→0.1、range 620→**500**（DPS 100→75，射程不再全场压制）
- 大刀：cooldown 0.42→0.4、range 132→**150**（DPS≈80 + AoE + 强击退）
- 霰弹：cooldown 0.62→0.55、range 300→**340**（贴脸 DPS≈109，近战清群王）

### 2. 机关枪过热（硬约束）
- `weaponConfig.smg.overheat`：连续射击 18 发过热 → 锁定 2 秒（飘字「机枪过热！散热中…」）；停手散热 6/s；**切其他武器时继续被动散热** → 逼出「扫几轮换刀」节奏
- 武器栏机关枪槽位加黄→红热量条（复用冷却条绘制机制）

### 3. 四种怪变体（grassCuttingConfig.monsterVariants，加权随机 + fromLevel 门槛）
- **冲刺怪**（L3+）：血 ×0.6、速度 ×1.15，周期性朝玩家冲刺 ×3.2——霰弹击退/大刀 AoE 克星
- **扔书怪**（L5+）：远程型，与玩家保持 300 距离，每 2.8s 扔书落地形成伤害区（复用 DoomZoneSystem，零新弹丸系统）——逼玩家走位
- **铁锅头**（L4+，无厘头担当）：头顶铁锅，血 ×1.5，**吃子弹 ×0.5、吃大刀 ×1.6**——「子弹打在铁锅上叮一声弹开」
- **分裂怪**（L6+）：死后分裂 2 只小体怪——AoE 清理吃香
- 贴图 4 张程序化变体（复用现有呆萌团子底型加特征：铁锅/眼镜/裂纹/流线刺），零素材红线内
- 生成权重按关卡配置：L1-2 纯基础怪（教学期），变体逐步进场

### 4. 武器×怪 克制矩阵
- 变体带 `taken: { melee, ranged_bolt, ranged_spread }` 伤害系数表；CombatSystem 的伤害参数支持 per-monster 计算（damageFor 回调），飘字显示真实伤害——玩家能「看见」克制
- 铁锅头是核心样本：机关枪打它像挠痒、大刀两刀一个——换枪有明确的画面+数字反馈

### 5. 武器渐进解锁（改 2026-08-30「三把随时切」设计，已获你确认）
- 开局只有大刀；**通关 L2 且正确率 ≥60% 解锁机关枪，L4 同条件解锁霰弹枪**（把武器解锁绑回答题，强化核心绑定）
- 存档 meta 加 `weaponUnlocks`；老玩家存档（已解锁 L6+）自动补全三把；未解锁武器不进 WeaponSystem/武器栏
- 结算页解锁 toast「🎉 解锁新武器：机关枪！」；主菜单显示下一把解锁条件
- MenuScene/WeaponSystem/resolveLevel 全链路按已解锁过滤

### 6. 换武连携（软激励）
- 击杀后 1.5 秒内切武器 → 下一击伤害 ×1.25 + 飘字「连携！」——奖励搓搓搓，不惩罚单武器

### 7. 成就 +2
- 「十八般武艺」：单关三武器各击杀 ≥5；「铁头克星」：近战击杀铁锅头 ≥20（AchievementSystem 条件类型扩展 + 存档 totals 扩展）

## 二期候选（本轮不做）
知识大招（连对 3 题充能全屏清怪——强化核心绑定）、Boss 弱点相变（阶段切换弱点武器）、武器熟练度。

## 验证
- 单测：解锁判定与存档迁移、克制伤害纯函数、分裂怪、过热状态机（目标 130+ 用例）
- CDP 实测：L3+ 冲刺怪出现、铁锅头吃刀 1.6×/吃子弹 0.5×（飘字数值断言）、机枪 18 发过热锁定、连携飘字、低正确率通关不解锁/达标解锁 toast
- 质量门：typecheck / validate-config / npm test / canvas-lock 6/6 / smoke（画布红线不碰）
- 收口文档 docs/T-033-notes.md + 发布 dist-c + push

## 主要改动文件
weaponConfig / grassCuttingConfig / gameSettings / achievementConfig 四配置 + types/validator；WeaponSystem（解锁过滤+过热）、CombatSystem（per-monster 伤害）、MonsterSpawner（变体生成/冲刺/吐书/分裂）、WeaponBar（热量条）、BootScene（4 贴图）、GrassCuttingScene/ResultScene/MenuScene（接线）、ProgressionSystem（存档迁移）、AchievementSystem（条件类型）、tests ×3