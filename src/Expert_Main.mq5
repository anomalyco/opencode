//+------------------------------------------------------------------+
//|                                              Expert_Main.mq5     |
//|                                  opencode-trade EA               |
//+------------------------------------------------------------------+
#property copyright "opencode-trade"
#property version   "1.00"

#include "Include/TradeLogic.mqh"
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

         m_risk.SetMagicNumber(InpMagicNumber);

         m_sig_breakout.Init();
         m_sig_breakout.SetUseH1EMAFilter(InpUseH1EMAFilter);
        m_sig_breakout.SetLookbackBars(InpBreakoutLookbackBars);
        m_sig_breakout.SetATRMin(InpBreakoutATRMin);
        m_sig_breakout.SetStopLossATRMultiplier(InpStopLossATRMultiplier);
        m_sig_breakout.SetTakeProfitATRMultiplier(InpTakeProfitATRMultiplier);
        m_sig_breakout.SetSessionHours(InpSessionStartHour, InpSessionEndHour);
        
       m_risk.SetGlobalDDLimit(-0.25);
      m_risk.SetMonthlyDDLimit(-0.20);
      m_risk.SetDailyDDLimit(-0.03);
      m_risk.SetRiskPerTrade(0.005);
      
      m_data.Init();
      
      return(INIT_SUCCEEDED);
     }
   
   //--- Main tick handler
   void OnTick()
     {
      // 1. Evaluate breakout-only validation flow
      double breakout_score = m_sig_breakout.Evaluate();
      
      // 2. Risk check
      if(!m_risk.IsHealthy())
         return;
      
      if(m_risk.HasOpenPositionForCurrentSymbol())
         return;
      
      // 3. Position management
      if(m_risk.CanEnter() && MathAbs(breakout_score) > 0.7)
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
