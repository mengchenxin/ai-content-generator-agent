// utils/webReader.js
// 这是一个极简版的 Web Reader，实际项目中你可以用 puppeteer 或者 cheerio 抓得更准
async function extractTextFromUrl(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();
        
        // 粗暴地去掉 HTML 标签，只保留文本 (面试时可以说这里后续会做深度清洗)
        const pureText = html.replace(/<[^>]*>?/gm, ''); 
        
        // 截取前 3000 个字符，防止 Token 超出大模型限制
        return pureText.substring(0, 3000); 
    } catch (error) {
        console.error("抓取网页失败:", error);
        throw new Error("无法读取该网页内容");
    }
}

module.exports = { extractTextFromUrl };