//+------------------------------------------------------------------+
//|                                                DataFeed.mqh      |
//|                                  Market data aggregation         |
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| CDataFeed class                                                   |
//+------------------------------------------------------------------+
class CDataFeed
  {
private:
   string m_data_path;
   datetime m_last_update;
   
   // Cached OHLCV data
   double m_open[];
   double m_high[];
   double m_low[];
   double m_close[];
   long   m_volume[];

public:
   CDataFeed() : m_data_path(""), m_last_update(0)
     {
      ArraySetAsSeries(m_open, true);
      ArraySetAsSeries(m_high, true);
      ArraySetAsSeries(m_low, true);
      ArraySetAsSeries(m_close, true);
      ArraySetAsSeries(m_volume, true);
     }
   
   void Init()
     {
      // Set data path for historical CSV files
      m_data_path = "C:\\dev\\opencode-trade-bridge\\data\\";
      
      // Load initial data
      RefreshData();
     }
   
   bool RefreshData()
     {
      datetime now = TimeCurrent();
      
      // Update every minute
      if(m_last_update > 0 && now - m_last_update < 60)
         return true;
      
      // Copy latest bars from MT5
      int bars_needed = 1000;
      
      if(CopyOpen(_Symbol, PERIOD_M1, 0, bars_needed, m_open) <= 0) return false;
      if(CopyHigh(_Symbol, PERIOD_M1, 0, bars_needed, m_high) <= 0) return false;
      if(CopyLow(_Symbol, PERIOD_M1, 0, bars_needed, m_low) <= 0) return false;
      if(CopyClose(_Symbol, PERIOD_M1, 0, bars_needed, m_close) <= 0) return false;
      if(CopyTickVolume(_Symbol, PERIOD_M1, 0, bars_needed, m_volume) <= 0) return false;
      
      m_last_update = now;
      return true;
     }
   
   //--- OHLCV accessors
   double GetOpen(int index)    { return (index < ArraySize(m_open)) ? m_open[index] : 0; }
   double GetHigh(int index)    { return (index < ArraySize(m_high)) ? m_high[index] : 0; }
   double GetLow(int index)     { return (index < ArraySize(m_low)) ? m_low[index] : 0; }
   double GetClose(int index)   { return (index < ArraySize(m_close)) ? m_close[index] : 0; }
   long   GetVolume(int index)  { return (index < ArraySize(m_volume)) ? m_volume[index] : 0; }
   
   //--- Technical indicators
   double CalculateRSI(int period = 14, int shift = 0)
     {
      int handle = iRSI(_Symbol, PERIOD_M1, period, PRICE_CLOSE);
      double values[];
      ArraySetAsSeries(values, true);
      
      if(CopyBuffer(handle, 0, shift, 1, values) > 0)
         return values[0];
      
      return 50.0;  // Default
     }
   
   double CalculateATR(int period = 14, int shift = 0)
     {
      int handle = iATR(_Symbol, PERIOD_M1, period);
      double values[];
      ArraySetAsSeries(values, true);
      
      if(CopyBuffer(handle, 0, shift, 1, values) > 0)
         return values[0];
      
      return 0.0;
     }
   
   double CalculateMACD(int fast_period = 12, int slow_period = 26, int signal_period = 9, int shift = 0)
     {
      int handle = iMACD(_Symbol, PERIOD_M1, fast_period, slow_period, signal_period, PRICE_CLOSE);
      double values[];
      ArraySetAsSeries(values, true);
      
      if(CopyBuffer(handle, 0, shift, 1, values) > 0)
         return values[0];
      
      return 0.0;
     }
   
   double CalculateEMA(int period, int shift = 0)
     {
      int handle = iMA(_Symbol, PERIOD_M1, period, 0, MODE_EMA, PRICE_CLOSE);
      double values[];
      ArraySetAsSeries(values, true);
      
      if(CopyBuffer(handle, 0, shift, 1, values) > 0)
         return values[0];
      
      return 0.0;
     }
   
   //--- CSV export for backtesting
   bool ExportToCSV(string filename, int bars = 10000)
     {
      double open[], high[], low[], close[];
      datetime time[];
      
      ArraySetAsSeries(open, true);
      ArraySetAsSeries(high, true);
      ArraySetAsSeries(low, true);
      ArraySetAsSeries(close, true);
      ArraySetAsSeries(time, true);
      
      CopyOpen(_Symbol, PERIOD_M1, 0, bars, open);
      CopyHigh(_Symbol, PERIOD_M1, 0, bars, high);
      CopyLow(_Symbol, PERIOD_M1, 0, bars, low);
      CopyClose(_Symbol, PERIOD_M1, 0, bars, close);
      CopyTime(_Symbol, PERIOD_M1, 0, bars, time);
      
      int handle = FileOpen(filename, FILE_WRITE | FILE_CSV | FILE_ANSI);
      if(handle == INVALID_HANDLE) return false;
      
      FileWriteString(handle, "DateTime,Open,High,Low,Close\n");
      
      for(int i = 0; i < bars; i++)
        {
         string line = TimeToString(time[i]) + "," +
                       DoubleToString(open[i], _Digits) + "," +
                       DoubleToString(high[i], _Digits) + "," +
                       DoubleToString(low[i], _Digits) + "," +
                       DoubleToString(close[i], _Digits);
         FileWriteString(handle, line + "\n");
        }
      
      FileClose(handle);
      return true;
     }
  };
