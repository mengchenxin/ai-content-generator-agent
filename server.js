// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { extractTextFromUrl } = require('./utils/webReader');
const { initDB, addScript, getHistory } = require('./db');

const app = express();

// 🛠️ 高可用机制：API 调用重试包装器
async function withRetry(apiCallFunc, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCallFunc();
        } catch (error) {
            console.error(`[容错机制] 第 ${i + 1} 次请求大模型失败:`, error.message);
            if (i === maxRetries - 1) throw error;
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

// 🎯 核心武器库定义：告诉大模型你拥有哪些“超能力”
const agentTools = [
    {
        type: "function",
        function: {
            name: "fetch_web_content",
            description: "当用户提供了一个URL或者网页链接，并且你需要分析、提炼或转化该网页内容时，必须调用此工具。它能利用无头浏览器提取网页的纯文本内容。",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "需要爬取和解析的完整网页 URL 链接"
                    }
                },
                required: ["url"]
            }
        }
    }
];

// 🚀 自主决策 Agent 流式交互接口
app.post('/api/generate-stream', async (req, res) => {
    const { targetUrl, style } = req.body;

    // 设置 SSE 流式响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        console.log('\n[Agent大脑] 收到用户指令，正在激活思考流...');

        // 1. 初始化 Agent 的记忆上下文与 System Prompt 规则
        const systemPrompt = `你是一个拥有自主决策能力的新媒体运营编导 Agent。
        你擅长分析用户意图，并在必要时调用工具获取外部知识。
        最终输出的内容必须符合【${style || '小红书'}】的爆款种草调性：带大量Emoji、黄金前三秒吸睛、干货列表清晰、文末有互动引导。`;

        // 组装对话历史
        const messageHistory = [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: `请帮我处理这个任务。用户输入的线索或链接是: "${targetUrl || '无'}". 风格要求: ${style}`
            }
        ];

        // 2. Thought阶段：让大模型进行第一轮思考，决定是否调用工具
        console.log('[Agent思考] 正在评估是否需要使用工具箱...');
        const firstResponse = await aiClient.chat.completions.create({
            model: "deepseek-chat",
            messages: messageHistory,
            tools: agentTools, // 塞入工具箱
            tool_choice: "auto" // 让模型自主决定是否调用
        });

        const assistantMessage = firstResponse.choices[0].message;
        messageHistory.push(assistantMessage); // 记录大模型的思考过程

        // 3. Action & Observation 阶段：如果大模型决定调用工具
        if (assistantMessage.tool_calls) {
            console.log(`[Agent决策] 💡 发现网页链接！大脑决定主动触发工具。`);

            for (const toolCall of assistantMessage.tool_calls) {
                if (toolCall.function.name === "fetch_web_content") {
                    // 解析大模型自主生成的工具参数
                    const toolArgs = JSON.parse(toolCall.function.arguments);
                    console.log(`[Agent行动] 🎬 执行工具 [fetch_web_content]，参数 URL: ${toolArgs.url}`);

                    // 真正执行底层的 Puppeteer 爬虫
                    const webTextResult = await extractTextFromUrl(toolArgs.url);

                    // 将观察到的客观现实反馈给大模型大脑
                    messageHistory.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: "fetch_web_content",
                        content: webTextResult
                    });
                    console.log(`[Agent观察] 🔍 爬虫成功返回 ${webTextResult.length} 字的文本，已塞回大模型记忆区。`);
                }
            }
        } else {
            console.log('[Agent决策] 📋 用户未提供有效链接或无需触网，大脑决定直接基于已有知识库解答。');
        }

        // 4. Final Answer 阶段：大脑整合所有观察到的资料，发起流式最终创作
        console.log('[Agent输出] ✍️ 正在进行最终的爆款文案流式推流...');
        const stream = await withRetry(async () => {
            return await aiClient.chat.completions.create({
                model: "deepseek-chat",
                messages: messageHistory, // 此时历史记录里已经包含了工具返回的网页内容
                stream: true
            });
        });

        let fullGeneratedText = "";
        for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || "";
            if (text) {
                fullGeneratedText += text;
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
        }

        // 5. 将智能体最终辛勤劳动的成果异步存入本地 JSON 数据库
        if (fullGeneratedText) {
            await addScript(targetUrl || '自主知识库问答', style, fullGeneratedText);
        }

        res.write(`data: [DONE]\n\n`);
        res.end();

    } catch (error) {
        console.error("[Agent崩溃] 核心调度链路发生异常:", error);
        res.write(`data: ${JSON.stringify({ error: '智能体调度失败: ' + error.message })}\n\n`);
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

// Render health check
app.get('/healthz', (req, res) => {
    res.status(200).send('ok');
});

// Serve the single-page frontend from the same service.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;

// 确保数据库准备完毕再启动服务
initDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 AI Content Generator is listening on port ${PORT}`);
    });
}).catch(err => {
    console.error('系统初始化失败', err);
});
