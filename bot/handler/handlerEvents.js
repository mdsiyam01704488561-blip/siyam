const fs = require("fs-extra");
const nullAndUndefined = [undefined, null];

function getType(obj) {
	return Object.prototype.toString.call(obj).slice(8, -1);
}

function getRole(threadData, senderID) {
	const config = global.GoatBot.config;
	const adminBot = config.adminBot || [];
	const devUser = config.devUser || [];
	const vipUser = config.vipUser || [];
	const nsfwUser = config.nsfwUser || [];

	if (!senderID) return 0;
	
	if (nsfwUser.includes(senderID)) return 5;
	if (vipUser.includes(senderID)) return 4;
	if (devUser.includes(senderID)) return 3;
	if (adminBot.includes(senderID)) return 2;

	const adminBox = threadData ? threadData.adminIDs || [] : [];
	return adminBox.includes(senderID) ? 1 : 0;
}

function getText(type, reason, time, targetID, lang) {
	const utils = global.utils;
	const heads = { lang, head: "handlerEvents" };
	if (type == "userBanned") return utils.getText(heads, "userBanned", reason, time, targetID);
	else if (type == "threadBanned") return utils.getText(heads, "threadBanned", reason, time, targetID);
	else if (type == "onlyAdminBox") return utils.getText(heads, "onlyAdminBox");
	else if (type == "onlyAdminBot") return utils.getText(heads, "onlyAdminBot");
}

function replaceShortcutInLang(text, prefix, commandName) {
	return text.replace(/\{(?:p|prefix)\}/g, prefix).replace(/\{(?:n|name)\}/g, commandName).replace(/\{pn\}/g, `${prefix}${commandName}`);
}

function getRoleConfig(utils, command, isGroup, threadData, commandName) {
	let roleConfig;
	if (utils.isNumber(command.config.role)) {
		roleConfig = { onStart: command.config.role };
	} else if (typeof command.config.role == "object" && !Array.isArray(command.config.role)) {
		if (!command.config.role.onStart) command.config.role.onStart = 0;
		roleConfig = command.config.role;
	} else {
		roleConfig = { onStart: 0 };
	}
	if (isGroup) roleConfig.onStart = threadData.data.setRole?.[commandName] ?? roleConfig.onStart;
	for (const key of ["onChat", "onStart", "onReaction", "onReply"]) {
		if (roleConfig[key] == undefined) roleConfig[key] = roleConfig.onStart;
	}
	return roleConfig;
}

function isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, lang) {
	const config = global.GoatBot.config;
	const { adminBot, hideNotiMessage } = config;
	const infoBannedUser = userData.banned;
	if (infoBannedUser.status == true) {
		const { reason, date } = infoBannedUser;
		if (hideNotiMessage.userBanned == false) message.reply(getText("userBanned", reason, date, senderID, lang));
		return true;
	}
	if (config.adminOnly.enable == true && !adminBot.includes(senderID) && !config.adminOnly.ignoreCommand.includes(commandName)) {
		if (hideNotiMessage.adminOnly == false) message.reply(getText("onlyAdminBot", null, null, null, lang));
		return true;
	}
	if (isGroup == true) {
		if (threadData.data.onlyAdminBox === true && !threadData.adminIDs.includes(senderID) && !(threadData.data.ignoreCommanToOnlyAdminBox || []).includes(commandName)) {
			if (!threadData.data.hideNotiMessageOnlyAdminBox) message.reply(getText("onlyAdminBox", null, null, null, lang));
			return true;
		}
		const infoBannedThread = threadData.banned;
		if (infoBannedThread.status == true) {
			const { reason, date } = infoBannedThread;
			if (hideNotiMessage.threadBanned == false) message.reply(getText("threadBanned", reason, date, threadID, lang));
			return true;
		}
	}
	return false;
}

function createGetText2(langCode, pathCustomLang, prefix, command) {
	const commandName = command.config.name;
	let customLang = {};
	if (fs.existsSync(pathCustomLang)) customLang = require(pathCustomLang)[commandName]?.text || {};
	return function (key, ...args) {
		let lang = command.langs?.[langCode]?.[key] || customLang[key] || "";
		lang = replaceShortcutInLang(lang, prefix, commandName);
		for (let i = args.length - 1; i >= 0; i--) lang = lang.replace(new RegExp(`%${i + 1}`, "g"), args[i]);
		return lang || `Missing text: "${key}"`;
	};
}

module.exports = function (api, threadModel, userModel, dashBoardModel, globalModel, usersData, threadsData, dashBoardData, globalData) {
	return async function (event, message) {
		const { utils, client, GoatBot } = global;
		const { getPrefix, removeHomeDir, log, getTime } = utils;
		const { config, configCommands: { envGlobal, envCommands, envEvents } } = GoatBot;
		const { autoRefreshThreadInfoFirstTime } = config.database;
		let { hideNotiMessage = {} } = config;

		const { body, messageID, threadID, isGroup } = event;
		if (!threadID) return;

		const senderID = event.userID || event.senderID || event.author;
		let threadData = global.db.allThreadData.find(t => t.threadID == threadID);
		let userData = global.db.allUserData.find(u => u.userID == senderID);

		if (!userData && !isNaN(senderID)) userData = await usersData.create(senderID);
		if (!threadData && !isNaN(threadID)) {
			if (global.temp.createThreadDataError.includes(threadID)) return;
			threadData = await threadsData.create(threadID);
			global.db.receivedTheFirstMessage[threadID] = true;
		} else if (autoRefreshThreadInfoFirstTime === true && !global.db.receivedTheFirstMessage[threadID]) {
			global.db.receivedTheFirstMessage[threadID] = true;
			await threadsData.refreshInfo(threadID);
		}

		if (typeof threadData.settings.hideNotiMessage == "object") hideNotiMessage = threadData.settings.hideNotiMessage;

		const prefix = getPrefix(threadID);
		const role = getRole(threadData, senderID);
		const langCode = threadData.data.lang || config.language || "en";

		const parameters = {
			api, usersData, threadsData, message, event,
			userModel, threadModel, prefix, dashBoardModel,
			globalModel, dashBoardData, globalData, envCommands,
			envEvents, envGlobal, role,
			removeCommandNameFromBody: (b, p, c) => b.replace(new RegExp(`^${p}(\\s+|)${c}`, "i"), "").trim()
		};

		function createMessageSyntaxError(commandName) {
			message.SyntaxError = async function () {
				return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "commandSyntaxError", prefix, commandName));
			};
		}

		let isUserCallCommand = false;

		async function onStart() {
			// Mentions/UID Overrides
			const currentMentions = event.mentions || {};
			event.mentions = {}; 

			if (event.messageReply && event.messageReply.senderID) {
				event.mentions[event.messageReply.senderID] = "";
			} else if (body && body.includes("@")) {
				const info = await api.getThreadInfo(threadID);
				const bodyLower = body.toLowerCase();
				const nicknames = info.nicknames || {};
				const participants = info.userInfo || [];

				participants.forEach(user => {
					const uid = user.id;
					const realName = (user.name || "").toLowerCase();
					const nickName = (nicknames[uid] || "").toLowerCase();
					if ((nickName && bodyLower.includes("@" + nickName)) || 
						(realName && bodyLower.includes("@" + realName))) {
						event.mentions[uid] = user.name;
					}
				});
			} else {
				event.mentions = currentMentions;
			}

			if (!body || !body.startsWith(prefix)) return;
			const dateNow = Date.now();
			const args = body.slice(prefix.length).trim().split(/ +/);
			let commandName = args.shift().toLowerCase();
			let command = GoatBot.commands.get(commandName) || GoatBot.commands.get(GoatBot.aliases.get(commandName));
			
			const aliasesData = threadData.data.aliases || {};
			for (const cmdName in aliasesData) {
				if (aliasesData[cmdName].includes(commandName)) {
					command = GoatBot.commands.get(cmdName);
					break;
				}
			}

			if (command) commandName = command.config.name;
			if (isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, langCode)) return;

			if (!command) {
				if (!hideNotiMessage.commandNotFound) {
					return await message.reply(commandName ? utils.getText({ lang: langCode, head: "handlerEvents" }, "commandNotFound", commandName, prefix) : utils.getText({ lang: langCode, head: "handlerEvents" }, "commandNotFound2", prefix));
				}
				return true;
			}

			const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
			if (roleConfig.onStart > role) {
				if (!hideNotiMessage.needRoleToUseCmd) {
					let msgType;
					switch (roleConfig.onStart) {
						case 5: msgType = "onlyNsfw"; break;
						case 4: msgType = "onlyVip"; break;
						case 3: msgType = "onlyDev"; break;
						case 2: msgType = "onlyAdminBot2"; break;
						case 1: msgType = "onlyAdmin"; break;
						default: msgType = "onlyAdmin";
					}
					return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, msgType, commandName));
				}
				return true;
			}

			if (!client.countDown[commandName]) client.countDown[commandName] = {};
			const timestamps = client.countDown[commandName];
			const cooldown = (command.config.countDown || 1) * 1000;
			if (timestamps[senderID] && dateNow < timestamps[senderID] + cooldown) {
				return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "waitingForCommand", ((timestamps[senderID] + cooldown - dateNow) / 1000).toString().slice(0, 3)));
			}

			const time = getTime("DD/MM/YYYY HH:mm:ss");
			isUserCallCommand = true;
			try {
				(async () => {
					const analytics = await globalData.get("analytics", "data", {});
					analytics[commandName] = (analytics[commandName] || 0) + 1;
					await globalData.set("analytics", analytics, "data");
				})();

				createMessageSyntaxError(commandName);
				const getText2 = createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command);
				await command.onStart({
					...parameters,
					args,
					commandName,
					getLang: getText2,
					removeCommandNameFromBody: (b, p, c) => b.replace(new RegExp(`^${p}(\\s+|)${c}`, "i"), "").trim()
				});
				timestamps[senderID] = dateNow;
				log.info("CALL COMMAND", `${commandName} | ${userData.name} | ${senderID} | ${threadID}`);
			} catch (err) {
				log.err("CALL COMMAND", err);
				return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred", time, commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
			}
		}

		async function onChat() {
			const allOnChat = GoatBot.onChat || [];
			const args = body ? body.split(/ +/) : [];
			for (const key of allOnChat) {
				const command = GoatBot.commands.get(key);
				if (!command || getRoleConfig(utils, command, isGroup, threadData, command.config.name).onChat > role) continue;
				try { await command.onChat({ ...parameters, isUserCallCommand, args, commandName: command.config.name, getLang: createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command) }); } catch (err) {}
			}
		}

		async function onReply() {
			if (!event.messageReply) return;
			const Reply = GoatBot.onReply.get(event.messageReply.messageID);
			if (!Reply) return;
			const command = GoatBot.commands.get(Reply.commandName);
			if (!command || getRoleConfig(utils, command, isGroup, threadData, Reply.commandName).onReply > role) return;
			try { await command.onReply({ ...parameters, Reply, args: body ? body.split(/ +/) : [], commandName: Reply.commandName, getLang: createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command) }); } catch (err) {}
		}

		async function onReaction() {
			const Reaction = GoatBot.onReaction.get(messageID);
			if (event.reaction == "🍅") return message.unsend(event.messageID);
			if (!Reaction) return;
			const command = GoatBot.commands.get(Reaction.commandName);
			if (!command || getRoleConfig(utils, command, isGroup, threadData, Reaction.commandName).onReaction > role) return;
			try { await command.onReaction({ ...parameters, Reaction, args: [], commandName: Reaction.commandName, getLang: createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command) }); } catch (err) {}
		}

		async function onAnyEvent() {
			const allEvent = GoatBot.onAnyEvent || [];
			for (const key of allEvent) {
				const command = GoatBot.commands.get(key);
				if (command) {
					try { await command.onAnyEvent({ ...parameters, args: [], commandName: command.config.name, getLang: createGetText2(langCode, `${process.cwd()}/languages/events/${langCode}.js`, prefix, command) }); } catch (err) {}
				}
			}
		}

		async function handlerEvent() {
			for (const [key, getEvent] of GoatBot.eventCommands.entries()) {
				try { await getEvent.onStart({ ...parameters, commandName: getEvent.config.name, getLang: createGetText2(langCode, `${process.cwd()}/languages/events/${langCode}.js`, prefix, getEvent) }); } catch (err) {}
			}
		}

		async function onEvent() {
			const allOnEvent = GoatBot.onEvent || [];
			for (const key of allOnEvent) {
				const command = GoatBot.commands.get(key);
				if (command) {
					try { await command.onEvent({ ...parameters, args: [], commandName: command.config.name, getLang: createGetText2(langCode, `${process.cwd()}/languages/events/${langCode}.js`, prefix, command) }); } catch (err) {}
				}
			}
		}

		const emptyFunc = async () => {};
		return { onAnyEvent, onFirstChat: emptyFunc, onChat, onStart, onReaction, onReply, onEvent, handlerEvent, presence: emptyFunc, read_receipt: emptyFunc, typ: emptyFunc };
	};
};
