// db.js
const fs = require('fs').promises;
const path = require('path');

// 我们的数据库就是一个本地的 JSON 文件
const DB_FILE = path.join(__dirname, 'database.json');

// 初始化数据库
async function initDB() {
    try {
        // 尝试访问文件，看是否存在
        await fs.access(DB_FILE);
        console.log('[DB] JSON 数据库已连接！');
    } catch (error) {
        // 如果文件不存在，就创建一个初始的空结构
        const initialData = { scripts: [] };
        await fs.writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
        console.log('[DB] JSON 数据库文件初始化成功！');
    }
}

// 写入新数据的方法
async function addScript(targetUrl, style, content) {
    try {
        const rawData = await fs.readFile(DB_FILE, 'utf-8');
        const db = JSON.parse(rawData);
        
        // 组装一条新记录
        const newRecord = {
            id: Date.now(), // 用时间戳做简单的唯一ID
            targetUrl,
            style,
            content,
            createdAt: new Date().toISOString()
        };

        db.scripts.push(newRecord);
        // 写回文件
        await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
        console.log('[DB] 一条新的 AI 爆款文案已成功落库！');
    } catch (error) {
        console.error('[DB] 写入数据失败:', error);
    }
}

// 获取历史记录的方法
async function getHistory() {
    try {
        const rawData = await fs.readFile(DB_FILE, 'utf-8');
        const db = JSON.parse(rawData);
        // 翻转数组（最新的在前面），并截取前 10 条
        return db.scripts.reverse().slice(0, 10);
    } catch (error) {
        console.error('[DB] 读取数据失败:', error);
        return [];
    }
}

module.exports = { initDB, addScript, getHistory };