//+------------------------------------------------------------------+
//|                                     BrokerSymbolProfile.mqh      |
//|                             Broker / symbol metadata gate        |
//+------------------------------------------------------------------+

class CBrokerSymbolProfile
  {
private:
   string m_expected_symbol_fragment;
   string m_expected_account_currency;
   bool   m_require_expected_account_currency;
   bool   m_ready;
   string m_failure_reason;
   string m_symbol;
   string m_account_currency;
   int    m_digits;
   double m_point;
   int    m_spread_points;
   int    m_stop_level_points;
   int    m_freeze_level_points;
   double m_volume_min;
   double m_volume_max;
   double m_volume_step;
   double m_tick_size;
   double m_tick_value;
   double m_contract_size;

public:
   CBrokerSymbolProfile() : m_expected_symbol_fragment(""),
                            m_expected_account_currency(""),
                            m_require_expected_account_currency(false),
                            m_ready(false),
                            m_failure_reason(""),
                            m_symbol(""),
                            m_account_currency(""),
                            m_digits(0),
                            m_point(0.0),
                            m_spread_points(0),
                            m_stop_level_points(0),
                            m_freeze_level_points(0),
                            m_volume_min(0.0),
                            m_volume_max(0.0),
                            m_volume_step(0.0),
                            m_tick_size(0.0),
                            m_tick_value(0.0),
                            m_contract_size(0.0)
     {
     }

   bool Init(string expected_symbol_fragment, string expected_account_currency, bool require_expected_account_currency)
     {
      m_expected_symbol_fragment = expected_symbol_fragment;
      m_expected_account_currency = expected_account_currency;
      m_require_expected_account_currency = require_expected_account_currency;
      m_failure_reason = "";
      m_ready = false;

      Collect();
      Validate();
      m_ready = m_failure_reason == "";
      return m_ready;
     }

   bool IsReady()
     {
      return m_ready;
     }

   string FailureReason()
     {
      return m_failure_reason;
     }

   void PrintProfileMarker()
     {
      Print(
         "BROKER_SYMBOL_PROFILE: symbol=", m_symbol,
         " account=", m_account_currency,
         " digits=", m_digits,
         " point=", DoubleToString(m_point, 8),
         " spread_points=", m_spread_points,
         " stop_level=", m_stop_level_points,
         " freeze_level=", m_freeze_level_points,
         " volume_min=", DoubleToString(m_volume_min, 8),
         " volume_max=", DoubleToString(m_volume_max, 8),
         " volume_step=", DoubleToString(m_volume_step, 8),
         " tick_size=", DoubleToString(m_tick_size, 8),
         " tick_value=", DoubleToString(m_tick_value, 8),
         " contract_size=", DoubleToString(m_contract_size, 8)
      );
     }

   int Digits()
     {
      return m_digits;
     }

   double PointValue()
     {
      return m_point;
     }

   int SpreadPoints()
     {
      return m_spread_points;
     }

   int StopLevelPoints()
     {
      return m_stop_level_points;
     }

   int FreezeLevelPoints()
     {
      return m_freeze_level_points;
     }

   double VolumeMin()
     {
      return m_volume_min;
     }

   double VolumeMax()
     {
      return m_volume_max;
     }

   double VolumeStep()
     {
      return m_volume_step;
     }

   double TickSize()
     {
      return m_tick_size;
     }

   double TickValue()
     {
      return m_tick_value;
     }

   double ContractSize()
     {
      return m_contract_size;
     }

private:
   void Collect()
     {
      m_symbol = _Symbol;
      m_account_currency = AccountInfoString(ACCOUNT_CURRENCY);
      m_digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
      m_point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
      m_spread_points = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      m_stop_level_points = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
      m_freeze_level_points = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
      m_volume_min = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      m_volume_max = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
      m_volume_step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      m_tick_size = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      m_tick_value = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      m_contract_size = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_CONTRACT_SIZE);
     }

   void Validate()
     {
      if(m_symbol == "")
         AppendFailure("symbol is empty");
      if(m_expected_symbol_fragment != "" && StringFind(m_symbol, m_expected_symbol_fragment) < 0)
         AppendFailure("symbol does not match expected fragment: " + m_expected_symbol_fragment);
      if(m_account_currency == "")
         AppendFailure("account currency is empty");
      if(m_require_expected_account_currency && m_account_currency != m_expected_account_currency)
         AppendFailure("account currency mismatch: expected=" + m_expected_account_currency + " actual=" + m_account_currency);
      if(m_digits <= 0)
         AppendFailure("invalid digits");
      if(m_point <= 0.0)
         AppendFailure("invalid point");
      if(m_volume_min <= 0.0)
         AppendFailure("invalid volume_min");
      if(m_volume_max < m_volume_min)
         AppendFailure("invalid volume_max");
      if(m_volume_step <= 0.0)
         AppendFailure("invalid volume_step");
      if(m_tick_size <= 0.0)
         AppendFailure("invalid tick_size");
      if(m_tick_value <= 0.0)
         AppendFailure("invalid tick_value");
      if(m_contract_size <= 0.0)
         AppendFailure("invalid contract_size");
      if(m_stop_level_points < 0)
         AppendFailure("invalid stop_level");
      if(m_freeze_level_points < 0)
         AppendFailure("invalid freeze_level");
      if(m_spread_points < 0)
         AppendFailure("invalid spread_points");
     }

   void AppendFailure(string reason)
     {
      if(m_failure_reason == "")
        {
         m_failure_reason = reason;
         return;
        }

      m_failure_reason += "; " + reason;
     }
  };
