//+------------------------------------------------------------------+
//|                                              Expert_Main.mq5     |
//|                                  opencode-trade EA               |
//+------------------------------------------------------------------+
#property copyright "opencode-trade"
#property version   "1.00"

#include "Include/TradeLogic.mqh"
#include "Include/BrokerSymbolProfile.mqh"
#include "Include/RiskManagement.mqh"
#include "Include/DataFeed.mqh"

input bool   InpUseH1EMAFilter = false;
input int    InpBreakoutLookbackBars = 10;
input double InpBreakoutATRMin = 1.5;
input double InpStopLossATRMultiplier = 1.5;
input double InpTakeProfitATRMultiplier = 3.0;
input int    InpSessionStartHour = 12;
input int    InpSessionEndHour = 24;
input ulong  InpMagicNumber = 12345;
input double InpGlobalDDLimit = -0.25;
input double InpMonthlyDDLimit = -0.20;
input double InpDailyDDLimit = -0.03;
input bool   InpEnableGlobalEmergencyClose = true;
input string InpExpectedSymbolFragment = "XAUUSD";
input string InpExpectedAccountCurrency = "JPY";
input bool   InpRequireExpectedAccountCurrency = true;
input int    InpMaxSpreadPoints = 80;
input int    InpTradeDeviationPoints = 10;
input int    InpTradeMaxRetries = 3;

//+------------------------------------------------------------------+
//| CExpertAdvisor class                                              |
//+------------------------------------------------------------------+
class CExpertAdvisor
  {
private:
   // Signal members
   CBreakoutSignal_XAUUSD  m_sig_breakout;
   CPullbackSignal_SP500   m_sig_pullback;
   CMLModel_Universal      m_sig_ml;
   
    // Risk management
    CRiskManager            m_risk;

    // Broker / symbol profile
    CBrokerSymbolProfile    m_profile;
   
   // Data feed
   CDataFeed               m_data;

public:
    CExpertAdvisor() {}

    //--- Initialization
      int OnInit()
        {
         if(InpMagicNumber == 0)
           {
            Print("RiskManager initialization failed: InpMagicNumber must not be 0");
            return(INIT_FAILED);
           }

         bool invalid_limit = false;
         if(!IsValidDrawdownLimit(InpGlobalDDLimit))
           {
            Print("RiskManager initialization failed: InpGlobalDDLimit must be a negative fraction greater than -1.0");
            invalid_limit = true;
           }
         if(!IsValidDrawdownLimit(InpMonthlyDDLimit))
           {
            Print("RiskManager initialization failed: InpMonthlyDDLimit must be a negative fraction greater than -1.0");
            invalid_limit = true;
           }
         if(!IsValidDrawdownLimit(InpDailyDDLimit))
           {
            Print("RiskManager initialization failed: InpDailyDDLimit must be a negative fraction greater than -1.0");
            invalid_limit = true;
           }
         if(invalid_limit)
            return(INIT_FAILED);

         if(!IsValidTradeExecutionInput())
           {
            Print("TradeExecutor initialization failed: invalid trade execution inputs");
            return(INIT_FAILED);
           }

         if(!m_profile.Init(InpExpectedSymbolFragment, InpExpectedAccountCurrency, InpRequireExpectedAccountCurrency))
           {
            Print("BrokerSymbolProfile initialization failed: ", m_profile.FailureReason());
            return(INIT_FAILED);
           }

         m_profile.PrintProfileMarker();

         m_risk.SetMagicNumber(InpMagicNumber);

         m_sig_breakout.Init();
         m_sig_breakout.SetUseH1EMAFilter(InpUseH1EMAFilter);
        m_sig_breakout.SetLookbackBars(InpBreakoutLookbackBars);
        m_sig_breakout.SetATRMin(InpBreakoutATRMin);
        m_sig_breakout.SetStopLossATRMultiplier(InpStopLossATRMultiplier);
        m_sig_breakout.SetTakeProfitATRMultiplier(InpTakeProfitATRMultiplier);
        m_sig_breakout.SetSessionHours(InpSessionStartHour, InpSessionEndHour);
        
       m_risk.SetGlobalDDLimit(InpGlobalDDLimit);
        m_risk.SetMonthlyDDLimit(InpMonthlyDDLimit);
       m_risk.SetDailyDDLimit(InpDailyDDLimit);
       m_risk.SetRiskPerTrade(0.005);
       m_risk.SetMaxSpreadPoints(InpMaxSpreadPoints);
       m_risk.SetTradeDeviationPoints(InpTradeDeviationPoints);
       m_risk.SetTradeMaxRetries(InpTradeMaxRetries);
       
       m_data.Init();
      
      return(INIT_SUCCEEDED);
     }
   
   //--- Main tick handler
    void OnTick()
      {
       ERiskState risk_state = m_risk.GetRiskState();
       if(risk_state == RISK_STATE_GLOBAL_STOP)
         {
          if(InpEnableGlobalEmergencyClose && m_risk.HasPendingGlobalEmergencyClose())
             m_risk.CloseAllPositionsForCurrentSymbol();
          return;
         }

       if(risk_state == RISK_STATE_DAILY_STOP || risk_state == RISK_STATE_MONTHLY_STOP)
          return;

       if(!m_risk.CanOpenNewPosition())
          return;

       // 1. Evaluate breakout-only validation flow
       double breakout_score = m_sig_breakout.Evaluate();
       
       if(m_risk.HasOpenPositionForCurrentSymbol())
          return;
       
       // 3. Position management
       if(MathAbs(breakout_score) > 0.7)
          {
         double entry=0, sl=0, tp=0;
         ENUM_ORDER_TYPE type = ORDER_TYPE_BUY;
          
         if(m_sig_breakout.CheckEntrySignal(entry, sl, tp))
            {
            type = (breakout_score > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
            double sl_distance = MathAbs(entry - sl);
            double lot = m_risk.CalculateLotFromSLDistance(type, entry, sl_distance);
            if(lot <= 0)
               return;

            m_risk.PlaceOrder(type, lot, entry, sl, tp);
           }
         }
     }
   
   //--- Cleanup
   void OnDeinit(const int reason)
     {
      // Cleanup resources
     }

private:
   bool IsValidDrawdownLimit(double limit)
     {
      return limit < 0.0 && limit > -1.0;
     }

   bool IsValidTradeExecutionInput()
     {
      return InpMaxSpreadPoints > 0 && InpTradeDeviationPoints >= 0 && InpTradeMaxRetries > 0;
     }
    };

//+------------------------------------------------------------------+
//| Global expert instance                                            |
//+------------------------------------------------------------------+
CExpertAdvisor expert;

//+------------------------------------------------------------------+
//| Expert initialization function                                    |
//+------------------------------------------------------------------+
int OnInit()
  {
   return(expert.OnInit());
  }

//+------------------------------------------------------------------+
//| Expert deinitialization function                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   expert.OnDeinit(reason);
  }

//+------------------------------------------------------------------+
//| Expert tick function                                              |
//+------------------------------------------------------------------+
void OnTick()
  {
   expert.OnTick();
  }
//+------------------------------------------------------------------+
