# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Conversation Network Visualization — a GraphQL-powered system that clusters conversation history into topics and renders them as an interactive force-directed graph.

## Architecture

```
Browser (D3.js + Apollo Client)
        |
        v
   Nginx (port 80)  ──  reverse proxy + rate limiting
    |          |
 Client    Apollo Server (Express + GraphQL, port 4000)
 (static)    |       |        |
           Neo4j   Redis    Qdrant
          (graph)  (cache)  (vectors)
                              |
              Clustering Service (Flask/Gunicorn, port 8081)
              BERTopic + HDBSCAN + sentence-transformers
```

**Data flow:** Conversations ingested via `createQuery` mutation -> stored in Neo4j -> embeddings generated via clustering service (`all-MiniLM-L6-v2`, 384 dims) -> stored in Qdrant -> `runClustering` triggers HDBSCAN via Flask -> cluster nodes + `RELATED_TO` edges written to Neo4j -> client fetches via GraphQL and renders with D3.

**Relationship weights:** 60% semantic similarity (cosine on centroids) + 30% temporal proximity (exponential decay) + 10% co-occurrence frequency.

## Key Files

| File | Role |
|------|------|
| `server/server.js` | Express + Apollo Server: GraphQL schema, resolvers, Neo4j/Qdrant integration, `/health` endpoint |
| `client/src/index.js` | D3.js `ConversationNetworkViz` class: force simulation, control panel, search, view modes |
| `client/webpack.config.js` | Webpack build config with dev proxy to GraphQL server |
| `clustering/clustering_service.py` | Flask app: `ConversationClusterer` (BERTopic/HDBSCAN), `RelationshipCalculator`, REST endpoints |
| `docker-compose.yml` | Full stack with health checks; monitoring behind `--profile monitoring` |
| `nginx/nginx.conf` | Reverse proxy with rate limiting and security headers |

## Build & Run

### Full stack (Docker)
```bash
cp .env.example .env         # Configure passwords/secrets
docker compose up -d          # Core services
docker compose --profile monitoring up -d  # Include Grafana + Prometheus
docker compose ps             # Verify health
docker compose logs -f        # Tail logs
```

### Server (local dev)
```bash
cd server && npm install && npm run dev   # Express + Apollo on port 4000
```

### Client (local dev)
```bash
cd client && npm install && npm start     # webpack-dev-server on port 3000, proxies /graphql to :4000
```

### Clustering service (local dev)
```bash
cd clustering && pip install -r requirements.txt && python clustering_service.py   # Flask on port 8081
```

## Service Ports

| Service | Port |
|---------|------|
| Nginx proxy | 80/443 |
| GraphQL API | 4000 |
| Neo4j HTTP / Bolt | 7474 / 7687 |
| Qdrant HTTP / gRPC | 6333 / 6334 |
| Redis | 6379 |
| Clustering service | 8081 |
| Prometheus | 9090 |
| Grafana | 3001 |

## GraphQL API

**Queries:** `allClusters`, `topicCluster(id)`, `searchClusters(query)`, `semanticSearch(query, collection)`, `conversationTimeline`, `shortestPath`, `networkMetrics`

**Mutations:** `createQuery(input)`, `runClustering(parameters)`, `storeInQdrant(nodeId, collection)`, `calculateRelationships(threshold)`, `updateClusterEmbeddings`

**Health:** `GET /health` — probes Neo4j, Qdrant, and clustering service; returns 200/503.

## Clustering REST Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/cluster` | POST | Run HDBSCAN clustering on texts/embeddings |
| `/embeddings` | POST | Generate sentence-transformer embeddings |
| `/relationships` | POST | Calculate inter-cluster edge weights |
| `/update-topics` | POST | Incremental topic model update |
| `/health` | GET | Health check |

## Neo4j Graph Schema

**Node labels:** `TopicCluster`, `QueryNode`, `ResponseNode`, `ArtifactNode`, `SourceNode`

**Key relationships:** `CONTAINS_QUERY`, `CONTAINS_RESPONSE`, `ANSWERED_BY`, `FOLLOWS`, `RELATED_TO` (weighted), `SUBCATEGORY_OF`, `GENERATED`, `CITED`, `DERIVED_FROM`

## Environment Variables

See `.env.example` for the full list. Key variables:
```
NEO4J_PASSWORD, JWT_SECRET          # required
QDRANT_API_KEY, OPENAI_API_KEY      # optional
```

## Important Implementation Details

- Embedding model is `all-MiniLM-L6-v2` (384 dimensions). Qdrant collections must match this vector size.
- Server uses `@neo4j/graphql` for auto-generated CRUD resolvers; custom resolvers handle semantic search, clustering, and analytics.
- `DataLoader` batches Neo4j and Qdrant reads to avoid N+1 queries.
- Clustering Dockerfile pre-downloads the sentence-transformer model at build time to avoid cold starts.
- Neo4j requires GDS and APOC plugins for the `networkMetrics` resolver (clustering coefficient, modularity).
- Client uses `d3.forceSimulation` with four forces: link, charge (-500), center, and collision.
- The `mem0` JS SDK is not available; memory features are stubbed. Use the Python Mem0 SDK via the clustering service if needed.

## Initial Setup (post-clone)

1. `cp .env.example .env` and set `NEO4J_PASSWORD` + `JWT_SECRET`
2. `docker compose up -d`
3. Create Qdrant collections with 384-dim cosine vectors (`conversation_embeddings`, `conversation_memory`)
4. Create Neo4j indexes on all node label `.id` fields
5. Create Neo4j vector index on `TopicCluster.embedding` (384 dims, cosine)
