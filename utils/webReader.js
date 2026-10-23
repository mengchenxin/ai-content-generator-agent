// utils/webReader.js
const { getBrowser } = require('./browser');

// 送进模型的正文上限，和控 token 成本有关，改这里就行
const MAX_CONTENT_LENGTH = 4000;

async function extractTextFromUrl(url) {
    const startedAt = Date.now();
    let page;

    try {
        const browser = await getBrowser();
        const browserReadyCost = Date.now() - startedAt;

        page = await browser.newPage();

        // 伪装成真实用户，防止被一些网站直接拒绝
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 设置页面视口
        await page.setViewport({ width: 1080, height: 1024 });

        // 访问目标网址，等待网络空闲（说明动态渲染基本完成）
        // 注意：这里别开 setRequestInterception 去拦图片/字体。
        // 实测拦掉之后 networkidle2 会提前判定"空闲"，此时 SPA 正文还没渲染，抓到 0 字。
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // 在浏览器上下文中执行代码，提取纯文本
        const pureText = await page.evaluate(() => {
            // 移除脚本和样式标签，避免抓取到代码
            const junk = document.querySelectorAll('script, style, noscript, iframe');
            junk.forEach(node => node.remove());

            // 提取纯文本并去掉多余的空行
            return document.body.innerText.replace(/\n\s*\n/g, '\n').trim();
        });

        const finalContent = pureText.substring(0, MAX_CONTENT_LENGTH);
        const totalCost = Date.now() - startedAt;
        console.log(
            `[Puppeteer] 抓取成功，${finalContent.length} 字 / 原文 ${pureText.length} 字，` +
            `总耗时 ${totalCost}ms（等浏览器实例 ${browserReadyCost}ms）`
        );

        return { text: finalContent, truncated: pureText.length > MAX_CONTENT_LENGTH, totalCost };

    } catch (error) {
        console.error('[Puppeteer] 抓取网页失败:', error.message);
        throw new Error('无头浏览器读取失败，可能是目标网站做了严格的防护或加载超时。');
    } finally {
        // 只关页面，不关浏览器 —— 浏览器留着给下一个请求用
        if (page) {
            try {
                await page.close();
            } catch (e) {
                console.warn('[Puppeteer] 关闭页面失败（通常不影响主流程）:', e.message);
            }
        }
    }
}

module.exports = { extractTextFromUrl, MAX_CONTENT_LENGTH };
