// scripts/test-parser.js
// 结构解析的单元测试：不调模型、不花 token，只验证
// markdown 正文 → 结构化字段 → schema 校验 这条链路对不对。
// 跑法：npm test
const { validatePost } = require('../utils/postParser');

const cases = [
    {
        name: '标准小红书结构（应该通过）',
        input: `# 关晓彤小跑接爸爸，这段真的看得我想哭

家人们谁懂啊，刷到这段直接破防了

1. 她说"爸爸你别跑"的时候语气特别自然
2. 镜头给到手部特写，细节拉满
3. 后面的采访里她自己也笑场了

你看完有没有想起自己爸妈？`,
        expectOk: true
    },
    {
        name: '没有干货列表（应该不通过）',
        input: `# 一篇没有列表的文案

这是一段钩子文字，长度应该是够的

只有一句话收尾，中间没有编号列表

你看完有什么想法吗？`,
        expectOk: false
    },
    {
        name: '标题只有一个字（应该不通过）',
        input: `# 啊

这是一段钩子文字，长度应该够了吧

1. 第一条干货内容
2. 第二条干货内容
3. 第三条干货内容

你觉得呢？`,
        expectOk: false
    },
    {
        name: '用 - 做列表 + 没有问号结尾（应该不通过）',
        input: `# 这是一个正常的标题

开头钩子写得足够长了

- 第一条干货
- 第二条干货
- 第三条干货

以上就是全部内容。`,
        expectOk: false
    }
];

let passed = 0;

for (const item of cases) {
    const result = validatePost(item.input);
    const ok = result.ok === item.expectOk;
    if (ok) passed++;

    console.log(`${ok ? 'PASS' : 'FAIL'}  ${item.name}`);
    console.log(`      校验结果=${result.ok}  标题="${result.data.title}"  干货=${result.data.points.length}条  cta="${result.data.cta}"`);
    if (result.issues.length) {
        console.log(`      问题：${result.issues.join(' / ')}`);
    }
}

console.log(`\n${passed}/${cases.length} 通过`);
process.exit(passed === cases.length ? 0 : 1);
