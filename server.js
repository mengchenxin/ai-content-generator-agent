// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { extractTextFromUrl } = require('./utils/webReader');
const { validatePost } = require('./utils/postParser');
const { initDB, addScript, getHistory } = require('./db');

const app = express();

// 结构校验没过时最多重写 1 次。再多容易陷入"越改越差"，
// 而且每次都推一遍流、多花一次 token，不如降级存下来。
const MAX_REWRITE = 1;

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

// 🎯 核心武器库定义：告诉大模型你拥有哪些"超能力"
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

// 一次流式生成：正文边收边推给前端，最后把完整文本返回给调用方做校验
async function streamToClient(res, messages) {
    let fullText = '';
    const stream = await withRetry(() => aiClient.chat.completions.create({
        model: "deepseek-chat",
        messages,
        stream: true
    }));

    for await (const chunk of stream) {
        const piece = chunk.choices[0]?.delta?.content || '';
        if (piece) {
            fullText += piece;
            res.write(`data: ${JSON.stringify({ text: piece })}\n\n`);
        }
    }
    return fullText;
}

// 🚀 自主决策 Agent 流式交互接口
app.post('/api/generate-stream', async (req, res) => {
    const { targetUrl, style } = req.body;

    // 设置 SSE 流式响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        console.log('\n[Agent大脑] 收到用户指令，正在激活思考流...');

        const systemPrompt = `你是一个拥有自主决策能力的新媒体运营编导 Agent。
        你擅长分析用户意图，并在必要时调用工具获取外部知识。
        最终输出的内容必须符合【${style || '小红书'}】的爆款种草调性：带大量Emoji、黄金前三秒吸睛、干货列表清晰、文末有互动引导。
        输出结构要求：第一行是标题（不超过30字），紧接着一段开头钩子，然后三条以上编号的干货列表（每条用 1. 2. 3. 这种阿拉伯数字加英文句点开头），最后一句是引导互动的问题。`;

        const messageHistory = [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: `请帮我处理这个任务。用户输入的线索或链接是: "${targetUrl || '无'}". 风格要求: ${style}`
            }
        ];

        // 1. Thought：第一轮先问模型要不要调工具
        console.log('[Agent思考] 正在评估是否需要使用工具箱...');
        const firstResponse = await withRetry(() => aiClient.chat.completions.create({
            model: "deepseek-chat",
            messages: messageHistory,
            tools: agentTools,
            tool_choice: "auto"
        }));

        const assistantMessage = firstResponse.choices[0].message;
        messageHistory.push(assistantMessage);

        // 2. Action & Observation：模型决定调用就真去抓
        let fetchMeta = null;
        if (assistantMessage.tool_calls?.length) {
            console.log('[Agent决策] 💡 发现网页链接，大脑决定主动触发工具。');

            for (const toolCall of assistantMessage.tool_calls) {
                if (toolCall.function.name !== "fetch_web_content") continue;

                const toolArgs = JSON.parse(toolCall.function.arguments);
                console.log(`[Agent行动] 🎬 执行工具，URL: ${toolArgs.url}`);

                const result = await extractTextFromUrl(toolArgs.url);
                fetchMeta = result;

                messageHistory.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: "fetch_web_content",
                    content: result.text
                });
                console.log(`[Agent观察] 🔍 抓到 ${result.text.length} 字${result.truncated ? '（原文更长，已截断）' : ''}，塞回记忆区。`);
            }
        } else {
            console.log('[Agent决策] 📋 无需触网，直接基于已有知识回答。');
        }

        // 3. Final Answer：流式生成 + 结构校验，不合格让模型重写
        let attempt = 1;
        let finalText = '';
        let post = null;
        let validated = false;

        while (true) {
            finalText = await streamToClient(res, messageHistory);
            const check = validatePost(finalText);

            if (check.ok) {
                post = check.data;
                validated = true;
                break;
            }

            // 校验没过也先留下解析结果：万一下一轮还失败，至少能存降级内容
            post = check.data;

            if (attempt > MAX_REWRITE) {
                console.warn('[结构校验] 重写次数用尽，降级保存：', check.issues.join(' / '));
                break;
            }

            console.log(`[结构校验] 第 ${attempt} 版不合格：${check.issues.join(' / ')}，让模型重写`);
            // 告诉前端清空重来，否则两版内容会叠在一起
            res.write(`data: ${JSON.stringify({ reset: true, issues: check.issues })}\n\n`);

            messageHistory.push({ role: "assistant", content: finalText });
            messageHistory.push({
                role: "user",
                content: `这一版不符合要求：${check.issues.join('；')}。请严格按结构重写，不要解释，不要加前言。`
            });
            attempt++;
        }

        // 4. 结构化结果一并推给前端，前端可以直接拿去渲染卡片
        res.write(`data: ${JSON.stringify({ post, validated, rewrites: attempt - 1 })}\n\n`);

        // 5. 落库：结构化字段和抓取元信息一起存，方便回看当时怎么跑的
        await addScript(targetUrl || '自主知识库问答', style, finalText, {
            post,
            validated,
            rewrites: attempt - 1,
            sourceChars: fetchMeta ? fetchMeta.text.length : 0,
            fetchCostMs: fetchMeta ? fetchMeta.totalCost : null
        });

        res.write('data: [DONE]\n\n');
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
