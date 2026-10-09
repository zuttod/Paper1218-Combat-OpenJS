/*
 * FactionSettings.js —— 全局「阵营战斗」设置（OpenJS 1.5.0 / Paper 1.21.8）
 *
 * 本脚本不生成任何实体、不注册 BOSS，只做一件事：
 *   持有「是否主动攻击非同阵营」这个开关，并持久化，供所有 BOSS 脚本跨引擎读取。
 *
 * 指令：
 *   /faction                       查看设置与已知阵营
 *   /faction attack on             开启：各阵营 BOSS 主动攻击非同阵营目标
 *   /faction attack off            关闭：只反击，不主动出击（默认）
 *   /bandit ...                    同义指令（历史名字，等价于 /faction）
 *
 * 状态持久化在主世界 PDC（键 bandit_faction_aggressive），重启后仍然有效。
 *
 * 跨脚本读取方式（契约 M-1：只传基本值与函数）：
 *   var api = getShared("FactionSettings");
 *   if (api != null && api.isAggressive() === true) { ... }
 *   设置脚本未加载时，各 BOSS 脚本会退回自己的 FALLBACK_ATTACK_NON_FACTION（默认 false）。
 *   为兼容早期版本，本脚本同时以 "BanditFaction" 这个名字暴露同一个对象。
 *
 * 「阵营」的约定（各 BOSS 脚本自行遵守）：
 *   - faction tag：打在自己本体实体上的 scoreboard tag，例如
 *       土匪（精英三人组）：bandit_faction
 *       流寇（本体三人组）：liukou_faction
 *   - scoreboard team：队伍名前缀用于头顶显示，例如 bandit / liukou
 *   - 判定「同阵营」= 对方实体带同一个 faction tag
 *   - 判定「非同阵营目标」= 非玩家、非同阵营，且满足下列任一：
 *       1) 实体实现 org.bukkit.entity.Enemy（原版敌对生物）
 *       2) tag 命中 custom_hostile（此后新增的自定义生物统一打这个标记）
 *       3) tag 以 _boss 结尾（仓库里自定义 BOSS 的既有约定）
 *
 * 契约依据：《OpenJS脚本数据契约.md》v1.0.0
 *   - 第 2 节 IIFE + "use strict" 作用域隔离
 *   - M-1 跨引擎只共享 Java 值
 */

(function () {
    "use strict";

    var Bukkit = Java.type("org.bukkit.Bukkit");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");

    var SETTINGS_KEY = new NamespacedKey(plugin, "bandit_faction_aggressive");

    // 已知阵营一览（只用于 /faction 的提示文字，判定本身靠 faction tag）
    var FACTIONS = [
        { tag: "bandit_faction", team: "bandit", name: "土匪", members: "无爵骑士_精英 / 神射手_精英 / 流浪术士_精英" },
        { tag: "liukou_faction", team: "liukou", name: "流寇", members: "无爵骑士 / 神射手 / 流浪术士（本体三人组）" }
    ];

    var aggressive = false;

    function mainWorld() {
        var worlds = Bukkit.getWorlds();
        return (worlds == null || worlds.size() === 0) ? null : worlds.get(0);
    }

    function loadSettings() {
        try {
            var world = mainWorld();
            if (world == null) return;
            var pdc = world.getPersistentDataContainer();
            if (pdc.has(SETTINGS_KEY, PersistentDataType.STRING)) {
                aggressive = String(pdc.get(SETTINGS_KEY, PersistentDataType.STRING)) === "true";
            }
        } catch (e) {
            log.error("FactionSettings 读取设置失败：" + e);
        }
    }

    function saveSettings() {
        try {
            var world = mainWorld();
            if (world == null) return;
            world.getPersistentDataContainer().set(SETTINGS_KEY, PersistentDataType.STRING,
                aggressive ? "true" : "false");
        } catch (e) {
            log.error("FactionSettings 保存设置失败：" + e);
        }
    }

    // 跨引擎只暴露基本值与函数（M-1）
    var api = {
        version: 1,
        isAggressive: function () { return aggressive; },
        setAggressive: function (v) {
            aggressive = (v === true || String(v) === "true");
            saveSettings();
            log.info("FactionSettings 设置更新：主动攻击非同阵营 = " + aggressive);
            return aggressive;
        },
        toggleAggressive: function () { return api.setAggressive(!aggressive); }
    };

    setShared("FactionSettings", api);
    setShared("BanditFaction", api);   // 兼容早期版本用的名字
    loadSettings();

    // -----------------------------------------------------------------------
    // 指令
    // -----------------------------------------------------------------------
    function handle(sender, args) {
        try {
            var sub = (args != null && args.length > 0) ? String(args[0]).toLowerCase() : "";
            if (sub === "attack") {
                var v = (args.length > 1) ? String(args[1]).toLowerCase() : "";
                if (v === "on" || v === "true" || v === "1") {
                    api.setAggressive(true);
                    sender.sendMessage(ChatColor.DARK_RED + "[阵营] " + ChatColor.GREEN
                        + "已开启：各阵营 BOSS 主动攻击非同阵营目标"
                        + "（自定义 BOSS / 原版敌对生物 / 带 custom_hostile 的自定义生物）");
                } else if (v === "off" || v === "false" || v === "0") {
                    api.setAggressive(false);
                    sender.sendMessage(ChatColor.DARK_RED + "[阵营] " + ChatColor.YELLOW
                        + "已关闭：只反击、不主动出击");
                } else {
                    sender.sendMessage(ChatColor.RED + "用法：/faction attack <on|off>");
                }
                return;
            }
            sender.sendMessage(ChatColor.DARK_RED + "===== 阵营战斗设置 =====");
            sender.sendMessage(ChatColor.GRAY + "主动攻击非同阵营："
                + (aggressive ? ChatColor.GREEN + "开启" : ChatColor.RED + "关闭"));
            sender.sendMessage(ChatColor.GRAY + "可攻击对象：非同阵营的自定义 BOSS（tag 以 _boss 结尾）、"
                + "原版敌对生物（Enemy）、带 custom_hostile 标记的自定义生物");
            sender.sendMessage(ChatColor.GRAY + "同阵营之间：友伤关闭，增益只在阵营内生效");
            for (var i = 0; i < FACTIONS.length; i++) {
                var f = FACTIONS[i];
                sender.sendMessage(ChatColor.DARK_RED + "[" + f.name + "] " + ChatColor.GRAY
                    + f.members + ChatColor.DARK_GRAY + "  (tag=" + f.tag + ", team=" + f.team + ")");
            }
            sender.sendMessage(ChatColor.GRAY + "用法：/faction attack <on|off>");
        } catch (e) {
            try { log.error("FactionSettings 指令异常：" + e); } catch (ignored) { }
        }
    }

    addCommand("faction", { onCommand: handle });
    addCommand("bandit", { onCommand: handle });   // 历史名字，行为完全一致

    log.info("FactionSettings 已加载：主动攻击非同阵营 = " + aggressive
        + "（/faction attack on|off 切换，状态持久化）");
})();
