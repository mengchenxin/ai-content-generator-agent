// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); // 允许解析 JSON 请求体

// 健康检查接口
app.get('/api/ping', (req, res) => {
    res.json({ message: 'AI Generator API is running!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器启动: http://localhost:${PORT}`);
});

// server.js (追加在前面代码的下方)
const { OpenAI } = require('openai');
const { extractTextFromUrl } = require('./utils/webReader');

// 初始化大模型客户端 (记得在 .env 文件里配置 API Key)
const aiClient = new OpenAI({
    baseURL: 'https://api.deepseek.com', // 假设你用 DeepSeek，便宜又好用
    apiKey: process.env.DEEPSEEK_API_KEY 
});

// 核心转换接口
app.post('/api/generate-script', async (req, res) => {
    const { targetUrl, style } = req.body;

    if (!targetUrl) {
        return res.status(400).json({ error: '必须提供目标网页链接' });
    }

    try {
        // 1. 读取网页
        console.log(`正在读取网页: ${targetUrl}`);
        const sourceText = await extractTextFromUrl(targetUrl);

        // 2. 组装 Prompt (提示词工程)
        const systemPrompt = `你是一个资深的新媒体运营爆款制造机。
        请根据用户提供的网页文本，生成一篇符合【${style || '小红书'}】调性的种草文案。
        要求：带Emoji，分段清晰，突出核心痛点和卖点。`;

        // 3. 呼叫大模型
        console.log('正在呼叫 AI 大模型...');
        const completion = await aiClient.chat.completions.create({
            model: "deepseek-chat",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `这是提取到的网页内容：\n\n${sourceText}` }
            ],
            temperature: 0.7, // 让 AI 稍微发挥点创意
        });

        // 4. 返回结果给前端
        const generatedContent = completion.choices[0].message.content;
        res.json({
            status: 'success',
            data: {
                originalLength: sourceText.length,
                script: generatedContent
            }
        });

    } catch (error) {
        console.error("生成失败:", error);
        res.status(500).json({ error: 'AI 生成过程中发生错误' });
    }
});