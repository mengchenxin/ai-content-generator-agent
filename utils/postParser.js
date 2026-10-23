// utils/postParser.js
// 为什么不"再调一次模型做抽取"：流式生成已经拿到了完整正文，用户也已经在看了。
// 再调一次既多花钱又多等一轮。这里的做法是从正文里直接解析出结构，
// 用 schema 校验结构完整性；不达标就把问题清单丢回给模型，让它重写一版。
const { z } = require('zod');

// 除了 "1." / "-" / "•"，也要认 1️⃣ 这种 emoji 数字 —— 模型很爱用这个当列表
const LIST_ITEM = /^(\d+[.、)]|[-*•]|[1-9]\uFE0F?\u20E3)\s*/;
const HEADING = /^#{1,6}\s+/;

// 小红书文案的结构骨架，四个字段缺一个都不算成品
const PostSchema = z.object({
    title: z.string().min(4, '标题至少 4 个字').max(30, '标题不要超过 30 字'),
    hook: z.string().min(8, '开头钩子至少 8 个字'),
    points: z.array(z.string().min(4, '每条干货至少 4 个字')).min(3, '干货列表少于 3 条'),
    cta: z.string().min(4, '缺少结尾互动引导')
});

function stripMarkdown(line) {
    return String(line || '')
        .replace(HEADING, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/[*_`>]/g, '')
        .trim();
}

function parsePost(markdown) {
    const lines = String(markdown || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return { title: '', hook: '', points: [], cta: '' };
    }

    // 标题：优先取 markdown 标题行，没有就拿第一行
    const titleLine = lines.find(line => HEADING.test(line)) || lines[0];
    const title = stripMarkdown(titleLine);

    // 干货列表：1. / 1、/ - / • 开头的行
    const points = lines
        .filter(line => LIST_ITEM.test(line))
        .map(line => stripMarkdown(line.replace(LIST_ITEM, '')))
        .filter(Boolean)
        .slice(0, 6);

    // 结尾引导：从后往前找第一个带问号的短句（去掉 ** 之类的行内标记）
    const cta = stripMarkdown(
        [...lines].reverse().find(line => /[？?]/.test(line) && line.length <= 60) || ''
    );

    // 钩子：标题之后、列表之前的第一段正文
    const titleIndex = lines.indexOf(titleLine);
    const firstListIndex = lines.findIndex(line => LIST_ITEM.test(line));
    const end = firstListIndex > titleIndex ? firstListIndex : lines.length;
    const hook = stripMarkdown(
        lines.slice(titleIndex + 1, end).find(line => !HEADING.test(line)) || ''
    );

    return { title, hook, points, cta };
}

function validatePost(markdown) {
    const parsed = parsePost(markdown);
    const checked = PostSchema.safeParse(parsed);

    if (checked.success) {
        return { ok: true, data: checked.data, issues: [] };
    }

    return {
        ok: false,
        // 校验没过也把解析结果返回，让它作为降级内容存下来，别让整次请求白跑
        data: parsed,
        issues: checked.error.issues.map(issue => `${issue.path.join('.') || 'root'}：${issue.message}`)
    };
}

module.exports = { PostSchema, parsePost, validatePost };
