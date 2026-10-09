# Paper1218-Combat-OpenJS

基于 **Paper 1.21.8 + OpenJS 1.5.0** 的自定义 BOSS 脚本集。
每个脚本都是独立的 IIFE + `"use strict"`，各自跑在自己的 Nashorn 引擎里，
跨脚本只通过 `getShared()` 交换 **Java 基本值**（契约 M-1）。

---

## 一、脚本清单

| 脚本 | 作用 |
|---|---|
| `CallBoss.js` | BOSS 注册表 + `/call boss` 召唤入口（前缀匹配、别名、绿宝石右键倒计时召唤） |
| `BossRegistry`（由 CallBoss 暴露） | 跨脚本注册/心跳/召唤接口，`getShared("BossRegistry")` |
| `TitlelessKnight.js` | 本体 BOSS：无爵骑士（HP200，铁甲 + 下界合金剑，大剑三式 / 恐惧战吼 / 冲锋） |
| `Sharpshooter.js` | 本体 BOSS：神射手（HP100，白甲流浪者，四式弓 + 闪避瞬移） |
| `WanderingWarlock.js` | 本体 BOSS：流浪术士（HP150，金甲骷髅，十种法术，会给队友套护盾/护甲） |
| `ThousandFacedWitch.js` | 本体 BOSS：千面魔女（HP650，分身 / 阶段转换） |
| `FirstLichKing.js` | 本体 BOSS：初代巫妖王（HP900，亡灵护盾 / 僵尸波 / 强化射线） |
| `InfernoFoehn.js` | 本体 BOSS：炎狱焚风（HP999，冲撞 / 吸附激光 / 火种阶段，含困难模式） |
| `BanditTrio.js` | 召唤条目：流寇三人组（一次召唤本体三人组） |
| **`TitlelessKnightElite.js`** | **精英 BOSS：无爵骑士_精英**（HP450，铁甲保护 III，大剑冷却 1.5 秒，连冲 2 段，战令光环） |
| **`SharpshooterElite.js`** | **精英 BOSS：神射手_精英**（HP300，皮革甲弹射保护 III，攻击冷却 2 秒，闪避 3 发，箭矢穿透队友） |
| **`WanderingWarlockElite.js`** | **精英 BOSS：流浪术士_精英**（HP300，下界合金头盔弹射保护 IV，全法术连发 2 次，偏辅助，闪电束 64 格，无文字提示） |
| **`BanditTrioElite.js`** | **召唤条目：土匪三人组**（一次召唤三个精英，并打上 [土匪] 阵营标识） |
| **`FactionSettings.js`** | **全局阵营战斗设置**（主动攻击开关 + 持久化 + `/faction` 指令） |
| `GetEquip.js` | 装备注册表 + `/equip` 指令（注册表已按 M-1 改成 Java 容器 + Java 适配器） |
| `CombatStats.js` / `DouQuQu.js` / `Resurrection.js` / `StarResurrection.js` | 战斗统计 / 读条复活 / 复活点等辅助系统 |
| `BasicShield.js` / `Durendal.js` / `EnderSword.js` / `KanKanSword.js` / `MagicBulletShooter.js` / `SoulReapingSword.js` / `SuperTNT.js` / `VillageSword.js` | 武器与道具效果 |
| `AxiomApiTest.js` / `AxiomAdvancedTest.js` | Axiom 接口试验脚本 |

> 加粗的是本仓库相对早期版本新增的内容。

---

## 二、阵营系统

BOSS 可以被划入「阵营」，用于友伤、增益范围与主动攻击的判定。

| 阵营 | faction tag | scoreboard team | 成员 |
|---|---|---|---|
| 土匪 | `bandit_faction` | `bandit`（前缀 `§4[土匪] §r`） | 无爵骑士_精英 / 神射手_精英 / 流浪术士_精英 |
| 流寇 | `liukou_faction` | `liukou`（前缀 `§8[流寇] §r`） | 无爵骑士 / 神射手 / 流浪术士（本体三人组） |
| 无阵营 | — | — | 千面魔女 / 初代巫妖王 / 炎狱焚风（对所有人都是「非同阵营」） |

阵营标记由各 BOSS 脚本在**自己的生成流程里**打上（`addScoreboardTag` + 加入 team），
所以无论单独召唤还是组合召唤，身份都一致。

**跨脚本查询阵营（注意用主计分板）**：

```js
var sb = Bukkit.getScoreboardManager().getMainScoreboard();
var team = sb.getEntryTeam(String(entity.getUniqueId().toString()));
var isBandit = entity.getScoreboardTags().contains("bandit_faction")
            || (team != null && team.getName() === "bandit");
```

> 实测坑：`entity.getScoreboard()` 在部分服务端上不是函数（抛 `TypeError`），
> 查队伍必须用 `Bukkit.getScoreboardManager().getMainScoreboard()`。

---

## 三、阵营战斗规则

| 规则 | 行为 |
|---|---|
| 同阵营友伤 | **关闭**（攻击者带同一个 faction tag → 伤害被取消） |
| 被其它生物实体伤害 | **允许**（原版敌对生物、其它自定义 BOSS、自定义生物都能打伤它们） |
| 反击 | **开启**：挨打后记住攻击者 10 秒，追上去按冷却还手（每次再挨打刷新计时） |
| 主动攻击 | 由 `/faction attack on\|off` 控制，默认 **关闭**（只反击） |
| 增益范围 | 只作用于**同阵营**（骑士战令光环、术士护盾术 / 法师护甲） |

**可攻击对象**（主动模式下才生效；玩家始终走原有战斗逻辑）：

1. 非同阵营的自定义 BOSS —— scoreboard tag 以 `_boss` 结尾（仓库既有约定）；
2. 原版非友好生物 —— 实体实现 `org.bukkit.entity.Enemy`；
3. 此后新增的自定义生物 —— 给它打上 `custom_hostile` 标记即可，**不需要改脚本**。

判定常量在各脚本里：`HOSTILE_TAGS_EXACT = ["custom_hostile"]`、
`HOSTILE_TAG_SUFFIXES = ["_boss"]`。

**反击参数**：无爵骑士 6~8 点 / 1~2 秒；神射手 4~5 点 / 1.5 秒；流浪术士 4~5 点 / 1.5 秒；
独立 BOSS 8 点 / 1.5 秒。反击不占用各自的技能状态机，被围殴时也能还手。

---

## 四、指令

| 指令 | 说明 |
|---|---|
| `/call boss` | 列出全部可用 BOSS |
| `/call boss <名字/别名>` | 获得该 BOSS 的召唤绿宝石（右键地面 → 6 秒倒计时 → 降临） |
| `/call boss 土匪` | 一次召唤三个精英（土匪三人组） |
| `/call boss 流寇` | 一次召唤三个本体（流寇三人组） |
| `/faction` | 查看阵营战斗设置与阵营一览 |
| `/faction attack <on\|off>` | 开关「主动攻击非同阵营」（持久化，重启仍有效） |
| `/bandit` | 同 `/faction`（历史名字） |

---

## 五、契约与踩过的坑

完整契约见 [`OpenJS脚本数据契约.md`](OpenJS脚本数据契约.md)，开发资料见
[`可能有用的开发资料.md`](可能有用的开发资料.md)。以下是实际踩到并已修复的：

1. **跨引擎只能传 Java 值**（M-1）。JS 对象属性跨引擎读取不可靠 →
   注册表一律用 `java.util.ArrayList` / `ConcurrentHashMap`，
   函数用 `Java.extend(...)` 包成真正的 Java 接口对象。
2. **`Class.forName(...)` 的结果不能用于 `instanceof`**。
   会抛 `TypeError: instanceof must be called with a javascript or java object`；
   如果外面包着 `try/catch`，异常被吞掉 → 函数永远返回 `false`，
   症状是「开关打开了却完全没反应」。
   `instanceof` 的右操作数必须用 `Java.type(...)`；
   `Class.forName(...)` 只能当 Class 参数传给 `world.spawn(...)` / `getEntitiesByClass(...)`。
3. **`world.spawn(...)` 需要 `Class.forName(...)`** 得到的 Class 对象（M-5），与第 2 条正好相反。
4. **`registerEvent` 要推迟到主线程第一个 tick**（M-2）。
5. **派生出新 BOSS 时，实体 tag / PDC 键 / BossBar 键 / 状态表必须全部改新**，
   否则两个 BOSS 会互相认领对方的实体。
6. **调用脚本的 `spawn` 句柄在 `/oj reload` 后会失效**，注册表必须支持心跳 + 无条件重注册。
7. **查 scoreboard team 用主计分板**，`entity.getScoreboard()` 不一定是函数。

---

## 六、测试环境

- Paper **1.21.8-60**（Java 21）
- OpenJS **1.5.0**（内置 Nashorn 15.7，每个脚本一个引擎）
- 世界类型：超平坦（50 层平滑石头）
- 已验证：12 个 BOSS 全部注册与召唤、精英派生隔离、EquipRegistry 8 次启动一致、
  阵营友伤/反击/主动攻击/增益范围、BOSS 之间互殴（流寇 ↔ 土匪）
