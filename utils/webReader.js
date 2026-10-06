// utils/webReader.js
const puppeteer = require('puppeteer');

async function extractTextFromUrl(url) {
    let browser;
    try {
        console.log(`[Puppeteer] 正在启动无头浏览器抓取: ${url}`);
        // 启动浏览器
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        
        // 伪装成真实用户，防止被一些网站直接拒绝
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 设置页面视口
        await page.setViewport({ width: 1080, height: 1024 });

        // 访问目标网址，等待网络空闲（说明动态渲染基本完成）
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // 在浏览器上下文中执行代码，提取纯文本
        const pureText = await page.evaluate(() => {
            // 移除脚本和样式标签，避免抓取到代码
            const scripts = document.querySelectorAll('script, style, noscript, iframe');
            scripts.forEach(s => s.remove());
            
            // 提取纯文本并去掉多余的空行
            return document.body.innerText.replace(/\n\s*\n/g, '\n').trim();
        });

        // 截取前 4000 个字符，防止超长报错
        const finalContent = pureText.substring(0, 4000);
        console.log(`[Puppeteer] 抓取成功，共提取 ${finalContent.length} 个字符。`);
        
        return finalContent;

    } catch (error) {
        console.error("[Puppeteer] 抓取网页失败:", error);
        throw new Error("无头浏览器读取失败，可能是目标网站做了严格的防护或加载超时。");
    } finally {
        if (browser) {
            await browser.close(); // 养成好习惯，无论成败都要关闭浏览器释放内存
        }
    }
}

module.exports = { extractTextFromUrl };
