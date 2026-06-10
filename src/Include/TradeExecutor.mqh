//+------------------------------------------------------------------+
//|                                               TradeExecutor.mqh   |
//|                           Entry order preflight and execution     |
//+------------------------------------------------------------------+

class CTradeExecutor
  {
private:
   ulong m_magic_number;
   int   m_max_spread_points;
   int   m_deviation_points;
   int   m_max_retries;
   string m_last_skip_reason;
   int    m_last_retcode;

public:
   CTradeExecutor() : m_magic_number(0),
                      m_max_spread_points(80),
                      m_deviation_points(10),
                      m_max_retries(3),
                      m_last_skip_reason(""),
                      m_last_retcode(0)
     {
     }

   bool Init(ulong magic_number)
     {
      m_magic_number = magic_number;
      return m_magic_number != 0;
     }

   void SetMaxSpreadPoints(int max_spread_points)
     {
      m_max_spread_points = max_spread_points;
     }

   void SetDeviationPoints(int deviation_points)
     {
      m_deviation_points = deviation_points;
     }

   void SetMaxRetries(int max_retries)
     {
      m_max_retries = max_retries;
     }

   string LastSkipReason()
     {
      return m_last_skip_reason;
     }

   int LastRetcode()
     {
      return m_last_retcode;
     }

   bool PlaceMarketOrder(ENUM_ORDER_TYPE type, double lot, double requested_entry, double requested_sl, double requested_tp)
     {
      ResetLastState();
      if(m_magic_number == 0)
         return FailSkip("EXECUTOR_NOT_INITIALIZED");
      if(type != ORDER_TYPE_BUY && type != ORDER_TYPE_SELL)
         return FailSkip("UNSUPPORTED_ORDER_TYPE");
      if(lot <= 0.0)
         return FailSkip("INVALID_VOLUME");
      if(requested_entry <= 0.0 || requested_sl <= 0.0 || requested_tp <= 0.0)
         return FailSkip("MISSING_SL_TP");

      double sl_distance = MathAbs(requested_entry - requested_sl);
      double tp_distance = MathAbs(requested_tp - requested_entry);
      if(sl_distance <= 0.0 || tp_distance <= 0.0)
         return FailSkip("MISSING_SL_TP");

      if(!IsValidVolume(lot))
         return FailSkip("INVALID_VOLUME");

      ENUM_ORDER_TYPE_FILLING filling_mode;
      if(!ResolveFillingMode(filling_mode))
         return FailSkip("UNSUPPORTED_FILLING_MODE");

      int retries = MathMax(1, m_max_retries);
      for(int attempt = 1; attempt <= retries; attempt++)
        {
         double entry_price = CurrentEntryPrice(type);
         if(entry_price <= 0.0)
            return FailSkip("INVALID_PRICE");

         if(!IsSpreadAllowed())
            return FailSkip("SPREAD_TOO_WIDE");

         double sl = CalculateStopLoss(type, entry_price, sl_distance);
         double tp = CalculateTakeProfit(type, entry_price, tp_distance);
         if(sl <= 0.0 || tp <= 0.0)
            return FailSkip("MISSING_SL_TP");
         if(!HasValidStops(type, entry_price, sl, tp))
            return FailSkip("INVALID_STOPS");
         if(!HasValidMargin(type, lot, entry_price))
            return FailSkip("MARGIN_CHECK_FAILED");

         MqlTradeRequest request = {};
         MqlTradeResult result = {};
         request.action = TRADE_ACTION_DEAL;
         request.symbol = _Symbol;
         request.volume = lot;
         request.type = type;
         request.price = entry_price;
         request.sl = sl;
         request.tp = tp;
         request.deviation = m_deviation_points;
         request.magic = m_magic_number;
         request.type_filling = filling_mode;
         request.comment = "opencode-trade";

         if(OrderSend(request, result) && result.retcode == TRADE_RETCODE_DONE)
           {
            Print("Order placed successfully: ", type, " ", lot, " lots at ", request.price);
            m_last_retcode = (int)result.retcode;
            return true;
           }

         m_last_retcode = (int)result.retcode;
         if(result.retcode == TRADE_RETCODE_REQUOTE && attempt < retries)
           {
            Sleep(100);
            continue;
           }

         Print("Order failed (attempt ", attempt, "): ", result.retcode, " - ", result.comment);
         return false;
        }

      return false;
     }

private:
   void ResetLastState()
     {
      m_last_skip_reason = "";
      m_last_retcode = 0;
     }

   bool FailSkip(string reason)
     {
      m_last_skip_reason = reason;
      Print("SKIP_REASON: ", reason);
      return false;
     }

   double CurrentEntryPrice(ENUM_ORDER_TYPE type)
     {
      double price = (type == ORDER_TYPE_BUY)
                     ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                     : SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(price <= 0.0)
         return 0.0;
      return NormalizePrice(price);
     }

   double CalculateStopLoss(ENUM_ORDER_TYPE type, double entry_price, double sl_distance)
     {
      double sl = (type == ORDER_TYPE_BUY)
                  ? entry_price - sl_distance
                  : entry_price + sl_distance;
      return (sl > 0.0) ? NormalizePrice(sl) : 0.0;
     }

   double CalculateTakeProfit(ENUM_ORDER_TYPE type, double entry_price, double tp_distance)
     {
      double tp = (type == ORDER_TYPE_BUY)
                  ? entry_price + tp_distance
                  : entry_price - tp_distance;
      return (tp > 0.0) ? NormalizePrice(tp) : 0.0;
     }

   double NormalizePrice(double price)
     {
      return NormalizeDouble(price, _Digits);
     }

   bool IsSpreadAllowed()
     {
      if(m_max_spread_points <= 0)
         return true;
      int spread_points = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      return spread_points >= 0 && spread_points <= m_max_spread_points;
     }

   bool HasValidStops(ENUM_ORDER_TYPE type, double entry_price, double sl, double tp)
     {
      double point_value = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
      if(point_value <= 0.0)
         return false;

      double bid = NormalizePrice(SymbolInfoDouble(_Symbol, SYMBOL_BID));
      double ask = NormalizePrice(SymbolInfoDouble(_Symbol, SYMBOL_ASK));
      if(bid <= 0.0 || ask <= 0.0)
         return false;

      int stop_level = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
      int freeze_level = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
      double min_distance = MathMax(stop_level, freeze_level) * point_value;
      if(type == ORDER_TYPE_BUY)
        {
         if(sl >= entry_price || tp <= entry_price)
            return false;
         return sl < bid && tp > ask && (bid - sl) >= min_distance && (tp - ask) >= min_distance;
        }

      if(sl <= entry_price || tp >= entry_price)
         return false;
      return sl > ask && tp < bid && (sl - ask) >= min_distance && (bid - tp) >= min_distance;
     }

   bool HasValidMargin(ENUM_ORDER_TYPE type, double lot, double entry_price)
     {
      double free_margin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
      if(free_margin <= 0.0)
         return false;
      double margin_required = 0.0;
      if(!OrderCalcMargin(type, _Symbol, lot, entry_price, margin_required))
         return false;
      return margin_required > 0.0 && margin_required <= free_margin * 0.95;
     }

   bool IsValidVolume(double lot)
     {
      double min_lot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      double max_lot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
      double lot_step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      if(min_lot <= 0.0 || max_lot <= 0.0 || lot_step <= 0.0)
         return false;
      if(lot < min_lot || lot > max_lot)
         return false;
      double steps = lot / lot_step;
      return MathAbs(steps - MathRound(steps)) <= 0.000001;
     }

   bool ResolveFillingMode(ENUM_ORDER_TYPE_FILLING &filling_mode)
     {
      long raw_mode = SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE);
      if((raw_mode & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
        {
         filling_mode = ORDER_FILLING_IOC;
         return true;
        }
      if((raw_mode & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
        {
         filling_mode = ORDER_FILLING_FOK;
         return true;
        }
      return false;
     }
  };
