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
   double m_asia_high;
   double m_asia_low;
   int    m_asia_start_hour;   // 0 UTC
   int    m_asia_end_hour;     // 8 UTC

public:
   CBreakoutSignal_XAUUSD() : m_asia_high(0), m_asia_low(0),
                               m_asia_start_hour(0), m_asia_end_hour(8) {}
   
   void Init()
     {
      // Pre-compute Asia session high/low
      CalculateAsiaRange();
     }
   
   double Evaluate()
     {
      double current_price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double range = m_asia_high - m_asia_low;
      
      if(range <= 0) return 0.0;
      
      // Breakout above Asia high
      if(current_price > m_asia_high)
        {
         double breakout_pct = (current_price - m_asia_high) / range;
         return MathMin(1.0, breakout_pct);
        }
      
      // Breakdown below Asia low
      if(current_price < m_asia_low)
        {
         double breakdown_pct = (m_asia_low - current_price) / range;
         return -MathMin(1.0, breakdown_pct);
        }
      
      return 0.0;
     }
   
   bool CheckEntry(double &entry_price, double &stop_loss)
     {
      double signal = Evaluate();
      
      if(signal > 0.5)
        {
         entry_price = m_asia_high;
         stop_loss = m_asia_low - 50 * _Point;
         return true;
        }
      
      if(signal < -0.5)
        {
         entry_price = m_asia_low;
         stop_loss = m_asia_high + 50 * _Point;
         return true;
        }
      
      return false;
     }
   
   void PlaceOrder(double lot, CRiskManager &risk)
     {
      double entry = 0, sl = 0, tp = 0;
      if(CheckEntry(entry, sl))
        {
         double signal = Evaluate();
         ENUM_ORDER_TYPE type = (signal > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
         risk.PlaceOrder(type, lot, entry, sl, tp);
        }
     }

private:
   void CalculateAsiaRange()
     {
      datetime now = TimeCurrent();
      int current_hour = TimeHour(now);
      
      if(current_hour >= m_asia_start_hour && current_hour <= m_asia_end_hour)
        {
         // Find high/low during Asia session
         double highs[], lows[];
         int bars = m_asia_end_hour - m_asia_start_hour;
         
         ArraySetAsSeries(highs, true);
         ArraySetAsSeries(lows, true);
         
         if(CopyHigh(_Symbol, PERIOD_H1, 0, bars, highs) > 0 &&
            CopyLow(_Symbol, PERIOD_H1, 0, bars, lows) > 0)
           {
            m_asia_high = ArrayMaximum(highs, 0, WHOLE_ARRAY);
            m_asia_low = ArrayMinimum(lows, 0, WHOLE_ARRAY);
           }
        }
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
     }
   
   double Evaluate()
     {
      // H4/D1 EMA uptrend + M15 RSI < 40 = buy signal
      bool ema_uptrend = m_ema_h4 > m_ema_d1;
      bool rsi_oversold = m_rsi_m15 < 40;
      
      if(ema_uptrend && rsi_oversold)
         return 0.8;
      
      if(ema_uptrend && m_rsi_m15 < 30)
         return 0.9;
      
      return 0.0;
     }
   
   void PlaceOrder(double lot, CRiskManager &risk)
     {
      if(Evaluate() > 0.7)
        {
         double entry = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         double sl = entry - 100 * _Point;
         double tp = entry + 200 * _Point;
         risk.PlaceOrder(ORDER_TYPE_BUY, lot, entry, sl, tp);
        }
     }
  };

//+------------------------------------------------------------------+
//| CMLModel_Universal class                                          |
//+------------------------------------------------------------------+
class CMLModel_Universal
  {
private:
   string m_model_path;
   int    m_model_handle;

public:
   CMLModel_Universal() : m_model_path(""), m_model_handle(INVALID_HANDLE) {}
   
   void Init()
     {
      // Load ONNX model
      m_model_path = "C:\\dev\\opencode-trade-bridge\\model.onnx";
      m_model_handle = OnnxCreateFromBuffer(m_model_path, ONNX_DEFAULT);
     }
   
   double Evaluate()
     {
      // Input features: [RSI, ATR, MACD, HMA, ...]
      float features[];
      ArrayResize(features, 10);
      
      // Fill feature array
      features[0] = CalculateRSI();
      features[1] = CalculateATR();
      features[2] = CalculateMACD();
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
   
   void PlaceOrder(double lot, CRiskManager &risk)
     {
      double signal = Evaluate();
      if(MathAbs(signal) > 0.6)
        {
         ENUM_ORDER_TYPE type = (signal > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
         double entry = SymbolInfoDouble(_Symbol, (signal > 0) ? SYMBOL_ASK : SYMBOL_BID);
         double sl = entry - 50 * _Point * MathSign(signal);
         double tp = entry + 100 * _Point * MathSign(signal);
         risk.PlaceOrder(type, lot, entry, sl, tp);
        }
     }

private:
   double CalculateRSI() { return 50.0; }  // Placeholder
   double CalculateATR() { return 1.0; }   // Placeholder
   double CalculateMACD() { return 0.0; }  // Placeholder
  };
