# Conversation Network Visualization

A GraphQL-powered system that clusters conversation history into topics and renders them as an interactive force-directed graph.

![Stack](https://img.shields.io/badge/GraphQL-Apollo_Server-blueviolet)
![Stack](https://img.shields.io/badge/Graph_DB-Neo4j-blue)
![Stack](https://img.shields.io/badge/Vectors-Qdrant-red)
![Stack](https://img.shields.io/badge/ML-BERTopic-green)
![Stack](https://img.shields.io/badge/Viz-D3.js-orange)

## Architecture

```
Browser (D3.js + Apollo Client)
        │
        ▼
   Nginx (port 80)
    ┌────┴────┐
    ▼         ▼
 Client    Apollo Server (GraphQL, port 4000)
 (port 80)   │       │        │
             Neo4j  Redis   Qdrant
            (graph) (cache) (vectors)
                              │
               Clustering Service (Flask, port 8081)
               BERTopic + HDBSCAN + sentence-transformers
```

## Features

- **Automatic Topic Discovery** — BERTopic + HDBSCAN clustering identifies conversation themes
- **Multi-dimensional Relationships** — Semantic (60%), temporal (30%), and co-occurrence (10%) weighted edges
- **Interactive Visualization** — D3.js force-directed graph with zoom, search, and filtering
- **Semantic Search** — Qdrant vector database with `all-MiniLM-L6-v2` embeddings (384 dims)
- **Three View Modes** — Cluster, Temporal, and Hierarchical layouts
- **Production Stack** — Docker Compose with health checks, nginx reverse proxy, optional Prometheus + Grafana monitoring

## Quick Start

```bash
# 1. Clone
git clone https://github.com/dobeutech/GraphQL.git
cd GraphQL

# 2. Configure
cp .env.example .env
# Edit .env — at minimum set NEO4J_PASSWORD and JWT_SECRET

# 3. Launch
docker compose up -d

# 4. Wait for health
docker compose ps   # all services should show "healthy"

# 5. Initialize vector collections
curl -X PUT 'http://localhost:6333/collections/conversation_embeddings' \
  -H 'Content-Type: application/json' \
  -d '{"vectors": {"size": 384, "distance": "Cosine"}}'

curl -X PUT 'http://localhost:6333/collections/conversation_memory' \
  -H 'Content-Type: application/json' \
  -d '{"vectors": {"size": 384, "distance": "Cosine"}}'

# 6. Initialize Neo4j indexes
docker exec -it neo4j-conversation cypher-shell -u neo4j -p "$NEO4J_PASSWORD" \
  "CREATE INDEX topic_cluster_id IF NOT EXISTS FOR (n:TopicCluster) ON (n.id);
   CREATE INDEX query_node_id IF NOT EXISTS FOR (n:QueryNode) ON (n.id);
   CREATE INDEX response_node_id IF NOT EXISTS FOR (n:ResponseNode) ON (n.id);
   CREATE INDEX artifact_node_id IF NOT EXISTS FOR (n:ArtifactNode) ON (n.id);
   CREATE INDEX source_node_id IF NOT EXISTS FOR (n:SourceNode) ON (n.id);"
```

## Access Points

| Service            | URL                          |
|--------------------|------------------------------|
| Visualization      | http://localhost              |
| GraphQL Playground | http://localhost:4000/graphql |
| Health Check       | http://localhost:4000/health  |
| Neo4j Browser      | http://localhost:7474         |
| Qdrant Dashboard   | http://localhost:6333/dashboard |

## Import Data

Open the GraphQL Playground and run:

```graphql
mutation {
  createQuery(input: {
    content: "How do I implement OAuth in Node.js?"
    userId: "user123"
  }) {
    id
  }
}
```

Then trigger clustering:

```graphql
mutation {
  runClustering(parameters: { minClusterSize: 3, minSamples: 2 }) {
    clustersCreated
    silhouetteScore
  }
}
```

## Monitoring (Optional)

```bash
docker compose --profile monitoring up -d
```

- **Grafana**: http://localhost:3001 (admin / admin)
- **Prometheus**: http://localhost:9090

## Local Development

```bash
# Server
cd server && npm install && npm run dev

# Client
cd client && npm install && npm start

# Clustering
cd clustering && pip install -r requirements.txt && python clustering_service.py
```

## Project Structure

```
├── server/              GraphQL API (Apollo Server + Neo4j + Qdrant)
├── client/              D3.js visualization (webpack build)
├── clustering/          Python clustering service (BERTopic + HDBSCAN)
├── nginx/               Reverse proxy config
├── prometheus/          Metrics scraping config
├── grafana/             Dashboard provisioning
├── docker-compose.yml   Full stack orchestration
└── .env.example         Environment variable template
```

## License

MIT
