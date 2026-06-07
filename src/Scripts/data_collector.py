#!/usr/bin/env python3
"""
Data Collector for Dukascopy Historical Data
Downloads 1-minute OHLC data for specified symbols.

Usage:
    python data_collector_SYMBOL.py --symbol XAUUSD --start 2023-01-01 --end 2024-12-31
"""

import argparse
import os
import sys
from datetime import datetime, timedelta
from typing import Optional
import pandas as pd
import requests
import time


class DukascopyDownloader:
    """Downloads historical forex/commodity data from Dukascopy."""
    
    BASE_URL = "https://datafeed.dukascopy.com/datafeed"
    
    SYMBOL_MAP = {
        "XAUUSD": "XAUUSD",
        "EURUSD": "EURUSD",
        "JPYUSD": "USDJPY",  # Note: JPYUSD convention
        "SP500": "US500cash",
    }
    
    def __init__(self, output_dir: str = "/srv/trading-data"):
        self.output_dir = output_dir
    
    def download(self, symbol: str, start_date: str, end_date: str) -> Optional[str]:
        """Download data for a symbol and date range."""
        if symbol not in self.SYMBOL_MAP:
            print(f"Error: Unknown symbol '{symbol}'. Available: {list(self.SYMBOL_MAP.keys())}")
            return None
        
        ds_symbol = self.SYMBOL_MAP[symbol]
        output_path = os.path.join(self.output_dir, symbol, "ohlc_1m.csv")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")
        
        all_data = []
        current = start
        
        while current <= end:
            year = current.year
            month = current.month - 1  # 0-indexed
            
            url = f"{self.BASE_URL}/{ds_symbol}/{year}/{month}/1/1m.bi5"
            
            try:
                response = requests.get(url, timeout=30)
                if response.status_code == 200:
                    # Parse bi5 format (compressed tick data)
                    # This is a simplified version - actual parsing requires lzma decompression
                    pass
                else:
                    print(f"Failed to fetch {url}: {response.status_code}")
            except Exception as e:
                print(f"Error downloading {url}: {e}")
            
            current += timedelta(days=30)
            time.sleep(0.5)  # Rate limiting
        
        if all_data:
            df = pd.DataFrame(all_data, columns=["DateTime", "Open", "High", "Low", "Close", "Volume"])
            df.to_csv(output_path, index=False)
            print(f"Saved {len(df)} records to {output_path}")
            return output_path
        
        return None


def main():
    parser = argparse.ArgumentParser(description="Dukascopy Historical Data Collector")
    parser.add_argument("--symbol", required=True, help="Symbol (XAUUSD, EURUSD, JPYUSD, SP500)")
    parser.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output", default="/srv/trading-data", help="Output directory")
    
    args = parser.parse_args()
    
    downloader = DukascopyDownloader(args.output)
    result = downloader.download(args.symbol, args.start, args.end)
    
    if result:
        print(f"Successfully downloaded data to: {result}")
        sys.exit(0)
    else:
        print("Download failed.")
        sys.exit(1)


if __name__ == "__main__":
    main()
