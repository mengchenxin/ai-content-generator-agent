// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { extractTextFromUrl } = require('./utils/webReader');
const { initDB, addScript, getHistory } = require('./db');

const app = express();

// 🛠️ 核心高可用机制：API 调用重试包装器
async function withRetry(apiCallFunc, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCallFunc(); // 尝试执行
        } catch (error) {
            console.error(`[容错机制] 第 ${i + 1} 次请求大模型失败:`, error.message);
            if (i === maxRetries - 1) throw error; // 最后一次还失败，就真的抛出异常
            
            // 指数退避策略：失败后等待 1s, 2s, 4s 再重试 (面试绝对的高级加分项！)
            const waitTime = Math.pow(2, i) * 1000;
            console.log(`[容错机制] 准备在 ${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

app.use(cors());
app.use(express.json());

// 初始化大模型客户端
const aiClient = new OpenAI({
    baseURL: 'https://api.deepseek.com', 
    apiKey: process.env.DEEPSEEK_API_KEY 
});

// 流式生成接口 (带本地 JSON 数据库保存)
app.post('/api/generate-stream', async (req, res) => {
    const { targetUrl, style } = req.body;
    if (!targetUrl) return res.status(400).json({ error: '必须提供目标网页链接' });

    // 设置 SSE 流式响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        // 1. 用 Puppeteer 爬取网页
        console.log(`[Stream] 正在读取网页: ${targetUrl}`);
        const sourceText = await extractTextFromUrl(targetUrl);

        console.log('[Agent] 开始执行多段式意图组装...');
        
        // 🧱 亮点三：多段式 Prompt 模板设计
        // 1. 角色设定与底层逻辑 (System)
        const systemPrompt = `你是一个资深的新媒体运营与爆款编导智能体。你的任务是将枯燥的网页内容转化为高转化的【${style || '小红书'}】风格内容。
        严格遵守以下规则：
        1. 必须使用 JSON 格式或结构化的分段来思考。
        2. 拒绝输出任何未经证实的虚假数据。`;

        // 2. 注入 KOL 文案结构与分镜逻辑 (Few-Shot / Intent Control)
        const kolStructure = `
        【结构约束】：
        - 标题：必须包含痛点+解决方案，带 💡 或 🔥 等 Emoji，不超过 15 个字。
        - 黄金前三秒：用一个反问句抓住眼球。
        - 核心干货：用 1-2-3 列表提取网页中最有价值的信息。
        - 互动引导：结尾抛出一个问题引导评论。`;

        // 3. 用户输入 (User)
        const userPrompt = `这是提取到的网页内容，请严格按照上述结构进行提炼与转化：\n\n${sourceText}`;

        console.log('[Stream] 正在呼叫 AI 大模型 (流式模式)...');
        
        // 🧱 亮点四：应用指数退避重试机制包裹大模型调用
        const stream = await withRetry(async () => {
            return await aiClient.chat.completions.create({
                model: "deepseek-chat", 
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: kolStructure },      // 独立剥离的结构约束
                    { role: "assistant", content: "收到。我已经理解了结构约束，请提供原始网页内容。" }, // 预热引导
                    { role: "user", content: userPrompt }         // 真实的输入
                ],
                temperature: 0.7,
                stream: true, 
            });
        });

        let fullGeneratedText = "";

        for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || "";
            if (text) {
                fullGeneratedText += text; // 拼接完整文案
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
        }

        // 4. 生成完毕，异步存入本地 JSON 数据库
        if (fullGeneratedText) {
            await addScript(targetUrl, style, fullGeneratedText);
        }

        res.write(`data: [DONE]\n\n`);
        res.end();

    } catch (error) {
        console.error("生成失败:", error);
        res.write(`data: ${JSON.stringify({ error: 'AI 生成过程中发生错误' })}\n\n`);
        res.end();
    }
});

// 获取历史记录接口
app.get('/api/history', async (req, res) => {
    try {
        const records = await getHistory();
        res.json({ status: 'success', data: records });
    } catch (error) {
        res.status(500).json({ error: '获取历史记录失败' });
    }
});

const PORT = process.env.PORT || 3000;

// 确保 JSON 数据库初始化完成后再开服
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 服务器完全体启动成功: http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('系统初始化失败', err);
});