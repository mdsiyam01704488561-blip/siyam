const axios = require("axios");
const fs = require('fs');
const path = require('path');

const baseApiUrl = async () => {
    const base = await axios.get(`https://raw.githubusercontent.com/mahmudx7/HINATA/main/baseApiUrl.json`);
    return base.data.mahmud; 
};

/**
* @author MahMUD
* @author: do not delete it
*/

module.exports = {
    config: {
        name: "videos",
        version: "1.7",
        author: "MahMUD",
        countDown: 5,
        category: "media",
        guide: { en: "{pn} <name or link>" }
    },

    onStart: async ({ api, args, event, commandName }) => {
        const obfuscatedAuthor = String.fromCharCode(77, 97, 104, 77, 85, 68); 
        if (module.exports.config.author !== obfuscatedAuthor) {
        return api.sendMessage("You are not authorized to change the author name.", event.threadID, event.messageID);
      }
       
        const { threadID, messageID, senderID } = event;
        if (!args[0]) return api.sendMessage("• Please Provide a name or link.", threadID, messageID);
        try { api.setMessageReaction("🐤", messageID, () => {}, true); } catch (e) {}
        const apiUrl = await baseApiUrl();
        const keyWord = args.join(" ");
        
        try {
            const res = await axios.get(`${apiUrl}/api/video/search?songName=${encodeURIComponent(keyWord)}`);
            const result = res.data.slice(0, 6);
            if (!result.length) {
                try { api.setMessageReaction("🥹", messageID, () => {}, true); } catch (e) {}
                return api.sendMessage("No results found", threadID, messageID);
            }

            let msg = "𝐒𝐞𝐥𝐞𝐜𝐭 𝐚 𝐯𝐢𝐝𝐞𝐨:\n\n";
            const thumbnails = [];
            
            for (let i = 0; i < result.length; i++) {
                const info = result[i];
                msg += `${i + 1}. ${info.title}\nTime: ${info.time}\n\n`;
                const thumbPath = path.join(__dirname, `thumb_${senderID}_${i}.jpg`);
                const thumbRes = await axios.get(info.thumbnail, { responseType: "arraybuffer" });
                fs.writeFileSync(thumbPath, Buffer.from(thumbRes.data));
                thumbnails.push(fs.createReadStream(thumbPath));
                setTimeout(() => { if(fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); }, 10000);
            }

            api.sendMessage({ 
                body: msg + "• Reply with the number to download", 
                attachment: thumbnails 
            }, threadID, (err, info) => {
                global.GoatBot.onReply.set(info.messageID, { 
                    commandName, 
                    author: senderID, 
                    result, 
                    apiUrl 
                });
            }, messageID);

        } catch (e) { 
            try { api.setMessageReaction("🥹", messageID, () => {}, true); } catch (err) {}
            return api.sendMessage("Error searching.", threadID, messageID); 
        }
    },

    onReply: async ({ event, api, Reply }) => {
        const { result, apiUrl, author } = Reply;
        if (event.senderID !== author) return;
        
        const choice = parseInt(event.body);
        if (isNaN(choice) || choice <= 0 || choice > result.length) return;
        api.unsendMessage(Reply.messageID);
        try { api.setMessageReaction("🐤", event.messageID, () => {}, true); } catch (e) {}
        const videoID = result[choice - 1].id;
        const filePath = path.join(__dirname, `video_${event.senderID}.mp4`);

        try {
            const res = await axios.get(`${apiUrl}/api/video/download?link=${videoID}&format=mp4`);
            const { title, downloadLink, quality } = res.data;
            const videoBuffer = (await axios.get(downloadLink, { responseType: "arraybuffer" })).data;
            fs.writeFileSync(filePath, Buffer.from(videoBuffer));
            await api.sendMessage({
                body: `✅ 𝙃𝙚𝙧𝙚'𝙨 𝙮𝙤𝙪𝙧 𝙫𝙞𝙙𝙚𝙤 𝙗𝙖𝙗𝙮\n\n🐤 Title: ${title}`,
                attachment: fs.createReadStream(filePath)
            }, event.threadID, (err) => {
                if (!err) {
                    try { api.setMessageReaction("🪽", event.messageID, () => {}, true); } catch (e) {}
                }
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }, event.messageID);

        } catch (e) { 
            try { api.setMessageReaction("🥹", event.messageID, () => {}, true); } catch (err) {}
            api.sendMessage("• Download failed, try Again later.", event.threadID, event.messageID); 
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    }
};
