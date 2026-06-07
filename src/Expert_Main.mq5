//+------------------------------------------------------------------+
//|                                              Expert_Main.mq5     |
//|                                  opencode-trade EA               |
//+------------------------------------------------------------------+
#property copyright "opencode-trade"
#property version   "1.00"

#include "Include/TradeLogic.mqh"
#include "Include/RiskManagement.mqh"
#include "Include/DataFeed.mqh"

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
   //--- Initialization
   int OnInit()
     {
      m_sig_breakout.Init();
      m_sig_pullback.Init();
      m_sig_ml.Init();
      
      m_risk.SetGlobalDDLimit(-0.25);
      m_risk.SetMonthlyDDLimit(-0.20);
      m_risk.SetDailyDDLimit(-0.03);
      
      m_data.Init();
      
      return(INIT_SUCCEEDED);
     }
   
   //--- Main tick handler
   void OnTick()
     {
      // 1. Evaluate signals
      double breakout_score = m_sig_breakout.Evaluate();
      double pullback_score = m_sig_pullback.Evaluate();
      double ml_score = m_sig_ml.Evaluate();
      
      // 2. Risk check
      if(!m_risk.IsHealthy())
         return;
      
      // 3. Position management
      double best_score = MathMax(breakout_score, MathMax(pullback_score, ml_score));
      
      if(m_risk.CanEnter() && best_score > 0.7)
        {
         double lot = m_risk.CalculateLot();
         if(breakout_score == best_score)
            m_sig_breakout.PlaceOrder(lot, m_risk);
         else if(pullback_score == best_score)
            m_sig_pullback.PlaceOrder(lot, m_risk);
         else
            m_sig_ml.PlaceOrder(lot, m_risk);
        }
      
      // 4. Trailing stop
      m_risk.UpdateTrailingStop();
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
