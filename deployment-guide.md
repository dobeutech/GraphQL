# Conversation Network Visualization - Complete Deployment Guide

## Overview

This system creates an interactive neural network visualization of your conversation history with Claude, featuring:
- **BERTopic + HDBSCAN** clustering for automatic topic discovery
- **GraphQL API** with Apollo Server and Neo4j integration
- **Qdrant** vector database for semantic search
- **Mem0** intelligent memory layer
- **D3.js** interactive visualization with multiple view modes

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend (D3.js)                    │
│                   Interactive Visualization              │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                 GraphQL API (Apollo Server)              │
│                    Schema + Resolvers                    │
└──────┬──────────┬────────────┬─────────────┬───────────┘
       │          │            │             │
┌──────▼────┐ ┌──▼──┐ ┌───────▼──────┐ ┌───▼────┐
│  Neo4j    │ │Redis│ │   Qdrant     │ │ Mem0   │
│Graph DB   │ │Cache│ │Vector Search │ │Memory  │
└───────────┘ └─────┘ └──────────────┘ └────────┘
                         │
              ┌──────────▼──────────┐
              │ Clustering Service  │
              │ BERTopic + HDBSCAN  │
              └────────────────────┘
```

## Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local development)
- Python 3.9+ (for clustering service)
- 16GB RAM minimum (recommended 32GB for large conversation histories)
- 50GB available disk space

## Quick Start

### 1. Clone and Setup

```bash
# Create project structure
mkdir conversation-network
cd conversation-network

# Create directories
mkdir -p server client clustering nginx/ssl grafana prometheus

# Copy the provided files
# - server.js → server/
# - clustering_service.py → clustering/
# - conversation-network-viz.js → client/
# - docker-compose.yml → ./
```

### 2. Environment Configuration

Create `.env` file in the root directory:

```bash
# Neo4j
NEO4J_PASSWORD=your-secure-password
NEO4J_MEMORY=4G

# GraphQL Server
GRAPHQL_PORT=4000
JWT_SECRET=your-jwt-secret

# Qdrant
QDRANT_API_KEY=your-api-key

# Mem0
MEM0_API_KEY=your-mem0-key

# OpenAI (for embeddings if not using local models)
OPENAI_API_KEY=your-openai-key
```

### 3. Initialize Services

```bash
# Start all services
docker-compose up -d

# Wait for services to be healthy
docker-compose ps

# Initialize Neo4j indexes
docker exec -it neo4j-conversation cypher-shell -u neo4j -p your-password-here
```

Run these Cypher commands in Neo4j:

```cypher
// Create indexes for better performance
CREATE INDEX topic_cluster_id IF NOT EXISTS FOR (n:TopicCluster) ON (n.id);
CREATE INDEX query_node_id IF NOT EXISTS FOR (n:QueryNode) ON (n.id);
CREATE INDEX response_node_id IF NOT EXISTS FOR (n:ResponseNode) ON (n.id);
CREATE INDEX artifact_node_id IF NOT EXISTS FOR (n:ArtifactNode) ON (n.id);
CREATE INDEX source_node_id IF NOT EXISTS FOR (n:SourceNode) ON (n.id);

// Create vector index for semantic search
CREATE VECTOR INDEX topic_embeddings IF NOT EXISTS
FOR (n:TopicCluster) 
ON (n.embedding) 
OPTIONS {indexConfig: {
  `vector.dimensions`: 384,
  `vector.similarity_function`: 'cosine'
}};
```

### 4. Initialize Qdrant Collections

```bash
# Create conversation embeddings collection
curl -X PUT 'http://localhost:6333/collections/conversation_embeddings' \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 384,
      "distance": "Cosine"
    }
  }'

# Create memory collection for Mem0
curl -X PUT 'http://localhost:6333/collections/conversation_memory' \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 384,
      "distance": "Cosine"
    }
  }'
```

## Data Import

### Import Existing Conversation History

Create `import-conversations.js`:

```javascript
import { ApolloClient, InMemoryCache, gql } from '@apollo/client';
import fs from 'fs';

const client = new ApolloClient({
  uri: 'http://localhost:4000/graphql',
  cache: new InMemoryCache()
});

async function importConversations() {
  // Load your conversation history (adjust path)
  const conversations = JSON.parse(
    fs.readFileSync('./conversation-history.json', 'utf8')
  );
  
  for (const conv of conversations) {
    // Create query node
    const { data } = await client.mutate({
      mutation: gql`
        mutation CreateQuery($input: CreateQueryInput!) {
          createQuery(input: $input) {
            id
          }
        }
      `,
      variables: {
        input: {
          content: conv.query,
          threadId: conv.threadId,
          userId: conv.userId || 'default',
          timestamp: conv.timestamp
        }
      }
    });
    
    console.log(`Imported query: ${data.createQuery.id}`);
  }
  
  // Run clustering after import
  await client.mutate({
    mutation: gql`
      mutation RunClustering {
        runClustering(parameters: {
          minClusterSize: 5,
          minSamples: 3
        }) {
          clustersCreated
          silhouetteScore
        }
      }
    `
  });
}

importConversations().catch(console.error);
```

## Usage

### Access the Visualization

1. Open browser to `http://localhost:3000`
2. The network will automatically load and display your conversation clusters
3. Use the control panel to:
   - Filter by date range
   - Adjust similarity threshold
   - Switch between view modes (Cluster/Temporal/Hierarchical)
   - Search for specific topics

### GraphQL Playground

Access GraphQL playground at `http://localhost:4000/graphql`

Example queries:

```graphql
# Get all clusters with their relationships
query GetNetwork {
  allClusters(limit: 50) {
    id
    name
    keywords
    messageCount
    relatedClusters(minSimilarity: 0.6) {
      id
      name
      clusterScore
    }
  }
}

# Semantic search
query Search {
  semanticSearch(
    query: "machine learning"
    collection: "conversation_embeddings"
    limit: 10
  ) {
    results {
      id
      content
      score
    }
  }
}
```

## Production Deployment

### 1. SSL/TLS Configuration

Update `nginx/nginx.conf`:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    
    location / {
        proxy_pass http://web-client:80;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
    
    location /graphql {
        proxy_pass http://graphql-server:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
```

### 2. Scaling Considerations

For large conversation histories (>100k messages):

1. **Neo4j Tuning**:
   ```yaml
   NEO4J_dbms_memory_heap_max__size=8G
   NEO4J_dbms_memory_pagecache_size=4G
   ```

2. **Qdrant Optimization**:
   - Use mmap storage for large datasets
   - Enable WAL for persistence
   - Configure appropriate shard count

3. **Clustering Service**:
   - Use GPU acceleration for embeddings
   - Implement batch processing
   - Cache computed embeddings

### 3. Monitoring

Access monitoring dashboards:
- Grafana: `http://localhost:3001` (admin/admin)
- Prometheus: `http://localhost:9090`

## Backup and Recovery

### Backup Script

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUP_DIR

# Backup Neo4j
docker exec neo4j-conversation neo4j-admin dump \
  --database=neo4j \
  --to=/backups/neo4j-backup.dump

# Backup Qdrant
docker exec qdrant-conversation \
  curl -X POST 'http://localhost:6333/snapshots'

# Backup Redis
docker exec redis-conversation \
  redis-cli SAVE

echo "Backup completed to $BACKUP_DIR"
```

## Troubleshooting

### Common Issues

1. **Neo4j Connection Refused**
   ```bash
   # Check Neo4j logs
   docker logs neo4j-conversation
   # Ensure bolt port is accessible
   telnet localhost 7687
   ```

2. **Clustering Service Timeout**
   ```bash
   # Increase timeout in GraphQL server
   # Check memory usage
   docker stats clustering-service
   ```

3. **Visualization Not Loading**
   ```bash
   # Check browser console for errors
   # Verify GraphQL endpoint
   curl http://localhost:4000/graphql
   ```

## Performance Optimization

### Query Optimization

1. **Use DataLoader** for batching
2. **Implement query complexity limits**
3. **Cache frequently accessed data in Redis**

### Visualization Performance

For networks with >1000 nodes:
- Use WebGL renderer (Sigma.js)
- Implement level-of-detail rendering
- Use virtualization for node lists

## API Integration

### Python Client Example

```python
import requests
import json

class ConversationNetworkClient:
    def __init__(self, graphql_url="http://localhost:4000/graphql"):
        self.url = graphql_url
    
    def add_conversation(self, query_text, response_text):
        mutation = """
        mutation AddConversation($query: String!, $response: String!) {
          createQuery(input: {content: $query, userId: "api"}) {
            id
            response {
              id
            }
          }
        }
        """
        
        response = requests.post(
            self.url,
            json={
                'query': mutation,
                'variables': {
                    'query': query_text,
                    'response': response_text
                }
            }
        )
        
        return response.json()
    
    def get_clusters(self):
        query = """
        query GetClusters {
          allClusters {
            id
            name
            keywords
            messageCount
          }
        }
        """
        
        response = requests.post(
            self.url,
            json={'query': query}
        )
        
        return response.json()
```

## Maintenance

### Regular Tasks

1. **Weekly**: Run clustering update
   ```graphql
   mutation UpdateClusters {
     runClustering {
       clustersCreated
     }
   }
   ```

2. **Daily**: Update embeddings cache
3. **Monthly**: Optimize Neo4j database
   ```cypher
   CALL db.checkpoint()
   ```

## Support and Resources

- GraphQL Schema Documentation: `/graphql` (GraphQL Playground)
- Neo4j Browser: `http://localhost:7474`
- Qdrant Dashboard: `http://localhost:6333/dashboard`
- System Logs: `docker-compose logs -f [service-name]`

## License

This implementation uses open-source components under their respective licenses:
- Neo4j Community Edition: GPLv3
- Apollo Server: MIT
- BERTopic: MIT
- D3.js: BSD-3-Clause