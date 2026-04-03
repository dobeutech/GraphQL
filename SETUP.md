# Conversation Network Visualization — Setup Guide

## Prerequisites

- **Docker & Docker Compose** (required for full stack)
- **Node.js 18+** (for local server/client development)
- **Python 3.9+** (for clustering service)
- **16 GB RAM minimum** (32 GB recommended for large datasets)
- **50 GB disk space** (for Neo4j, Qdrant storage, and ML models)

---

## Step 1: Create the Project Structure

The source files in this repo are design artifacts at the root level. Organize them into the expected directory layout:

```bash
mkdir -p server client/src clustering nginx/ssl grafana/dashboards grafana/datasources prometheus
```

## Step 2: Place Source Files

Copy each file into its target directory:

| Source File (root)                  | Destination                          |
|-------------------------------------|--------------------------------------|
| `graphql-conversation-network.js`   | `server/server.js`                   |
| `network-visualization-client.js`   | `client/src/index.js`                |
| `clustering-service.py`             | `clustering/clustering_service.py`   |

```bash
cp graphql-conversation-network.js server/server.js
cp network-visualization-client.js client/src/index.js
cp clustering-service.py clustering/clustering_service.py
```

## Step 3: Extract Package and Config Files

The file `package-dependencies.json` contains multiple embedded configs. You need to manually extract each section into its own file:

### Server package.json

Create `server/package.json`:

```json
{
  "name": "conversation-network-graphql",
  "version": "1.0.0",
  "description": "GraphQL API for conversation network visualization",
  "main": "server.js",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest"
  },
  "dependencies": {
    "@apollo/server": "^4.9.5",
    "@neo4j/graphql": "^5.3.1",
    "@qdrant/js-client-rest": "^1.7.0",
    "dataloader": "^2.2.2",
    "graphql": "^16.8.1",
    "mem0": "^0.1.0",
    "neo4j-driver": "^5.15.0",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.2",
    "jest": "^29.7.0",
    "@types/node": "^20.10.5"
  }
}
```

### Client package.json

Create `client/package.json`:

```json
{
  "name": "conversation-network-client",
  "version": "1.0.0",
  "description": "D3.js visualization for conversation network",
  "scripts": {
    "start": "webpack serve --mode development",
    "build": "webpack --mode production",
    "test": "jest"
  },
  "dependencies": {
    "@apollo/client": "^3.8.8",
    "d3": "^7.8.5",
    "graphql": "^16.8.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.4",
    "webpack-dev-server": "^4.15.1",
    "babel-loader": "^9.1.3",
    "@babel/core": "^7.23.6",
    "@babel/preset-env": "^7.23.6",
    "@babel/preset-react": "^7.23.3",
    "css-loader": "^6.8.1",
    "style-loader": "^3.3.3",
    "html-webpack-plugin": "^5.6.0"
  }
}
```

### Python requirements

Create `clustering/requirements.txt`:

```
flask==3.0.0
bertopic==0.16.0
sentence-transformers==2.2.2
scikit-learn==1.3.2
hdbscan==0.8.33
umap-learn==0.5.5
numpy==1.24.4
pandas==2.1.4
scipy==1.11.4
flask-cors==4.0.0
gunicorn==21.2.0
```

## Step 4: Create Dockerfiles

### Server Dockerfile

Create `server/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 4000
CMD ["node", "server.js"]
```

### Clustering Dockerfile

Create `clustering/Dockerfile`:

```dockerfile
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y gcc g++ && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the sentence-transformer model to avoid cold-start delays
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY . .
EXPOSE 8081
CMD ["gunicorn", "--bind", "0.0.0.0:8081", "--workers", "2", "--timeout", "300", "clustering_service:app"]
```

### Client Dockerfile

Create `client/Dockerfile`:

```dockerfile
FROM node:20-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

## Step 5: Create Nginx Config

Create `nginx/nginx.conf`:

```nginx
events {
    worker_connections 1024;
}

http {
    upstream graphql {
        server graphql-server:4000;
    }

    upstream client {
        server web-client:80;
    }

    server {
        listen 80;
        server_name localhost;

        location / {
            proxy_pass http://client;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        location /graphql {
            proxy_pass http://graphql;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

        location /ws {
            proxy_pass http://graphql;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
```

## Step 6: Create Prometheus Config

Create `prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'neo4j'
    static_configs:
      - targets: ['neo4j:2004']

  - job_name: 'graphql'
    static_configs:
      - targets: ['graphql-server:4000']
    metrics_path: '/metrics'

  - job_name: 'qdrant'
    static_configs:
      - targets: ['qdrant:6333']
    metrics_path: '/metrics'

  - job_name: 'clustering'
    static_configs:
      - targets: ['clustering-service:8081']
    metrics_path: '/metrics'
```

## Step 7: Create docker-compose.yml

Create `docker-compose.yml` in the project root. Copy the contents from `docker-compose-deployment.txt`, but **replace the placeholder password** first:

```bash
cp docker-compose-deployment.txt docker-compose.yml
```

## Step 8: Create the Environment File

Create `.env` in the project root:

```bash
# Neo4j
NEO4J_PASSWORD=<choose-a-strong-password>
NEO4J_MEMORY=4G

# GraphQL Server
GRAPHQL_PORT=4000
JWT_SECRET=<generate-a-random-secret>

# Qdrant
QDRANT_API_KEY=<your-qdrant-api-key>

# Mem0
MEM0_API_KEY=<your-mem0-api-key>

# OpenAI (optional — only needed if not using local sentence-transformers)
OPENAI_API_KEY=<your-openai-key>
```

Then update `docker-compose.yml` to reference these variables instead of hardcoded values. Replace occurrences of `your-password-here` with `${NEO4J_PASSWORD}`.

## Step 9: Launch the Stack

```bash
docker-compose up -d
```

Wait for all containers to reach healthy status:

```bash
docker-compose ps
```

Watch logs for errors:

```bash
docker-compose logs -f
```

## Step 10: Initialize Neo4j Indexes

Connect to Neo4j and create required indexes:

```bash
docker exec -it neo4j-conversation cypher-shell -u neo4j -p <your-password>
```

Run these Cypher commands:

```cypher
CREATE INDEX topic_cluster_id IF NOT EXISTS FOR (n:TopicCluster) ON (n.id);
CREATE INDEX query_node_id IF NOT EXISTS FOR (n:QueryNode) ON (n.id);
CREATE INDEX response_node_id IF NOT EXISTS FOR (n:ResponseNode) ON (n.id);
CREATE INDEX artifact_node_id IF NOT EXISTS FOR (n:ArtifactNode) ON (n.id);
CREATE INDEX source_node_id IF NOT EXISTS FOR (n:SourceNode) ON (n.id);

CREATE VECTOR INDEX topic_embeddings IF NOT EXISTS
FOR (n:TopicCluster)
ON (n.embedding)
OPTIONS {indexConfig: {
  `vector.dimensions`: 384,
  `vector.similarity_function`: 'cosine'
}};
```

Type `:exit` to leave the Cypher shell.

## Step 11: Initialize Qdrant Collections

Create the two required vector collections (384 dimensions to match the `all-MiniLM-L6-v2` model):

```bash
# Conversation embeddings collection
curl -X PUT 'http://localhost:6333/collections/conversation_embeddings' \
  -H 'Content-Type: application/json' \
  -d '{"vectors": {"size": 384, "distance": "Cosine"}}'

# Memory collection for Mem0
curl -X PUT 'http://localhost:6333/collections/conversation_memory' \
  -H 'Content-Type: application/json' \
  -d '{"vectors": {"size": 384, "distance": "Cosine"}}'
```

## Step 12: Verify All Services Are Running

| Service              | URL                          | What to Check                    |
|----------------------|------------------------------|----------------------------------|
| Web client           | http://localhost:3000         | Visualization loads (empty)      |
| GraphQL Playground   | http://localhost:4000/graphql | Interactive query editor opens   |
| Neo4j Browser        | http://localhost:7474         | Login with neo4j / your password |
| Qdrant Dashboard     | http://localhost:6333/dashboard | Shows 2 collections            |
| Clustering health    | http://localhost:8081/health  | Returns `{"status": "healthy"}`  |
| Grafana              | http://localhost:3001         | Login with admin / admin         |
| Prometheus           | http://localhost:9090         | Targets page shows scrape jobs   |

## Step 13: Import Your First Conversation Data

Open the GraphQL Playground at http://localhost:4000/graphql and run:

```graphql
mutation ImportConversation {
  createQuery(input: {
    content: "How do I implement OAuth in Node.js?",
    userId: "user123",
    threadId: "thread456"
  }) {
    id
    response {
      id
    }
  }
}
```

## Step 14: Run Clustering

After importing data, trigger topic clustering:

```graphql
mutation RunClustering {
  runClustering(parameters: {
    minClusterSize: 3
    minSamples: 2
    metricType: "cosine"
  }) {
    clustersCreated
    noisePoints
    silhouetteScore
    executionTime
  }
}
```

The visualization at http://localhost:3000 should now display your conversation clusters.

---

## Stopping the Stack

```bash
docker-compose down          # Stop and remove containers (data persists in volumes)
docker-compose down -v       # Stop and DELETE all data volumes (destructive)
```

## Troubleshooting

### Clustering service times out
Increase the timeout in `server/server.js` where the clustering endpoint is called, or give the container more memory in `docker-compose.yml`.

### Neo4j won't start
Check logs with `docker logs neo4j-conversation`. Common cause: not enough memory allocated. Ensure your machine has at least 8 GB free for Neo4j heap + pagecache.

### Qdrant collection creation fails
Ensure Qdrant is fully booted before running the curl commands. Wait 10-15 seconds after `docker-compose up` or check `docker logs qdrant-conversation`.

### Visualization is empty after clustering
Query the API to confirm data exists:
```bash
curl http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query": "{ allClusters { id name } }"}'
```
If empty, re-run the `runClustering` mutation.
