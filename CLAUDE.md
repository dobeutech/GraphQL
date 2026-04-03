# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Conversation Network Visualization — a GraphQL-powered system that clusters conversation history into topics and renders them as an interactive force-directed graph. Not yet structured as a mono-repo with separate directories; all source files currently live at the root as design artifacts.

## Architecture

```
Browser (D3.js + Apollo Client)
        |
        v
Apollo Server (GraphQL API, port 4000)
   |       |        |          |
Neo4j    Redis    Qdrant     Mem0
(graph)  (cache)  (vectors)  (memory)
                     |
        Clustering Service (Flask, port 8081)
        BERTopic + HDBSCAN + sentence-transformers
```

**Data flow:** Conversations are ingested via `createQuery` mutation -> stored in Neo4j as graph nodes -> embeddings generated via clustering service (`all-MiniLM-L6-v2`, 384 dimensions) -> stored in Qdrant -> `runClustering` mutation triggers HDBSCAN via the Flask service -> cluster nodes and `RELATED_TO` edges written back to Neo4j -> client fetches via GraphQL and renders with D3.

**Relationship weights:** Edges between clusters use a weighted formula: 60% semantic similarity (cosine on centroids) + 30% temporal proximity (exponential decay) + 10% co-occurrence frequency.

## Key Files

| File | Role |
|------|------|
| `graphql-conversation-network.js` | Apollo Server: GraphQL schema (typeDefs), resolvers, Neo4j/Qdrant/Mem0 integration |
| `network-visualization-client.js` | D3.js `ConversationNetworkViz` class: force simulation, control panel, search, view modes |
| `clustering-service.py` | Flask app: `ConversationClusterer` (BERTopic/HDBSCAN), `RelationshipCalculator`, REST endpoints |
| `docker-compose-deployment.txt` | Docker Compose stack (Neo4j, Qdrant, Redis, clustering, GraphQL, client, nginx, Grafana, Prometheus) |
| `package-dependencies.json` | Contains both server and client package.json, Python requirements.txt, Dockerfiles, nginx/prometheus configs |

## Build & Run

### Full stack (Docker)
```bash
docker-compose up -d        # Start all services
docker-compose ps            # Verify health
docker-compose logs -f       # Tail logs
```

### Server (local dev)
```bash
cd server
npm install
npm run dev                  # nodemon on port 4000
npm test                     # jest
```

### Client (local dev)
```bash
cd client
npm install
npm start                    # webpack-dev-server
npm run build                # production bundle
npm test                     # jest
```

### Clustering service (local dev)
```bash
cd clustering
pip install -r requirements.txt
python clustering_service.py                     # Flask dev server on port 8081
gunicorn --bind 0.0.0.0:8081 --workers 2 --timeout 300 clustering_service:app  # production
```

## Service Ports

| Service | Port |
|---------|------|
| Nginx proxy | 80/443 |
| Web client | 3000 |
| GraphQL API | 4000 |
| Neo4j HTTP / Bolt | 7474 / 7687 |
| Qdrant HTTP / gRPC | 6333 / 6334 |
| Redis | 6379 |
| Clustering service | 8081 |
| Prometheus | 9090 |
| Grafana | 3001 |

## GraphQL API

**Queries:** `allClusters`, `topicCluster(id)`, `searchClusters(query)`, `semanticSearch(query, collection)`, `conversationTimeline`, `shortestPath`, `networkMetrics`

**Mutations:** `createQuery(input)`, `runClustering(parameters)`, `storeInQdrant(nodeId, collection)`, `saveToMem0(content, userId)`, `calculateRelationships(threshold)`, `updateClusterEmbeddings`

**Graph Playground:** http://localhost:4000/graphql

## Clustering REST Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/cluster` | POST | Run HDBSCAN clustering on texts/embeddings |
| `/embeddings` | POST | Generate sentence-transformer embeddings |
| `/relationships` | POST | Calculate inter-cluster edge weights |
| `/update-topics` | POST | Incremental topic model update |
| `/health` | GET | Health check |

## Graph Schema (Neo4j node labels)

`TopicCluster`, `QueryNode`, `ResponseNode`, `ArtifactNode`, `SourceNode`

Key relationships: `CONTAINS_QUERY`, `CONTAINS_RESPONSE`, `ANSWERED_BY`, `FOLLOWS`, `RELATED_TO` (weighted), `SUBCATEGORY_OF`, `GENERATED`, `CITED`, `DERIVED_FROM`

## Environment Variables

```
NEO4J_URI, NEO4J_PASSWORD
QDRANT_URL, QDRANT_API_KEY
MEM0_API_KEY
JWT_SECRET
OPENAI_API_KEY          # optional, for non-local embeddings
REDIS_URL
CLUSTERING_SERVICE_URL
```

## Important Implementation Details

- Embedding model is `all-MiniLM-L6-v2` (384 dimensions). Qdrant collections must match this vector size.
- The server uses `@neo4j/graphql` which auto-generates CRUD resolvers from the schema; custom resolvers handle semantic search, clustering, and analytics.
- `DataLoader` is used for batching Neo4j and Qdrant reads to avoid N+1 queries.
- The clustering service downloads the sentence-transformer model at Docker build time to avoid cold-start delays.
- Neo4j requires GDS (Graph Data Science) and APOC plugins for `networkMetrics` resolver (clustering coefficient, modularity).
- The visualization client uses `d3.forceSimulation` with four forces: link, charge (-500), center, and collision.
- The project is currently a set of design artifacts at root level. To run, files need to be organized into `server/`, `client/`, `clustering/`, `nginx/`, `prometheus/`, `grafana/` directories as described in the deployment guide.

## Initial Setup (post-clone)

1. Create Qdrant collections with 384-dimension cosine vectors (`conversation_embeddings`, `conversation_memory`)
2. Create Neo4j indexes on `TopicCluster.id`, `QueryNode.id`, `ResponseNode.id`, `ArtifactNode.id`, `SourceNode.id`
3. Create Neo4j vector index on `TopicCluster.embedding` (384 dims, cosine)
