#!/usr/bin/env python3
"""
Stub collector for Dukascopy historical data.
The actual .bi5 decode and OHLC resampling path is not implemented yet.

Usage:
    python data_collector_SYMBOL.py --symbol XAUUSD --start 2023-01-01 --end 2024-12-31
"""

import argparse
import sys
from typing import Optional


class DukascopyDownloader:
    """Placeholder for future Dukascopy historical data download support."""
    
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
        
        _ = (self.output_dir, self.BASE_URL, self.SYMBOL_MAP[symbol], start_date, end_date)
        raise NotImplementedError(
            "Dukascopy .bi5 decoding and 1-minute OHLC export are not implemented yet. "
            "Do not treat src/Scripts/data_collector.py as a working collector."
        )


def main():
    parser = argparse.ArgumentParser(description="Dukascopy Historical Data Collector")
    parser.add_argument("--symbol", required=True, help="Symbol (XAUUSD, EURUSD, JPYUSD, SP500)")
    parser.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output", default="/srv/trading-data", help="Output directory")
    
    args = parser.parse_args()
    
    downloader = DukascopyDownloader(args.output)
    try:
        result = downloader.download(args.symbol, args.start, args.end)
    except NotImplementedError as exc:
        print(str(exc))
        sys.exit(1)

    if result:
        print(f"Successfully downloaded data to: {result}")
        sys.exit(0)

    print("Download failed.")
    sys.exit(1)


if __name__ == "__main__":
    main()
