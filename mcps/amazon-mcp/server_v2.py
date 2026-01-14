# This is amazon products scraper mcp server
# Build a scraper that can scrape amazon products
# The scraper should be able to scrape the product name, price, and image
import httpx
from mcp.server.fastmcp import FastMCP
import re
import json
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from utils import clean_amazon_url


def extract_all_product_images(html_content: str) -> list[str]:
    """
    Extract all product images (main + variants) from Amazon product page
    """
    image_urls = set()

    # Find the ImageBlockATF JSON
    match = re.search(
        r'"colorImages"\s*:\s*({.*?})\s*,\s*"colorToAsin"',
        html_content,
        re.DOTALL
    )

    if not match:
        return []

    try:
        color_images = json.loads(match.group(1))
        images = color_images.get("initial", [])

        for img in images:
            if img.get("hiRes"):
                image_urls.add(img["hiRes"])
            elif img.get("large"):
                image_urls.add(img["large"])

    except Exception:
        pass

    return list(image_urls)

# Create a Trello MCP server
mcp = FastMCP(
    "Amazon Scraper", 
    instructions="""
    # Amazon Scraper Server
    
    This server provides access to Amazon products through various tools.
    For search products, identify the keywords and number of results you want to get from the user input
    
    ## Available Tools
    - `scrape_product(product_url)` - Scrape a product from Amazon
    - `search_products(query, max_results)` - Search for products on Amazon
    
    ## When to use what
    - For getting product details: Use `scrape_product(product_url)`
    - For searching products: Use `search_products(query, max_results)`
    
    ## Notes
    - No API key required
        """
)

# Constants
# BASE_URL = "https://api.trello.com/1"
# API_KEY = os.getenv("TRELLO_API_KEY")
# API_TOKEN = os.getenv("TRELLO_API_TOKEN")
BASE_URL = "https://www.amazon.in"

# Helper functions
async def fetch_amazon_page(url: str) -> str:
    """Helper function to fetch Amazon product page"""
    # url = clean_amazon_url(url)
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, timeout=15.0)
        response.raise_for_status()
        return response.text

def clean_price(price_text: str) -> str:
    """Clean and extract price from text"""
    if not price_text:
        return "Price not available"
    
    # Remove extra whitespace and common price prefixes
    cleaned = re.sub(r'[^\d.,]', '', price_text.strip())
    if cleaned:
        return f"₹{cleaned}"
    return "Price not available"

def extract_product_data(html_content: str, url: str) -> dict:
    """Extract product information from Amazon page HTML"""
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Initialize product data
    product_data = {
        'name': 'Product name not found',
        'price': 'Price not available',
        'image_url': [],
        'rating': 'Rating not available',
        'reviews_count': 'Reviews not available',
        'availability': 'Availability not found',
        'description': 'Description not available',
        'url': url
    }
    
    try:
        # Extract product name
        name_selectors = [
            '#productTitle',
            'h1.a-size-large',
            '.a-size-large.product-title-word-break',
            'h1[data-automation-id="product-title"]'
        ]
        
        for selector in name_selectors:
            name_elem = soup.select_one(selector)
            if name_elem:
                product_data['name'] = name_elem.get_text().strip()
                break
        
        # Extract price
        price_selectors = [
            '.a-price-whole',
            '.a-price .a-offscreen',
            '.a-price-range .a-price-range-min .a-offscreen',
            '.a-price .a-price-symbol + span',
            '[data-a-color="price"] .a-offscreen'
        ]
        
        for selector in price_selectors:
            price_elem = soup.select_one(selector)
            if price_elem:
                product_data['price'] = clean_price(price_elem.get_text())
                break
        
        # Extract image URL
        image_selectors = [
            '#landingImage',
            '#imgBlkFront',
            '.a-dynamic-image',
            '[data-old-hires]'
        ]
        
        for selector in image_selectors:
            img_elem = soup.select_one(selector)
            if img_elem:
                img_url = img_elem.get('src') or img_elem.get('data-old-hires')
                if img_url:
                    if img_url.startswith('//'):
                        img_url = 'https:' + img_url
                    product_data['image_url'] = img_url
                    break
        
        # product_data["image_url"] = extract_all_product_images(html_content)
        
        # Extract rating
        rating_selectors = [
            '.a-icon-alt',
            '[data-hook="rating-out-of-text"]',
            '.a-icon-star-small .a-icon-alt'
        ]
        
        for selector in rating_selectors:
            rating_elem = soup.select_one(selector)
            if rating_elem:
                rating_text = rating_elem.get_text()
                rating_match = re.search(r'(\d+\.?\d*)', rating_text)
                if rating_match:
                    product_data['rating'] = f"{rating_match.group(1)} out of 5"
                    break
        
        # Extract reviews count
        reviews_selectors = [
            '#acrCustomerReviewText',
            '[data-hook="total-review-count"]',
            '.a-size-base.s-underline-text'
        ]
        
        for selector in reviews_selectors:
            reviews_elem = soup.select_one(selector)
            if reviews_elem:
                reviews_text = reviews_elem.get_text()
                reviews_match = re.search(r'(\d+(?:,\d+)*)', reviews_text)
                if reviews_match:
                    product_data['reviews_count'] = f"{reviews_match.group(1)} reviews"
                    break
        
        # Extract availability
        availability_selectors = [
            '#availability .a-size-medium',
            '#availability span',
            '.a-size-medium.a-color-success'
        ]
        
        for selector in availability_selectors:
            avail_elem = soup.select_one(selector)
            if avail_elem:
                product_data['availability'] = avail_elem.get_text().strip()
                break
        
        # Extract description
        desc_selectors = [
            '#productDescription p',
            '#feature-bullets .a-list-item',
            '.a-expander-content p'
        ]
        
        for selector in desc_selectors:
            desc_elem = soup.select_one(selector)
            if desc_elem:
                product_data['description'] = desc_elem.get_text().strip()
                break
                
    except Exception as e:
        product_data['error'] = f"Error parsing product data: {str(e)}"
    
    return product_data

# Helper functions for search results

def extract_search_results(html_content: str, max_results: int) -> list:
    """Extract product information from Amazon search results"""
    soup = BeautifulSoup(html_content, 'html.parser')
    products = []
    
    # Find product containers
    product_containers = soup.select('[data-component-type="s-search-result"]')
    
    for container in product_containers[:max_results]:
        try:
            product = {
                'name': 'Product name not found',
                'price': 'Price not available',
                'image_url': 'Image not found',
                'rating': 'Rating not available',
                'url': 'URL not found'
            }
            
            # Extract product name
            name_elem = container.select_one('a h2 span')
            if name_elem:
                product['name'] = name_elem.get_text().strip()
            
            # Extract product URL
            url_elem = container.select_one('a')
            if url_elem:
                product_url = url_elem.get('href')
                if product_url:
                    if product_url.startswith('/'):
                        product_url = 'https://www.amazon.in' + product_url
                    product['url'] = product_url
            
            # Extract price
            price_elem = container.select_one('.a-price-whole')
            if price_elem:
                product['price'] = clean_price(price_elem.get_text())
            
            # Extract image
            img_elem = container.select_one('img.s-image')
            if img_elem:
                img_url = img_elem.get('src')
                if img_url:
                    product['image_url'] = img_url
            
            # Extract rating
            rating_elem = container.select_one('.a-icon-alt')
            if rating_elem:
                rating_text = rating_elem.get_text()
                rating_match = re.search(r'(\d+\.?\d*)', rating_text)
                if rating_match:
                    product['rating'] = f"{rating_match.group(1)} out of 5"
            
            products.append(product)
            
        except Exception as e:
            print(f"Error extracting product data: {str(e)}")
    
    return products

# Formatting functions

def format_search_results(products: list, query: str) -> str:
    """Format search results for display"""
    if not products:
        return f"No products found for '{query}'"
    
    result = f"# Search Results for '{query}'\n\n"
    for i, product in enumerate(products):
        result += f"## {i+1}. {product['name']}\n"
        result += f"Price: {product['price']}\n"
        result += f"Rating: {product['rating']}\n"
        result += f"URL: {product['url']}\n\n"
    
    return result

def format_product_details(product: dict) -> str:
    result = f"# {product['name']}\n\n"
    result += f"Price: {product['price']}\n"
    result += f"Rating: {product['rating']}\n"
    result += f"Reviews: {product['reviews_count']}\n"
    result += f"Availability: {product['availability']}\n"
    result += f"Image URL: {product['image_url']}\n"
    result += f"Description: {product['description']}\n"
    result += f"Product URL: {product['url']}\n"
    return result


# Tools

@mcp.tool()
async def scrape_product(product_url: str) -> str:
    """Scrape product information from an Amazon product URL"""
    try:
        # Validate URL
        parsed_url = urlparse(product_url)
        if 'amazon' not in parsed_url.netloc.lower():
            return "Error: Please provide a valid Amazon product URL"
        
        # Fetch the page
        html_content = await fetch_amazon_page(product_url)
        
        # Extract product data
        product_data = extract_product_data(html_content, product_url)
        
        # Format the result
        return format_product_details(product_data)
        
    except httpx.HTTPStatusError as e:
        return f"HTTP Error: {e.response.status_code} - {e.response.reason_phrase}"
    except httpx.RequestError as e:
        return f"Request Error: {str(e)}"
    except Exception as e:
        return f"Error scraping product: {str(e)}"

@mcp.tool()
async def search_products(query: str, max_results: int = 5) -> str:
    """Search for products on Amazon and return results"""
    try:
        # Construct search URL
        search_url = f"https://www.amazon.in/s?k={query.replace(' ', '+')}"
        
        # Fetch search results page
        html_content = await fetch_amazon_page(search_url)
        
        # Extract search results
        products = extract_search_results(html_content, max_results)
        
        # Format the results
        return format_search_results(products, query)
        
    except Exception as e:
        return f"Error searching products: {str(e)}"


if __name__ == "__main__":
    print("Starting Amazon Products MCP server...")
    mcp.run(transport = "stdio")
 