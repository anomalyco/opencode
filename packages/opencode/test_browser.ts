import { chromium } from "playwright"

async function testBrowser() {
  console.log("Launching Chromium...")

  try {
    const browser = await chromium.launch({
      headless: true,
    })

    console.log("Browser launched successfully")

    const page = await browser.newPage()
    console.log("Navigating to www.baidu.com...")

    await page.goto("https://www.baidu.com", { waitUntil: "domcontentloaded", timeout: 30000 })

    const title = await page.title()
    const url = page.url()

    console.log("Success!")
    console.log("URL:", url)
    console.log("Title:", title)

    await browser.close()
    console.log("Browser closed")
  } catch (error) {
    console.error("Error:", error)
    process.exit(1)
  }
}

testBrowser()
