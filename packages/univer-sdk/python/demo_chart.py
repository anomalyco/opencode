from __future__ import annotations

import asyncio

from veritly_univer_sdk import RangeRect, UniverSDK


async def main() -> None:
    sdk = UniverSDK()
    await sdk.connect()
    try:
        doc = await sdk.get_active_document()
        print("Active document:", doc)
        data = await sdk.get_range(RangeRect(startRow=0, endRow=4, startColumn=0, endColumn=1), sheet_id=doc.sheetId)
        print("Range A1:B5 values:", data)
        ok = await sdk.add_chart(
            RangeRect(startRow=0, endRow=4, startColumn=0, endColumn=1),
            sheet_id=doc.sheetId,
            chart_type=4,
        )
        print("Chart inserted:", ok)
    finally:
        await sdk.close()


if __name__ == "__main__":
    asyncio.run(main())
