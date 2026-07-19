"""Fixed labeled dataset. DO NOT edit — part of the evaluation contract.

Each query has a list of documents; `relevant` lists the indices (into that
query's document list) that are on-topic. The distractors deliberately repeat
common query words (e.g. "training", "system", "change") so that a naive
term-frequency ranker is fooled and IDF / length-normalization is needed.
"""

DATASET = [
    {
        "query": "neural network training optimization",
        "docs": [
            "Adam optimizer improves neural network training convergence.",
            "Training training training a dog needs patience and repetition.",
            "Gradient methods optimize deep neural networks effectively.",
            "The optimization of a supply chain network for a retail system.",
            "Learning rate schedules stabilize training of large networks.",
            "Marathon training optimization for amateur runners.",
        ],
        "relevant": [0, 2, 4],
    },
    {
        "query": "climate change ocean temperature",
        "docs": [
            "Rising ocean temperature accelerates coral reef bleaching.",
            "A change of ocean liner itinerary due to a schedule change.",
            "Warming of deep ocean water is driven by climate change.",
            "Temperature change in a home oven affects baking outcomes.",
            "Ocean heat content indicates long-term climate change.",
            "Political change and its effect on ocean shipping tariffs.",
        ],
        "relevant": [0, 2, 4],
    },
    {
        "query": "distributed database consistency",
        "docs": [
            "Raft provides consensus for a distributed database.",
            "The consistency of a distributed team's daily standup habits.",
            "Eventual consistency trades latency in database systems.",
            "A distributed network of food banks improves consistency of aid.",
            "Strong consistency in a distributed database needs coordination.",
            "Database of consistency ratings for concrete mixtures.",
        ],
        "relevant": [0, 2, 4],
    },
    {
        "query": "immune system vaccine response",
        "docs": [
            "Vaccines prime the immune system against pathogens.",
            "A rapid response system for the office fire alarm.",
            "The adaptive immune response builds memory after a vaccine.",
            "System response time is critical for a web service.",
            "T cells drive the immune response following vaccination.",
            "An emergency response system for a hospital immune to downtime.",
        ],
        "relevant": [0, 2, 4],
    },
    {
        "query": "renewable solar energy storage",
        "docs": [
            "Battery storage smooths output from solar renewable energy.",
            "Energy drinks and their storage in a cold warehouse.",
            "Grid-scale storage is key to renewable solar adoption.",
            "The storage of solar eclipse photographs on a hard drive.",
            "Solar panels paired with storage boost renewable energy use.",
            "Renewable enthusiasm for a storage unit clearance sale.",
        ],
        "relevant": [0, 2, 4],
    },
]
