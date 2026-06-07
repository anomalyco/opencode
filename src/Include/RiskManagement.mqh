//+------------------------------------------------------------------+
//|                                            RiskManagement.mqh    |
//|                                  Position sizing & risk control  |
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| CRiskManager class                                                |
//+------------------------------------------------------------------+
class CRiskManager
  {
private:
   double m_global_dd_limit;      // -25%
   double m_monthly_dd_limit;     // -20%
   double m_daily_dd_limit;       // -3%
   double m_kelly_fraction;       // 0.25 (Quarter Kelly)
   
   double m_initial_equity;
   double m_month_high_equity;
   double m_day_high_equity;
   datetime m_last_month_reset;
   datetime m_last_day_reset;

public:
   CRiskManager() : m_global_dd_limit(-0.25),
                    m_monthly_dd_limit(-0.20),
                    m_daily_dd_limit(-0.03),
                    m_kelly_fraction(0.25),
                    m_initial_equity(0),
                    m_month_high_equity(0),
                    m_day_high_equity(0)
     {
      m_last_month_reset = TimeCurrent();
      m_last_day_reset = TimeCurrent();
     }
   
   void SetGlobalDDLimit(double limit)  { m_global_dd_limit = limit; }
   void SetMonthlyDDLimit(double limit) { m_monthly_dd_limit = limit; }
   void SetDailyDDLimit(double limit)   { m_daily_dd_limit = limit; }
   void SetKellyFraction(double frac)   { m_kelly_fraction = frac; }
   
   bool IsHealthy()
     {
      double equity = AccountInfoDouble(ACCOUNT_EQUITY);
      
      if(m_initial_equity == 0)
        {
         m_initial_equity = equity;
         m_month_high_equity = equity;
         m_day_high_equity = equity;
         return true;
        }
      
      // Update highs
      if(equity > m_month_high_equity) m_month_high_equity = equity;
      if(equity > m_day_high_equity)   m_day_high_equity = equity;
      
      // Check global DD
      double global_dd = (equity - m_initial_equity) / m_initial_equity;
      if(global_dd < m_global_dd_limit)
        {
         Print("CRITICAL: Global Drawdown limit reached: ", DoubleToString(global_dd * 100, 2), "%");
         return false;
        }
      
      // Check monthly DD
      double monthly_dd = (equity - m_month_high_equity) / m_month_high_equity;
      if(monthly_dd < m_monthly_dd_limit)
        {
         Print("WARNING: Monthly Drawdown limit reached: ", DoubleToString(monthly_dd * 100, 2), "%");
         return false;
        }
      
      // Check daily DD
      ResetDailyIfNeeded();
      double daily_dd = (equity - m_day_high_equity) / m_day_high_equity;
      if(daily_dd < m_daily_dd_limit)
        {
         Print("CAUTION: Daily Drawdown limit reached: ", DoubleToString(daily_dd * 100, 2), "%");
         return false;
        }
      
      return true;
     }
   
   double CalculateLot()
     {
      double equity = AccountInfoDouble(ACCOUNT_EQUITY);
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      
      // Kelly criterion calculation
      double win_rate = 0.55;     // Historical win rate
      double avg_win = 1.5;       // Average win/loss ratio
      double avg_loss = 1.0;
      
      double kelly = (win_rate * avg_win - (1 - win_rate) * avg_loss) / avg_loss;
      kelly = MathMax(0, kely) * m_kelly_fraction;
      
      // Risk per trade (1% of equity with Kelly scaling)
      double risk_amount = equity * 0.01 * kely;
      
      // Convert to lots
      double lot_size = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_CONTRACT_SIZE);
      double tick_value = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double stop_loss_ticks = 100;  // Default 100 ticks
      
      double lot = risk_amount / (stop_loss_ticks * tick_value);
      
      // Normalize to broker lot step
      double lot_step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      double min_lot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      double max_lot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
      
      lot = MathFloor(lot / lot_step) * lot_step;
      lot = MathMax(min_lot, MathMin(max_lot, lot));
      
      // Apply daily DD reduction
      double daily_dd = (equity - m_day_high_equity) / m_day_high_equity;
      if(daily_dd < -0.015)  // 1.5% daily DD
         lot *= 0.5;         // Reduce lot by 50%
      
      return NormalizeDouble(lot, 2);
     }
   
   bool CanEnter()
     {
      return IsHealthy();
     }
   
   bool PlaceOrder(ENUM_ORDER_TYPE type, double lot, double price, double sl, double tp)
     {
      MqlTradeRequest request = {};
      MqlTradeResult result = {};
      
      request.action       = TRADE_ACTION_DEAL;
      request.symbol       = _Symbol;
      request.volume       = lot;
      request.type         = type;
      request.price        = price;
      request.sl           = sl;
      request.tp           = tp;
      request.deviation    = 10;
      request.type_filling = ORDER_FILLING_IOC;
      request.comment      = "opencode-trade";
      
      int max_retries = 3;
      for(int i = 0; i < max_retries; i++)
        {
         if(OrderSend(request, result))
           {
            if(result.retcode == TRADE_RETCODE_DONE)
              {
               Print("Order placed successfully: ", type, " ", lot, " lots at ", price);
               return true;
              }
           }
         
         // Handle requote
         if(result.retcode == TRADE_RETCODE_REQUOTE)
           {
            Sleep(100);
            request.price = (type == ORDER_TYPE_BUY) ? 
                            SymbolInfoDouble(_Symbol, SYMBOL_ASK) : 
                            SymbolInfoDouble(_Symbol, SYMBOL_BID);
            continue;
           }
         
         Print("Order failed (attempt ", i + 1, "): ", result.retcode, " - ", result.comment);
         break;
        }
      
      return false;
     }
   
   void UpdateTrailingStop()
     {
      // Iterate through open positions and update trailing stops
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong ticket = PositionGetTicket(i);
         if(ticket == 0) continue;
         
         if(PositionGetString(POSITION_SYMBOL) != _Symbol)
            continue;
         
         double open_price = PositionGetDouble(POSITION_PRICE_OPEN);
         double current_sl = PositionGetDouble(POSITION_SL);
         double current_price = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 
                                SymbolInfoDouble(_Symbol, SYMBOL_BID) : 
                                SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         
         // 50 tick trailing stop
         double trail_distance = 50 * _Point;
         
         if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
           {
            double new_sl = current_price - trail_distance;
            if(new_sl > current_sl && new_sl > open_price)
              {
               ModifyPosition(ticket, new_sl, PositionGetDouble(POSITION_TP));
              }
           }
         else
           {
            double new_sl = current_price + trail_distance;
            if((current_sl == 0 || new_sl < current_sl) && new_sl < open_price)
              {
               ModifyPosition(ticket, new_sl, PositionGetDouble(POSITION_TP));
              }
           }
        }
     }

private:
   void ResetDailyIfNeeded()
     {
      datetime now = TimeCurrent();
      MqlDateTime dt_now, dt_last;
      
      TimeToStruct(now, dt_now);
      TimeToStruct(m_last_day_reset, dt_last);
      
      if(dt_now.day != dt_last.day)
        {
         m_day_high_equity = AccountInfoDouble(ACCOUNT_EQUITY);
         m_last_day_reset = now;
        }
     }
   
   bool ModifyPosition(ulong ticket, double sl, double tp)
     {
      MqlTradeRequest request = {};
      MqlTradeResult result = {};
      
      request.action = TRADE_ACTION_SLTP;
      request.position = ticket;
      request.sl = sl;
      request.tp = tp;
      
      return OrderSend(request, result);
     }
  };
