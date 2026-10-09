/*
 * BanditTrioElite.js —— 自定义召唤条目「土匪三人组」（OpenJS 1.5.0 / Paper 1.21.8）
 *
 * 获取方式：/call boss 土匪三人组（别名：土匪）
 * 召唤方式：手持名为「土匪三人组」的绿宝石右键地面 → 6 秒倒计时 → 同时召唤三名精英成员
 *
 * 机制摘要：
 *   - 本脚本不生成任何实体，它注册的是一个「组合召唤条目」：
 *     倒计时结束时通过 getShared("BossRegistry").spawn(...) 依次召唤三名成员；
 *   - 三名成员 = 本机新增的三个精英 BOSS：
 *       · 无爵骑士_精英（id: titleless_knight_elite）
 *       · 神射手_精英  （id: sharpshooter_elite）
 *       · 流浪术士_精英（id: wandering_warlock_elite）
 *   - 三者同属「土匪」阵营：每个精英脚本在生成时都会给自己打上 bandit_faction tag
 *     并加入 scoreboard team「bandit」；本脚本额外把成员的**名字显示打开**，
 *     于是头顶会显示成「[土匪] 无爵骑士_精英」（开关：SHOW_FACTION_NAMETAG）。
 *   - 成员的落点由本脚本的站位求解器计算：先按三角阵型分配位置，逐个做
 *     「支撑方块 + 净空」校验，被占用或净空不足时改换备用位置，避免三人叠在一起；
 *   - 只要有一名成员成功降临就算召唤成功，并在聊天栏与日志里列出成功 / 失败的成员。
 *
 * 成员站位（相对召唤点，+X 为正前方）：
 *   · 无爵骑士_精英   (+2.5,  0.0)
 *   · 神射手_精英     (-1.5, +2.5)
 *   · 流浪术士_精英   (-1.5, -2.5)
 *
 * ---- 「土匪」阵营约定（后续调整请统一按这套标识） ----
 *   faction tag : bandit_faction
 *   team 名     : bandit        前缀 "§4[土匪] §r"，displayName "[土匪]"
 *   判定示例    : entity.getScoreboardTags().contains("bandit_faction")
 *                 entity.getScoreboard().getEntryTeam(uuid) != null
 *                     && entity.getScoreboard().getEntryTeam(uuid).getName() === "bandit"
 *   三个精英脚本（TitlelessKnightElite / SharpshooterElite / WanderingWarlockElite）
 *   里都有同名的 FACTION_TAG / FACTION_TEAM 常量与 joinFactionTeam()，改动时要一起改。
 *
 * 契约依据：《OpenJS脚本数据契约.md》v1.0.0
 *   - 第 2 节  IIFE + "use strict" 作用域隔离
 *   - M-1 跨引擎只共享 Java 值（注册只传基本值 + 函数）
 *   - M-2 事件注册推迟到主线程第一个 tick（本脚本无事件，仅注册条目）
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // Java / API 类型
    // -----------------------------------------------------------------------
    var Class = Java.type("java.lang.Class");
    var Location = Java.type("org.bukkit.Location");
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var ArrayList = Java.type("java.util.ArrayList");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");

    var EntityClass = Class.forName("org.bukkit.entity.Entity");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var BOSS_ID = "bandit_trio_elite";
    var BOSS_NAME = "土匪三人组";
    // 别名：/call boss 土匪 也能召唤；不占用「流寇三人组」的别名（三人组 / 流寇 / trio / bandits）
    var BOSS_ALIASES = ["土匪", "bandit_trio_elite", "bandittrioelite", "tufei"];
    var BOSS_LORE = [
        "一次召唤三名「土匪」阵营的精英首领（同时降临、各自独立行动）：",
        "· 无爵骑士_精英：HP450、铁甲保护 III、大剑冷却 1.5 秒、连冲 2 段、战令光环",
        "· 神射手_精英  ：HP300、皮革甲（弹射保护 III / 保护 III）、攻击冷却 2 秒、闪避 3 发、箭矢穿透队友",
        "· 流浪术士_精英：HP300、下界合金头盔（弹射保护 IV）、全法术连发 2 次、偏辅助、闪电束 64 格",
        "————————————————",
        "阵营：[土匪]（三人头顶会带 [土匪] 前缀）",
        "站位：骑士在正前方，神射手与流浪术士分列左右后方",
        "提示：三人同场时流浪术士会优先给同伴套护盾 / 加护甲",
        "建议组队挑战，或准备好掩体与远程手段"
    ];

    // 「土匪」阵营标识（与三个精英脚本保持一致）
    var FACTION_TAG = "bandit_faction";
    var FACTION_TEAM = "bandit";
    var FACTION_PREFIX = ChatColor.DARK_RED + "[土匪] " + ChatColor.RESET;
    var SHOW_FACTION_NAMETAG = true;    // true = 召唤后把成员名字显示打开，头顶可见 [土匪] 前缀

    // 成员定义：id 必须是已在 BossRegistry 注册的自定义 BOSS；
    // tag 是该 BOSS 脚本给自己打的 scoreboard tag，用来在召唤后找回实体、补阵营标记。
    var MEMBERS = [
        { id: "titleless_knight_elite", name: "无爵骑士_精英", tag: "titleless_knight_elite_boss", dx: 2.5, dz: 0.0 },
        { id: "sharpshooter_elite", name: "神射手_精英", tag: "sharpshooter_elite_boss", dx: -1.5, dz: 2.5 },
        { id: "wandering_warlock_elite", name: "流浪术士_精英", tag: "wandering_warlock_elite_boss", dx: -1.5, dz: -2.5 }
    ];

    // 备用站位：首选位置被占用 / 净空不足时按顺序尝试。
    // 第一个 [0,0] 是右下角召唤点本身（CallBoss 已保证其上方净空）。
    var FALLBACK_OFFSETS = [
        [0.0, 0.0],
        [2.5, 2.5], [2.5, -2.5], [-1.5, 0.0], [-2.5, 0.0],
        [0.0, 2.5], [0.0, -2.5], [4.0, 0.0], [-4.0, 0.0],
        [0.0, 4.0], [0.0, -4.0], [4.0, 4.0], [4.0, -4.0],
        [-4.0, 4.0], [-4.0, -4.0]
    ];

    // 站位校验参数（与 CallBoss / 各 BOSS 脚本保持一致）
    var CLEARANCE_HEIGHT = 3;       // 脚部往上需要的净空高度
    var MAX_STEP_UP = 1;            // 相对基准 Y 允许的抬升
    var MAX_STEP_DOWN = 3;          // 相对基准 Y 允许的下沉
    var CLAIM_DISTANCE_SQ = 2.25;   // 1.5 格内视为同一落点，避免两人重叠

    var HEARTBEAT_INTERVAL_TICKS = 20;  // 心跳必须远小于 CallBoss 的 10 秒失效阈值

    // -----------------------------------------------------------------------
    // 「土匪」阵营：加 tag + 入队 + 可选显示名字
    // -----------------------------------------------------------------------
    function joinFactionTeam(entity) {
        try {
            var sb = Bukkit.getScoreboardManager().getMainScoreboard();
            var team = sb.getTeam(FACTION_TEAM);
            if (team == null) {
                team = sb.registerNewTeam(FACTION_TEAM);
                team.setDisplayName("[土匪]");
            }
            team.setPrefix(FACTION_PREFIX);
            var entry = String(entity.getUniqueId().toString());
            if (!team.hasEntry(entry)) team.addEntry(entry);
        } catch (e) {
            log.error("BanditTrioElite 加入土匪阵营失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function applyFaction(entity) {
        try {
            entity.addScoreboardTag(FACTION_TAG);
            joinFactionTeam(entity);
            if (SHOW_FACTION_NAMETAG) entity.setCustomNameVisible(true);
        } catch (e) {
            log.error("BanditTrioElite 补阵营标记失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    // 召唤后按 tag + 距离找回刚生成的实体（api.spawn 只返回 true/false）
    function findSpawnedEntity(world, tag, x, y, z) {
        var best = null;
        var bestDist = 36.0;    // 6 格以内
        try {
            var target = new Location(world, x, y, z);
            var it = world.getEntitiesByClass(EntityClass).iterator();
            while (it.hasNext()) {
                var e = it.next();
                try {
                    if (!e.getScoreboardTags().contains(tag)) continue;
                    var d = e.getLocation().distanceSquared(target);
                    if (d < bestDist) { bestDist = d; best = e; }
                } catch (ignored) { }
            }
        } catch (e2) {
            log.error("BanditTrioElite 查找召唤实体异常：" + e2);
        }
        return best;
    }

    // -----------------------------------------------------------------------
    // 站位求解
    // -----------------------------------------------------------------------
    function isPassableBlock(block) {
        try {
            return !block.getType().isSolid();
        } catch (e) {
            return true;    // 读方块异常时不阻塞召唤
        }
    }

    // 在基准 Y 的上 1 / 下 3 格范围内，为该 (x,z) 找一个「脚下有支撑 + 头顶净空」的 Y。
    function findStandY(world, x, baseY, z) {
        var bx = Math.floor(x);
        var bz = Math.floor(z);
        var base = Math.floor(baseY);
        var lift;
        try {
            for (lift = 0; lift <= MAX_STEP_UP; lift++) {
                var upY = base + lift;
                if (world.getBlockAt(bx, upY - 1, bz).getType().isSolid() && isColumnClear(world, bx, upY, bz)) {
                    return upY;
                }
            }
            for (var drop = 1; drop <= MAX_STEP_DOWN; drop++) {
                var downY = base - drop;
                if (world.getBlockAt(bx, downY - 1, bz).getType().isSolid() && isColumnClear(world, bx, downY, bz)) {
                    return downY;
                }
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    function isColumnClear(world, bx, y, bz) {
        for (var h = 0; h < CLEARANCE_HEIGHT; h++) {
            if (!isPassableBlock(world.getBlockAt(bx, y + h, bz))) return false;
        }
        return true;
    }

    // 计算朝向召唤点中心的 yaw（MC 约定：0=+Z，90=-X）
    function yawToward(x, z, cx, cz) {
        var dx = cx - x;
        var dz = cz - z;
        if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) return 0;
        return Math.atan2(-dx, dz) * 180.0 / Math.PI;
    }

    // 为每名成员求解落点；返回 { placed: [...], fellBack: n }
    function planPlacement(world, baseX, baseY, baseZ) {
        var placed = [];
        var fellBack = 0;

        for (var i = 0; i < MEMBERS.length; i++) {
            var member = MEMBERS[i];
            // 候选顺序：首选三角形站位 → 备用站位（去重）
            var candidates = [[member.dx, member.dz]];
            for (var c = 0; c < FALLBACK_OFFSETS.length; c++) {
                var fo = FALLBACK_OFFSETS[c];
                if (Math.abs(fo[0] - member.dx) < 0.0001 && Math.abs(fo[1] - member.dz) < 0.0001) continue;
                candidates.push(fo);
            }

            var chosen = null;
            var chosenIndex = -1;
            for (var k = 0; k < candidates.length; k++) {
                var px = baseX + candidates[k][0];
                var pz = baseZ + candidates[k][1];
                if (isClaimed(placed, px, pz)) continue;
                var standY = findStandY(world, px, baseY, pz);
                if (standY == null) continue;
                chosen = { x: px, y: standY, z: pz };
                chosenIndex = k;
                break;
            }

            if (chosen == null) {
                // 全部候选都不可用：仍按首选位置召唤（成员脚本会各自兜底），
                // 并把这些成员记进 fellBack 以便日志排查。
                chosen = { x: baseX + member.dx, y: baseY, z: baseZ + member.dz };
                chosenIndex = 0;
                fellBack++;
            } else if (chosenIndex > 0) {
                fellBack++;
            }

            placed.push({
                member: member,
                x: chosen.x,
                y: chosen.y,
                z: chosen.z,
                yaw: yawToward(chosen.x, chosen.z, baseX, baseZ),
                usedPreferred: chosenIndex <= 0
            });
        }

        return { placed: placed, fellBack: fellBack };
    }

    function isClaimed(placed, x, z) {
        for (var i = 0; i < placed.length; i++) {
            var dx = placed[i].x - x;
            var dz = placed[i].z - z;
            if (dx * dx + dz * dz < CLAIM_DISTANCE_SQ) return true;
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // 召唤
    // -----------------------------------------------------------------------
    function spawnBanditTrio(location, player) {
        try {
            if (location == null) return false;
            var world = location.getWorld();
            if (world == null) return false;

            var api = getShared("BossRegistry");
            if (api == null) {
                log.error("BanditTrioElite 召唤失败：BossRegistry 不存在（CallBoss.js 未加载？）");
                return false;
            }

            var plan = planPlacement(world, location.getX(), location.getY(), location.getZ());

            var spawnedNames = [];
            var failedNames = [];
            var spots = [];
            for (var i = 0; i < plan.placed.length; i++) {
                var entry = plan.placed[i];
                var memberLoc = new Location(world, entry.x, entry.y, entry.z, entry.yaw, 0);
                var ok = false;
                try {
                    ok = api.spawn(entry.member.id, memberLoc, player);
                } catch (e) {
                    log.error("BanditTrioElite 召唤成员异常：" + entry.member.name + " —— " + e
                        + (e && e.stack ? "\n" + e.stack : ""));
                    ok = false;
                }
                if (ok === true || String(ok) === "true") {
                    spawnedNames.push(entry.member.name);
                    spots.push(entry.member.name + "@"
                        + entry.x.toFixed(1) + "," + entry.y.toFixed(1) + "," + entry.z.toFixed(1)
                        + (entry.usedPreferred ? "" : "(备用位)"));
                    // 补阵营标记 + 打开名字显示（精英脚本自己也做过一遍，这里是幂等的双保险）
                    var ent = findSpawnedEntity(world, entry.member.tag, entry.x, entry.y, entry.z);
                    if (ent != null) {
                        applyFaction(ent);
                    } else {
                        log.warn("BanditTrioElite 未找到 " + entry.member.name
                            + " 的实体，阵营标记只依赖其自身脚本");
                    }
                } else {
                    failedNames.push(entry.member.name);
                }
            }

            if (spawnedNames.length === 0) {
                log.error("BanditTrioElite 召唤失败：三名成员全部未能降临。");
                return false;
            }

            try {
                if (player != null) {
                    player.sendMessage(ChatColor.DARK_RED + "§l" + BOSS_NAME + ChatColor.RED + " 已降临："
                        + ChatColor.WHITE + spawnedNames.join("、"));
                    if (failedNames.length > 0) {
                        player.sendMessage(ChatColor.RED + "以下成员召唤失败（脚本未加载或空间不足）："
                            + ChatColor.GRAY + failedNames.join("、"));
                    }
                }
            } catch (ignored) { }

            log.info("BanditTrioElite 召唤完成：成功 " + spawnedNames.length + "/" + MEMBERS.length
                + "（" + spawnedNames.join("、") + "）"
                + " 站位[" + spots.join(" | ") + "]"
                + (plan.fellBack > 0 ? " 备用位/兜底=" + plan.fellBack : "")
                + (failedNames.length > 0 ? "，失败：" + failedNames.join("、") : "")
                + " 阵营=[土匪]");
            return true;
        } catch (e) {
            log.error("BanditTrioElite 召唤异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // BossRegistry 注册
    // M-1：跨脚本引擎保存 JS 对象会读串号，只传基本值与函数；
    // 别名 / 简介用 java.util.ArrayList（纯 Java 容器），跨引擎读取最稳。
    // -----------------------------------------------------------------------
    var registeredThisInstance = false;

    function ensureRegistered() {
        try {
            var api = getShared("BossRegistry");
            if (api == null) return;
            // 已在表里且心跳刷新成功 → 直接返回；否则（首次加载，或表里已经没有我）
            // 重新注册（/oj reload CallBoss.js 换表后必须能自愈）。
            if (registeredThisInstance && api.heartbeat(BOSS_ID) === true) return;

            // 必须无条件覆盖注册（/oj reload 后旧实例的 spawn 句柄会失效）
            var aliases = new ArrayList();
            for (var i = 0; i < BOSS_ALIASES.length; i++) aliases.add(String(BOSS_ALIASES[i]));
            var lore = new ArrayList();
            for (var j = 0; j < BOSS_LORE.length; j++) lore.add(String(BOSS_LORE[j]));
            api.register(BOSS_ID, BOSS_NAME, aliases, lore, spawnBanditTrio);
            registeredThisInstance = true;
        } catch (e) {
            try { log.error("BanditTrioElite 注册异常：" + e + (e && e.stack ? "\n" + e.stack : "")); } catch (ignored) { }
        }
    }

    ensureRegistered();
    task.repeat(ticks(HEARTBEAT_INTERVAL_TICKS), ticks(HEARTBEAT_INTERVAL_TICKS), ensureRegistered);

    // -----------------------------------------------------------------------
    // 启动日志
    // -----------------------------------------------------------------------
    log.info("BanditTrioElite 已加载：使用 /call boss " + BOSS_NAME
        + "（或 /call boss 土匪）获取召唤绿宝石（一次召唤三名 [土匪] 成员）。");
})();
