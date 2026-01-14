# Amazon MCP Server

This is a Model Context Protocol (MCP) server for scraping Amazon products and searching for products on Amazon.

## Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/r123singh/amazon-mcp-server.git
   ```
2. **Navigate to the project directory:**
   ```bash
   cd amazon-mcp-server
   ```
3. **Create a virtual environment:**
   ```bash
   uv venv
   ```
4. **Activate the virtual environment:**
   - On Linux/macOS:
     ```bash
     source venv/bin/activate
     ```
   - On Windows:
     ```bash
     venv\Scripts\activate
     ```
5. **Install dependencies:**
   ```bash
   uv pip install -r requirements.txt
   ```

6. **No API keys or tokens are required.**

7. **Configure MCP JSON:**
   Create a `mcp.json` file with:
   ```json
   {
     "mcpServers": {
       "amazon": {
         "command": "{PATH_TO_DIRECTORY}\\amazon-mcp-server\\venv\\Scripts\\python.exe",
         "args": [
           "{PATH_TO_DIRECTORY}\\amazon-mcp-server\\server.py"
         ]
       }
     }
   }
   ```
   Replace `{PATH_TO_DIRECTORY}` with the absolute path to this directory (use `pwd` or `cd` to get the path).

## Available Tools

The server provides the following tools for interacting with Amazon:

- **Scrape a product:**  
  `scrape_product(product_url)`  
  Scrape product details (name, price, image, rating, reviews, availability, description) from a given Amazon product URL.

- **Search for products:**  
  `search_products(query, max_results)`  
  Search for products on Amazon by keyword and return a list of results.

## Usage

Once configured, the MCP server can be started using the standard MCP client configuration. The server provides a natural language interface to interact with Amazon through the available tools.

**Example usage:**
- "Get details for this Amazon product: [product URL]"
- "Search Amazon for 'wireless headphones', show top 3 results"

## Notes

- No API key or authentication is required.
- The server scrapes publicly available Amazon product and search pages.
- For best results, use valid Amazon product URLs and clear search queries.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the LICENSE file for details.



