import sqlite3
import os
from datetime import datetime, timedelta
import random

def seed_metrics():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    metrics_dir = os.path.join(base_dir, "swarm", "metrics")
    state_dir = os.path.join(base_dir, "swarm", "state")
    
    os.makedirs(metrics_dir, exist_ok=True)
    os.makedirs(state_dir, exist_ok=True)
    
    model_db = os.path.join(metrics_dir, "model_performance.db")
    state_db = os.path.join(state_dir, "swarm_state.db")
    
    # Models to seed
    models = [
        "google/gemini-2.5-flash",
        "google/gemini-3-flash",
        "google/gemini-3-pro-preview",
        "anthropic/claude-3-5-sonnet-20241022",
        "anthropic/claude-3-5-haiku-20241022",
        "openai/gpt-5.2",
        "openai/gpt-5.1-codex",
        "deepseek/deepseek-reasoner-r1",
        "opencode/grok-code"
    ]
    
    tasks = ["planning", "coding", "debugging", "documentation", "testing", "refactoring"]
    
    # 1. Seed model_performance.db
    conn = sqlite3.connect(model_db)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS task_outcomes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            model TEXT,
            task_type TEXT,
            complexity TEXT,
            success BOOLEAN,
            duration_ms INTEGER,
            cost_usd REAL,
            error_category TEXT,
            files_touched TEXT,
            worker_template TEXT,
            epic_id TEXT,
            notes TEXT
        )
    """)
    
    # Clear existing
    cur.execute("DELETE FROM task_outcomes")
    
    now = datetime.now()
    for i in range(100):
        ts = (now - timedelta(minutes=random.randint(1, 1440))).isoformat()
        model = random.choice(models)
        task = random.choice(tasks)
        success = 1 if random.random() > 0.15 else 0
        duration = random.randint(500, 15000)
        cost = random.uniform(0.0001, 0.05)
        
        cur.execute("""
            INSERT INTO task_outcomes (timestamp, model, task_type, success, duration_ms, cost_usd)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (ts, model, task, success, duration, cost))
    
    conn.commit()
    conn.close()
    
    # 2. Seed routing_decisions in swarm_state.db
    conn = sqlite3.connect(state_db)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS routing_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            task_type TEXT,
            available_models TEXT,
            selected_model TEXT,
            selection_reason TEXT,
            confidence_score REAL
        )
    """)
    
    # Clear existing
    cur.execute("DELETE FROM routing_decisions")
    
    decisions = [
        (now.isoformat(), "planning", '["google/gemini-2.5-flash", "google/gemini-3-pro-preview", "openai/gpt-5.2", "deepseek/deepseek-reasoner-r1"]', "deepseek/deepseek-reasoner-r1", "100% success rate on complex reasoning tasks in benchmarks.", 0.95),
        ((now - timedelta(minutes=5)).isoformat(), "coding", '["google/gemini-2.5-flash", "google/gemini-3-flash", "anthropic/claude-3-5-haiku-20241022"]', "google/gemini-2.5-flash", "High speed and low cost for straightforward coding tasks.", 0.9),
        ((now - timedelta(minutes=10)).isoformat(), "coding", '["google/gemini-2.5-flash", "google/gemini-3-flash"]', "google/gemini-2.5-flash", "Efficient for UI layout modifications.", 0.9),
        ((now - timedelta(minutes=15)).isoformat(), "integration", '["opencode/grok-code", "google/gemini-2.5-flash"]', "opencode/grok-code", "Simplest task, perfect for free-tier model.", 0.95)
    ]
    
    cur.executemany("""
        INSERT INTO routing_decisions (timestamp, task_type, available_models, selected_model, selection_reason, confidence_score)
        VALUES (?, ?, ?, ?, ?, ?)
    """, decisions)
    
    conn.commit()
    conn.close()
    print("Metrics seeded successfully.")

if __name__ == "__main__":
    seed_metrics()
