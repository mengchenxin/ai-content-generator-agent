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

// server.js 新增流式接口
app.post('/api/generate-stream', async (req, res) => {
    const { targetUrl, style } = req.body;

    if (!targetUrl) {
        return res.status(400).json({ error: '必须提供目标网页链接' });
    }

    // 1. 设置 SSE 必备的响应头！这是流式通信的灵魂
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        console.log(`[Stream] 正在读取网页: ${targetUrl}`);
        const sourceText = await extractTextFromUrl(targetUrl);

        const systemPrompt = `你是一个资深的新媒体运营爆款制造机。
        请根据用户提供的网页文本，生成一篇符合【${style || '小红书'}】调性的种草文案。
        要求：带Emoji，分段清晰，突出核心痛点和卖点。`;

        console.log('[Stream] 正在呼叫 AI 大模型 (流式模式)...');
        
        // 2. 发起请求，注意开启 stream: true 参数
        const stream = await aiClient.chat.completions.create({
            model: "deepseek-chat", // 替换为你实际用的模型名
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `这是提取到的网页内容：\n\n${sourceText}` }
            ],
            temperature: 0.7,
            stream: true, // 关键配置：开启流式输出
        });

        // 3. 监听数据流，并将每一个字通过 SSE 格式发给前端
        for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || "";
            if (text) {
                // 必须按照 SSE 规范格式化：以 "data: " 开头，以 "\n\n" 结尾
                // 将内容转为 JSON 字符串可以安全地处理换行符等特殊字符
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
        }

        // 4. 全部发送完毕，通知前端关闭连接
        res.write(`data: [DONE]\n\n`);
        res.end();

    } catch (error) {
        console.error("[Stream] 生成失败:", error);
        // 如果在流式过程中报错，也以 SSE 格式告诉前端
        res.write(`data: ${JSON.stringify({ error: 'AI 生成过程中发生错误' })}\n\n`);
        res.end();
    }
});

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