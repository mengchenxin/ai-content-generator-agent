// utils/browser.js
// Chromium 冷启动要 1~2 秒。原来每个请求都 launch 一次、用完再 close，
// 等于把这段时间重复付一遍。这里维护一个全局单例，请求之间共享浏览器进程，
// 只在页面级别隔离（每请求一个 page，用完就关）。
const puppeteer = require('puppeteer');

let browserPromise = null;

async function getBrowser() {
    if (!browserPromise) {
        const launchOptions = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        };

        // 本机已经装了 Chrome 就不必再让 puppeteer 下一份；
        // 云上没有这个变量就走 puppeteer 自带的 Chromium。
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }

        browserPromise = puppeteer.launch(launchOptions).then(browser => {
            // 浏览器进程万一崩了，把单例清掉，下次请求重新拉起
            browser.on('disconnected', () => {
                console.warn('[Browser] 实例已断开，下次请求将重新启动');
                browserPromise = null;
            });
            return browser;
        }).catch(err => {
            browserPromise = null;   // 启动失败也要清掉，避免一直拿到 rejected promise
            throw err;
        });
    }
    return browserPromise;
}

async function closeBrowser() {
    if (!browserPromise) return;
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close();
}

// 云平台部署时会给 SIGTERM，把子进程关干净，不然会留僵尸 Chromium
['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, async () => {
        await closeBrowser();
        process.exit(0);
    });
});

module.exports = { getBrowser, closeBrowser };
