import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(
            viewport={'width': 1200, 'height': 900},
            device_scale_factor=2 # For high-res image
        )
        # Get absolute path of hols.html
        file_path = os.path.abspath('hols.html')
        await page.goto(f'file://{file_path}')
        
        # Wait a bit for fonts to load and animations to start, though we want a clean screenshot
        await page.wait_for_timeout(500)
        
        # We can take a screenshot of the specific element to clip out the floating elements? 
        # Actually user wants the floating elements if they are part of the image. 
        # The prompt says: "also create an animated html version of the image suitable for kids... save the html as hols.html and the image as hols.png"
        # Let's just screenshot the body or the #screenshot-area. 
        # If we screenshot the whole page, we get the background.
        
        # Let's take full page screenshot but clip it 
        await page.screenshot(path='hols.png', full_page=True)
        await browser.close()

asyncio.run(main())
