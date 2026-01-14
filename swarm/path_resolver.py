import os

def get_db_path(db_name, preferred_dir="metrics"):
    """
    Resolve the absolute path to a database file.
    Favors swarm/state/ or swarm/metrics/ based on preferred_dir.
    """
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # Try preferred directory first
    pref_path = os.path.join(base_dir, "swarm", preferred_dir, db_name)
    if os.path.exists(pref_path):
        return pref_path
    
    # Check alternate common locations
    alts = ["metrics", "state", "data"]
    for alt in alts:
        alt_path = os.path.join(base_dir, "swarm", alt, db_name)
        if os.path.exists(alt_path):
            return alt_path
            
    # Default to preferred directory even if not exists yet
    full_pref_dir = os.path.join(base_dir, "swarm", preferred_dir)
    if not os.path.exists(full_pref_dir):
        os.makedirs(full_pref_dir, exist_ok=True)
    return pref_path
