//+------------------------------------------------------------------+
//|                                              TradeLogic.mqh      |
//|                                  Signal logic classes            |
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| CBreakoutSignal_XAUUSD class                                      |
//+------------------------------------------------------------------+
class CBreakoutSignal_XAUUSD
  {
private:
   int      m_lookback_bars;
   int      m_atr_period;
   double   m_atr_min;
   int      m_ema_period;
   bool     m_use_h1_ema_filter;
   int      m_session_start_hour;
   int      m_session_end_hour;
   datetime m_last_processed_m15_bar_time;
   int      m_last_direction;
   int      m_session_key;
   bool     m_buy_taken_this_session;
   bool     m_sell_taken_this_session;

public:
   CBreakoutSignal_XAUUSD() : m_lookback_bars(10),
                              m_atr_period(14),
                                m_atr_min(1.5),
                              m_ema_period(200),
                              m_use_h1_ema_filter(true),
                              m_session_start_hour(12),
                              m_session_end_hour(24),
                              m_last_processed_m15_bar_time(0),
                              m_last_direction(0),
                              m_session_key(0),
                              m_buy_taken_this_session(false),
                              m_sell_taken_this_session(false) {}
    
   void Init()
      {
      m_last_processed_m15_bar_time = 0;
      m_last_direction = 0;
      m_session_key = 0;
      m_buy_taken_this_session = false;
      m_sell_taken_this_session = false;
      }

   void SetUseH1EMAFilter(bool enabled)
      {
      m_use_h1_ema_filter = enabled;
      }
    
   double Evaluate()
      {
      datetime last_closed_bar_time = GetLastClosedM15BarTime();
      if(last_closed_bar_time == 0 || last_closed_bar_time == m_last_processed_m15_bar_time)
         return 0.0;

      ResetSessionStateIfNeeded(last_closed_bar_time);

      if(!IsTradingSession(last_closed_bar_time))
         return 0.0;

      double atr = GetM15ATR();
      if(atr < m_atr_min)
         return 0.0;

      double breakout_high = 0.0;
      double breakout_low = 0.0;
      if(!GetBreakoutLevels(breakout_high, breakout_low))
         return 0.0;

      double last_close = GetLastClosedM15Close();
      double prev_close = GetPreviousClosedM15Close();
      if(last_close == 0.0 || prev_close == 0.0)
         return 0.0;

      if(CanTakeDirection(1) && last_close > breakout_high && prev_close <= breakout_high && IsTrendAligned(1, last_close))
        {
         m_last_direction = 1;
         return 0.8;
        }

      if(CanTakeDirection(-1) && last_close < breakout_low && prev_close >= breakout_low && IsTrendAligned(-1, last_close))
        {
         m_last_direction = -1;
         return -0.8;
        }

      m_last_direction = 0;
      return 0.0;
      }
    
    // Returns true if a valid signal is present, fills entry, sl, tp
   bool CheckEntrySignal(double &entry, double &sl, double &tp)
      {
      double signal = Evaluate();
      double atr = GetM15ATR();
      if(signal > 0.7 && m_last_direction == 1 && atr >= m_atr_min)
        {
         entry = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         sl = entry - atr * 1.5;
         tp = entry + atr * 3.0;
         m_last_processed_m15_bar_time = GetLastClosedM15BarTime();
         m_buy_taken_this_session = true;
         return true;
        }

      if(signal < -0.7 && m_last_direction == -1 && atr >= m_atr_min)
        {
         entry = SymbolInfoDouble(_Symbol, SYMBOL_BID);
         sl = entry + atr * 1.5;
         tp = entry - atr * 3.0;
         m_last_processed_m15_bar_time = GetLastClosedM15BarTime();
         m_sell_taken_this_session = true;
         return true;
        }

      return false;
      }

private:
   datetime GetLastClosedM15BarTime()
      {
      return iTime(_Symbol, PERIOD_M15, 1);
      }

   bool IsTradingSession(datetime bar_time)
      {
      MqlDateTime dt = {};
      TimeToStruct(bar_time, dt);
      return dt.hour >= m_session_start_hour && dt.hour < m_session_end_hour;
      }

   void ResetSessionStateIfNeeded(datetime bar_time)
      {
      MqlDateTime dt = {};
      TimeToStruct(bar_time, dt);
      int next_session_key = dt.year * 10000 + dt.mon * 100 + dt.day;
      if(next_session_key == m_session_key)
         return;

      m_session_key = next_session_key;
      m_buy_taken_this_session = false;
      m_sell_taken_this_session = false;
      }

   bool CanTakeDirection(int direction)
      {
      if(direction > 0)
         return !m_buy_taken_this_session;
      if(direction < 0)
         return !m_sell_taken_this_session;
      return false;
      }

   bool IsTrendAligned(int direction, double reference_price)
      {
      if(!m_use_h1_ema_filter)
         return true;

      int handle = iMA(_Symbol, PERIOD_H1, m_ema_period, 0, MODE_EMA, PRICE_CLOSE);
      if(handle == INVALID_HANDLE)
         return false;

      double values[];
      ArraySetAsSeries(values, true);
      bool ok = CopyBuffer(handle, 0, 1, 1, values) > 0;
      IndicatorRelease(handle);
      if(!ok)
         return false;

      if(direction > 0)
         return reference_price > values[0];
      if(direction < 0)
         return reference_price < values[0];
      return false;
      }

   double GetM15ATR()
      {
      int handle = iATR(_Symbol, PERIOD_M15, m_atr_period);
      if(handle == INVALID_HANDLE)
         return 0.0;

      double values[];
      ArraySetAsSeries(values, true);
      bool ok = CopyBuffer(handle, 0, 1, 1, values) > 0;
      IndicatorRelease(handle);
      if(!ok)
         return 0.0;
      return values[0];
      }

   bool GetBreakoutLevels(double &high, double &low)
      {
      double highs[];
      double lows[];
      ArraySetAsSeries(highs, true);
      ArraySetAsSeries(lows, true);

      if(CopyHigh(_Symbol, PERIOD_M15, 2, m_lookback_bars, highs) != m_lookback_bars)
         return false;
      if(CopyLow(_Symbol, PERIOD_M15, 2, m_lookback_bars, lows) != m_lookback_bars)
         return false;

      int high_index = ArrayMaximum(highs, 0, WHOLE_ARRAY);
      int low_index = ArrayMinimum(lows, 0, WHOLE_ARRAY);
      if(high_index < 0 || low_index < 0)
         return false;

      high = highs[high_index];
      low = lows[low_index];
      return true;
      }

   double GetLastClosedM15Close()
      {
      return iClose(_Symbol, PERIOD_M15, 1);
      }

   double GetPreviousClosedM15Close()
      {
      return iClose(_Symbol, PERIOD_M15, 2);
      }
  };

//+------------------------------------------------------------------+
//| CPullbackSignal_SP500 class                                       |
//+------------------------------------------------------------------+
class CPullbackSignal_SP500
  {
private:
   double m_ema_h4;
   double m_ema_d1;
   double m_rsi_m15;

public:
   CPullbackSignal_SP500() : m_ema_h4(0), m_ema_d1(0), m_rsi_m15(50) {}
   
   void Init()
     {
      // Initialize EMA and RSI handles
      UpdateIndicators();
     }
   
   void UpdateIndicators()
     {
      // H4 EMA
      int h4_handle = iMA(_Symbol, PERIOD_H4, 50, 0, MODE_EMA, PRICE_CLOSE);
      double h4_vals[];
      ArraySetAsSeries(h4_vals, true);
      if(CopyBuffer(h4_handle, 0, 0, 1, h4_vals) > 0) m_ema_h4 = h4_vals[0];
      
      // D1 EMA
      int d1_handle = iMA(_Symbol, PERIOD_D1, 50, 0, MODE_EMA, PRICE_CLOSE);
      double d1_vals[];
      ArraySetAsSeries(d1_vals, true);
      if(CopyBuffer(d1_handle, 0, 0, 1, d1_vals) > 0) m_ema_d1 = d1_vals[0];
      
      // M15 RSI
      int rsi_handle = iRSI(_Symbol, PERIOD_M15, 14, PRICE_CLOSE);
      double rsi_vals[];
      ArraySetAsSeries(rsi_vals, true);
      if(CopyBuffer(rsi_handle, 0, 0, 1, rsi_vals) > 0) m_rsi_m15 = rsi_vals[0];
     }
   
   double Evaluate()
     {
      UpdateIndicators(); // Refresh data
      
      // H4/D1 EMA uptrend + M15 RSI < 40 = buy signal
      bool ema_uptrend = m_ema_h4 > m_ema_d1;
      bool rsi_oversold = m_rsi_m15 < 40;
      
      if(ema_uptrend && rsi_oversold)
         return 0.8;
      
      if(ema_uptrend && m_rsi_m15 < 30)
         return 0.9;
      
      return 0.0;
     }
   
   // Returns true if a valid signal is present, fills entry, sl, tp
   bool CheckEntrySignal(double &entry, double &sl, double &tp)
     {
      if(Evaluate() > 0.7)
        {
         entry = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         // Dynamic SL based on ATR or fixed points
         int atr = iATR(_Symbol, PERIOD_M15, 14);
         double atr_val[];
         ArraySetAsSeries(atr_val, true);
         CopyBuffer(atr, 0, 0, 1, atr_val);
         double risk_dist = atr_val[0] * 2.0;
         
         sl = entry - risk_dist;
         tp = entry + risk_dist * 2.0; // 1:2 RR
         return true;
        }
      return false;
     }
  };

//+------------------------------------------------------------------+
//| CMLModel_Universal class                                          |
//+------------------------------------------------------------------+
class CMLModel_Universal
  {
private:
   string m_model_path;
   long   m_model_handle;

public:
   CMLModel_Universal() : m_model_path(""), m_model_handle(INVALID_HANDLE) {}
   
   void Init()
      {
      // Load ONNX model
      m_model_path = "C:\\dev\\opencode-trade-bridge\\model.onnx";
      m_model_handle = OnnxCreate(m_model_path, ONNX_DEFAULT);
      }
   
   double Evaluate()
     {
      // Input features: [RSI, ATR, MACD, HMA, ...]
      float features[];
      ArrayResize(features, 10);
      
      // Fill feature array
      features[0] = (float)GetRSI();
      features[1] = (float)GetATR();
      features[2] = (float)GetMACD();
      // ... more features
      
      // ONNX inference
      float output[];
      if(OnnxRun(m_model_handle, ONNX_NO_CONVERSION, features, output))
        {
         // Output: [BUY_PROB, SELL_PROB, HOLD_PROB]
         double buy_prob = output[0];
         double sell_prob = output[1];
         
         if(buy_prob > sell_prob && buy_prob > 0.6)
            return buy_prob;
         if(sell_prob > buy_prob && sell_prob > 0.6)
            return -sell_prob;
        }
      
      return 0.0;
     }
   
   // Returns true if a valid signal is present, fills entry, sl, tp
   bool CheckEntrySignal(double &entry, double &sl, double &tp)
     {
      double signal = Evaluate();
      if(MathAbs(signal) > 0.6)
        {
         entry = SymbolInfoDouble(_Symbol, (signal > 0) ? SYMBOL_ASK : SYMBOL_BID);
         int atr = iATR(_Symbol, PERIOD_M1, 14);
         double atr_val[];
         ArraySetAsSeries(atr_val, true);
         CopyBuffer(atr, 0, 0, 1, atr_val);
         double dist = atr_val[0] * 2.0;
          
         sl = (signal > 0) ? entry - dist : entry + dist;
         tp = (signal > 0) ? entry + dist * 2.0 : entry - dist * 2.0;
         return true;
        }
      return false;
     }

private:
   double GetRSI() 
     { 
      int h = iRSI(_Symbol, PERIOD_M1, 14, PRICE_CLOSE); 
      double v[]; ArraySetAsSeries(v, true); 
      CopyBuffer(h, 0, 0, 1, v); return v[0]; 
     }
   double GetATR() 
     { 
      int h = iATR(_Symbol, PERIOD_M1, 14); 
      double v[]; ArraySetAsSeries(v, true); 
      CopyBuffer(h, 0, 0, 1, v); return v[0]; 
     }
   double GetMACD() 
     { 
      int h = iMACD(_Symbol, PERIOD_M1, 12, 26, 9, PRICE_CLOSE); 
      double v[]; ArraySetAsSeries(v, true); 
      CopyBuffer(h, 0, 0, 1, v); return v[0]; 
     }
  };
